import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  InstallmentStatus,
  PaymentPlanStatus,
  PaymentMethod,
} from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { OutboxService } from '../outbox/outbox.service';
import { ObservabilityService } from '../observability/observability.service';
import { Transaction } from '../../common/utils/transaction.util';
import { logEntityEvent } from '../../common/utils/observability-helper';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { MarkInstallmentPaidDto } from './dto/mark-installment-paid.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly outboxService: OutboxService,
    private readonly observabilityService: ObservabilityService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  createPaymentPlan
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a payment plan with EMI installments.
   *
   * EMI calculation:
   * - Divide totalAmount by numberOfInstallments and round each installment
   *   down to 2 decimal places (floor) so we never over-collect.
   * - The last installment absorbs any remaining cents so that
   *   sum(installments) === totalAmount exactly.
   * - Due dates are spaced 30 days apart starting from startDate
   *   (defaults to today).
   *
   * Steps:
   *   1. Validate that the student exists and is a student.
   *   2. Validate that the course exists and is active.
   *   3. Insert the payment_plan row.
   *   4. Generate the installments array and bulk insert.
   *   5. Return the plan with its installments.
   */
  async createPaymentPlan(dto: CreatePaymentPlanDto, adminId: string) {
    // Validate student
    const { data: student } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .eq('id', dto.studentId)
      .single();

    if (!student) {
      throw new NotFoundException(`Student ${dto.studentId} not found`);
    }

    // Validate course
    const { data: course } = await this.supabaseService.client
      .from(TABLES.COURSES)
      .select('id, is_active')
      .eq('id', dto.courseId)
      .single();

    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }

    if (!(course as any).is_active) {
      throw new BadRequestException('Cannot create payment plan for an inactive course');
    }

    // 1. Insert payment plan
    const { data: plan, error: planError } = await this.supabaseService.client
      .from(TABLES.PAYMENT_PLANS)
      .insert({
        student_id: dto.studentId,
        course_id: dto.courseId,
        total_amount: dto.totalAmount,
        installment_count: dto.numberOfInstallments,
        notes: dto.notes ?? null,
        status: PaymentPlanStatus.ACTIVE,
        created_by: adminId,
      })
      .select()
      .single();

    if (planError) {
      this.logger.error(`Failed to create payment plan: ${planError.message}`);
      throw new BadRequestException('Failed to create payment plan');
    }

    const planId = (plan as any).id;
    logEntityEvent(
      this.observabilityService,
      'PAYMENT_PLAN_CREATED',
      'payment_plan',
      planId,
      adminId,
      { studentId: dto.studentId, courseId: dto.courseId, totalAmount: dto.totalAmount },
    ).catch(() => {});

    // 2. Generate installments
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : new Date();

    const totalAmount = dto.totalAmount;
    const count = dto.numberOfInstallments;

    // Floor each regular EMI to 2 decimals so we never over-collect
    const rawEmi = totalAmount / count;
    const regularEmi = Math.floor(rawEmi * 100) / 100;
    // Last installment absorbs rounding difference
    const lastEmi = +(totalAmount - regularEmi * (count - 1)).toFixed(2);

    const installments: {
      payment_plan_id: string;
      installment_number: number;
      amount: number;
      due_date: string;
      status: string;
    }[] = [];

    for (let i = 0; i < count; i++) {
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() + i * 30);

      const amount = i === count - 1 ? lastEmi : regularEmi;

      installments.push({
        payment_plan_id: planId,
        installment_number: i + 1,
        amount,
        due_date: dueDate.toISOString().split('T')[0],
        status: InstallmentStatus.PENDING,
      });
    }

    const { error: instError } = await this.supabaseService.client
      .from(TABLES.PAYMENT_INSTALLMENTS)
      .insert(installments);

    if (instError) {
      this.logger.error(`Failed to create installments: ${instError.message}`);
      // Clean up the plan
      await this.supabaseService.client
        .from(TABLES.PAYMENT_PLANS)
        .delete()
        .eq('id', planId);
      throw new BadRequestException('Failed to create payment installments');
    }

    // Fetch what we just created
    const { data: createdInstallments } = await this.supabaseService.client
      .from(TABLES.PAYMENT_INSTALLMENTS)
      .select('*')
      .eq('payment_plan_id', planId)
      .order('installment_number', { ascending: true });

    if (this.redisCache) await this.redisCache.invalidatePaymentsCacheForUser(dto.studentId).catch(() => {});

    return {
      ...(plan as any),
      installments: createdInstallments ?? [],
    };
  }
  //  markInstallmentPaid
  // ──────────────────────────────────────────────────────────────

  /**
   * Mark an installment as paid and create a payment record.
   *
   * Steps:
   *   1. Fetch the installment with its parent payment_plan.
   *   2. Ensure it's still PENDING (cannot re-pay a paid installment).
   *   3. Update the installment status to PAID.
   *   4. Insert a payment row linking student, course, plan, and installment.
   *   5. If all installments are now paid, mark the plan as COMPLETED.
   *   6. Return the payment record.
   *
   * TODO (Prompt 13): Trigger Receipt (PDF) generation after creating the payment.
   */
  async markInstallmentPaid(
    installmentId: string,
    dto: MarkInstallmentPaidDto,
    adminId: string,
  ) {
    // 1. Fetch the installment
    const { data: installment, error: instFetchErr } =
      await this.supabaseService.client
        .from(TABLES.PAYMENT_INSTALLMENTS)
        .select('*, payment_plan:payment_plans!inner(*)')
        .eq('id', installmentId)
        .single();

    if (instFetchErr || !installment) {
      throw new NotFoundException('Installment not found');
    }

    const inst = installment as any;
    const plan = inst.payment_plan;

    if (inst.status !== InstallmentStatus.PENDING) {
      throw new BadRequestException(
        `Installment is already ${inst.status}. Only pending installments can be marked as paid.`,
      );
    }

    // 2. Update installment
    const paidOn = dto.paymentDate
      ? new Date(dto.paymentDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const oldStatus = inst.status;
    const oldPaidAt = inst.paid_at;

    // 3. Transaction: update installment → create payment → link back
    const tx = new Transaction();
    let payment: any = null;

    await tx.run([
      {
        name: 'update installment to PAID',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.PAYMENT_INSTALLMENTS)
            .update({
              status: InstallmentStatus.PAID,
              paid_at: new Date().toISOString(),
            })
            .eq('id', installmentId);
          if (error) throw error;
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.PAYMENT_INSTALLMENTS)
            .update({ status: oldStatus, paid_at: oldPaidAt })
            .eq('id', installmentId);
        },
      },
      {
        name: 'create payment record',
        execute: async () => {
          const { data, error } = await this.supabaseService.client
            .from(TABLES.PAYMENTS)
            .insert({
              student_id: plan.student_id,
              course_id: plan.course_id,
              payment_plan_id: plan.id,
              installment_id: installmentId,
              amount: inst.amount,
              payment_method: dto.paymentMethod,
              transaction_id: dto.transactionId ?? null,
              paid_on: paidOn,
              is_full_payment: false,
              recorded_by: adminId,
            })
            .select()
            .single();
          if (error) throw error;
          payment = data;
        },
        rollback: async () => {
          if (payment) {
            await this.supabaseService.client
              .from(TABLES.PAYMENTS)
              .delete()
              .eq('id', payment.id);
          }
        },
      },
      {
        name: 'link payment_id to installment',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.PAYMENT_INSTALLMENTS)
            .update({ payment_id: payment.id })
            .eq('id', installmentId);
          if (error) throw error;
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.PAYMENT_INSTALLMENTS)
            .update({ payment_id: null })
            .eq('id', installmentId);
        },
      },
    ]);

    // 4. Check if all installments are paid → mark plan completed
    const { data: allInsts } = await this.supabaseService.client
      .from(TABLES.PAYMENT_INSTALLMENTS)
      .select('status')
      .eq('payment_plan_id', plan.id);

    const allPaid = (allInsts ?? []).every(
      (i: any) => i.status === InstallmentStatus.PAID,
    );

    if (allPaid) {
      await this.supabaseService.client
        .from(TABLES.PAYMENT_PLANS)
        .update({ status: PaymentPlanStatus.COMPLETED })
        .eq('id', plan.id);
    }

    // Enqueue receipt generation (outbox pattern) — never blocks payment commit
    await this.outboxService.enqueue('receipt', { paymentId: payment.id }).catch((err) =>
      this.logger.error(`Failed to enqueue receipt for payment ${payment.id}: ${err.message}`),
    );

    logEntityEvent(
      this.observabilityService,
      'PAYMENT_RECEIVED',
      'payment',
      payment.id,
      adminId,
      { studentId: plan.student_id, installmentId, amount: inst.amount },
    ).catch(() => {});

    if (this.redisCache) await this.redisCache.invalidatePaymentsCacheForUser(plan.student_id).catch(() => {});

    return payment as any;
  }

  // ──────────────────────────────────────────────────────────────
  //  getStudentPlans
  // ──────────────────────────────────────────────────────────────

  /**
   * Fetch all payment plans for a student, including course name
   * and installments sorted by due date. Cached per-user TTL 300s.
   */
  async getStudentPlans(studentId: string) {
    if (!this.redisCache) return this.fetchStudentPlans(studentId);
    const cacheKey = this.redisCache.key('payments', studentId);
    return this.redisCache.wrap(cacheKey, 300, async () => {
      return this.fetchStudentPlans(studentId);
    });
  }

  private async fetchStudentPlans(studentId: string) {
    const { data: plans, error } = await this.supabaseService.client
      .from(TABLES.PAYMENT_PLANS)
      .select('*, course:courses(id, name)')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch plans for student ${studentId}: ${error.message}`);
      throw new BadRequestException('Failed to fetch payment plans');
    }

    if (!(plans ?? []).length) return [];

    const planIds = (plans as any[]).map((p) => p.id);

    // Single query for all installments — avoids N+1
    const { data: allInstallments } = await this.supabaseService.client
      .from(TABLES.PAYMENT_INSTALLMENTS)
      .select('*')
      .in('payment_plan_id', planIds)
      .order('installment_number', { ascending: true });

    // Group in memory by payment_plan_id
    const installmentMap = new Map<string, any[]>();
    for (const inst of allInstallments ?? []) {
      const planId = (inst as any).payment_plan_id;
      if (!installmentMap.has(planId)) {
        installmentMap.set(planId, []);
      }
      installmentMap.get(planId)!.push(inst);
    }

    return (plans as any[]).map((plan) => ({
      ...plan,
      installments: installmentMap.get(plan.id) ?? [],
    }));
  }
}
