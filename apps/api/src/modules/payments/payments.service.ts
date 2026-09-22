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
import { RecordBookingPaymentDto } from './dto/record-booking-payment.dto';

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
   * Create a payment plan with booking-independent EMI installments.
   *
   * P2 business model:
   * - total_amount is the FINAL AGREED FEE (GST inclusive).
   * - booking_amount is an independent booking payment (NOT installment #1).
   *   NULL (legacy) is treated as 0 for schedule generation.
   * - installment_count means number of EMIs AFTER booking.
   * - remaining = total_amount - (booking_amount ?? 0) is split across EMIs.
   *
   * EMI calculation (cent-safe):
   * - remainingCents = totalCents - bookingCents
   * - baseCents = floor(remainingCents / installment_count)
   * - lastCents = remainingCents - baseCents * (count - 1)
   * - Due dates are spaced 30 days apart starting from startDate (defaults to today).
   * - Sum(EMIs) == remaining, and booking + sum(EMIs) == total.
   * - Last EMI absorbs rounding remainder. Zero remaining (booking==total) yields zero-amount EMIs.
   *
   * P1 finance foundation:
   * - total_amount is the FINAL AGREED FEE (GST inclusive).
   * - Optional standard_course_fee / discount_amount are snapshotted when
   *   supplied. If supplied, validates standard - discount == total (cent-safe).
   * - Optional booking_amount is snapshotted; 0 is valid explicit, NULL means
   *   unspecified (legacy). P2 makes schedule booking-independent.
   *
   * Steps:
   *   1. Validate that the student exists and is a student.
   *   2. Validate that the course exists and is active.
   *   3. Validate P1 finance fields (standard/discount/booking).
   *   4. Insert the payment_plan row with snapshot fields.
   *   5. Generate EMI installments from remaining (not total) and bulk insert.
   *   6. Return the plan with its installments.
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

    // ── P1: agreed-fee validation (standard -> discount -> final)
    // Keep currency-safe cent comparison to avoid float equality pitfalls.
    const toCents = (n: number) => Math.round(n * 100);
    const hasStandard = dto.standardCourseFee !== undefined && dto.standardCourseFee !== null;
    const hasDiscount =
      dto.discountAmount !== undefined && dto.discountAmount !== null;
    const hasBooking =
      dto.bookingAmount !== undefined && dto.bookingAmount !== null;

    if (hasDiscount && !hasStandard) {
      throw new BadRequestException(
        'standardCourseFee is required when discountAmount is provided',
      );
    }

    if (hasStandard) {
      if (dto.standardCourseFee! < 0.01) {
        throw new BadRequestException('standardCourseFee must be at least 0.01');
      }
      const stdCents = toCents(dto.standardCourseFee!);
      const disCents = hasDiscount ? toCents(dto.discountAmount!) : 0;
      if (disCents < 0) {
        throw new BadRequestException('discountAmount must be at least 0');
      }
      if (disCents > stdCents) {
        throw new BadRequestException('discountAmount cannot exceed standardCourseFee');
      }
      const expectedFinalCents = stdCents - disCents;
      const actualFinalCents = toCents(dto.totalAmount);
      if (expectedFinalCents !== actualFinalCents) {
        throw new BadRequestException(
          `Inconsistent totalAmount: standardCourseFee (${dto.standardCourseFee}) - discountAmount (${dto.discountAmount ?? 0}) = ${(expectedFinalCents / 100).toFixed(2)}, but totalAmount is ${dto.totalAmount.toFixed(2)}`,
        );
      }
    } else if (hasDiscount) {
      // already handled above (hasDiscount && !hasStandard) — kept for clarity
      throw new BadRequestException(
        'standardCourseFee is required when discountAmount is provided',
      );
    }

    if (hasBooking) {
      if (dto.bookingAmount! < 0) {
        throw new BadRequestException('bookingAmount must be at least 0');
      }
      if (toCents(dto.bookingAmount!) > toCents(dto.totalAmount)) {
        throw new BadRequestException('bookingAmount cannot exceed totalAmount (final agreed fee)');
      }
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
        // P1 financial snapshot — NULL/0 preserved for legacy plans when fields not supplied
        standard_course_fee: hasStandard ? dto.standardCourseFee! : null,
        discount_amount: hasDiscount ? dto.discountAmount! : 0,
        discount_reason: dto.discountReason ?? null,
        booking_amount: hasBooking ? dto.bookingAmount! : null,
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
      {
        studentId: dto.studentId,
        courseId: dto.courseId,
        totalAmount: dto.totalAmount,
        standardCourseFee: hasStandard ? dto.standardCourseFee : null,
        discountAmount: hasDiscount ? dto.discountAmount : 0,
        bookingAmount: hasBooking ? dto.bookingAmount : null,
      },
    ).catch(() => {});

    // 2. Generate booking-independent EMI installments (P2)
    // installment_count = EMIs after booking; remaining = total - booking
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : new Date();

    const totalAmount = dto.totalAmount;
    const count = dto.numberOfInstallments;

    // P2: remaining after independent booking (NULL booking -> 0, legacy preserved)
    const totalCents = toCents(totalAmount);
    const bookingCents = hasBooking ? toCents(dto.bookingAmount!) : 0;
    const remainingCents = totalCents - bookingCents;
    // remainingCents >=0 guaranteed by P1 validation booking<=total
    // Zero remaining (booking==total) is valid — yields zero-amount EMIs

    const baseCents = Math.floor(remainingCents / count);
    const lastCents = remainingCents - baseCents * (count - 1);

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

      const amountCents = i === count - 1 ? lastCents : baseCents;
      const amount = amountCents / 100;

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
  //  recordBookingPayment (P2) — independent booking payment
  // ──────────────────────────────────────────────────────────────

  /**
   * Record the booking payment for a payment plan.
   *
   * P2 model: booking is NOT an installment. It is a standalone payments row
   * with installment_id=NULL, payment_plan_id=plan.id, amount=plan.booking_amount.
   * Generates a receipt via outbox (one receipt per payment). Duplicate booking
   * is rejected via app guard (SELECT existing booking payment). No DB unique
   * for booking is added in P2 to avoid breaking legitimate non-booking payments
   * with NULL installment_id — concurrency window is documented.
   */
  async recordBookingPayment(
    planId: string,
    dto: RecordBookingPaymentDto,
    adminId: string,
  ) {
    const { data: plan, error: planErr } = await this.supabaseService.client
      .from(TABLES.PAYMENT_PLANS)
      .select('*')
      .eq('id', planId)
      .single();

    if (planErr || !plan) {
      throw new NotFoundException(`Payment plan ${planId} not found`);
    }

    const p = plan as any;

    // Must have explicit booking_amount > 0
    if (p.booking_amount === null || p.booking_amount === undefined) {
      throw new BadRequestException('This payment plan has no booking amount configured');
    }
    const bookingAmount = Number(p.booking_amount);
    if (bookingAmount <= 0) {
      throw new BadRequestException('Booking amount must be greater than 0 for this plan');
    }

    // Duplicate guard — booking payments have installment_id IS NULL
    const { data: existing } = await this.supabaseService.client
      .from(TABLES.PAYMENTS)
      .select('id')
      .eq('payment_plan_id', planId)
      .is('installment_id', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      throw new BadRequestException('Booking payment already recorded for this plan');
    }

    const paidOn = dto.paymentDate
      ? new Date(dto.paymentDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const { data: payment, error: payErr } = await this.supabaseService.client
      .from(TABLES.PAYMENTS)
      .insert({
        student_id: p.student_id,
        course_id: p.course_id,
        payment_plan_id: p.id,
        installment_id: null,
        amount: bookingAmount,
        payment_method: dto.paymentMethod,
        transaction_id: dto.transactionId ?? null,
        paid_on: paidOn,
        is_full_payment: false,
        recorded_by: adminId,
      })
      .select()
      .single();

    if (payErr || !payment) {
      this.logger.error(`Failed to record booking payment for plan ${planId}: ${payErr?.message}`);
      throw new BadRequestException('Failed to record booking payment');
    }

    await this.outboxService.enqueue('receipt', { paymentId: (payment as any).id }).catch((err) =>
      this.logger.error(`Failed to enqueue booking receipt for payment ${(payment as any).id}: ${err.message}`),
    );

    logEntityEvent(
      this.observabilityService,
      'BOOKING_PAYMENT_RECORDED',
      'payment',
      (payment as any).id,
      adminId,
      { planId, studentId: p.student_id, bookingAmount },
    ).catch(() => {});

    if (this.redisCache) await this.redisCache.invalidatePaymentsCacheForUser(p.student_id).catch(() => {});

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
