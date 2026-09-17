import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UserRole, Batch } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { generateTempPassword } from '../../common/utils/password.util';
import { ObservabilityService } from '../observability/observability.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { logEntityEvent } from '../../common/utils/observability-helper';
import { CreateBatchDto } from './dto/create-batch.dto';
import { AssignStudentsDto } from './dto/assign-students.dto';
import { AddStudentDto } from './dto/add-student.dto';
import { AssignTeachersDto } from './dto/assign-teachers.dto';

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
    private readonly observabilityService: ObservabilityService,
    private readonly redisCache: RedisCacheService,
  ) {}

  async findAll(page = 1, limit = 20, isActive?: boolean) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('*, course:courses(id, name)', { count: 'exact' });

    if (isActive !== undefined) {
      query = query.eq('is_active', isActive);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch batches: ${error.message}`);
      throw new BadRequestException('Could not retrieve batches');
    }

    return {
      items: (data as unknown as Batch[]) ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }

  async findById(id: string) {
    const { data: batch, error: batchError } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('*, course:courses(id, name)')
      .eq('id', id)
      .single();

    if (batchError || !batch) {
      throw new NotFoundException('Batch not found');
    }

    const { count: studentCount } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', id);

    const { count: teacherCount } = await this.supabaseService.client
      .from(TABLES.BATCH_TEACHERS)
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', id);

    return {
      ...(batch as unknown as Batch),
      studentCount: studentCount ?? 0,
      teacherCount: teacherCount ?? 0,
    };
  }

  async create(dto: CreateBatchDto, createdBy: string) {
    const supabase = this.supabaseService.client;

    const { data: course, error: courseErr } = await supabase
      .from(TABLES.COURSES)
      .select('id, is_active')
      .eq('id', dto.courseId)
      .single();
    if (courseErr || !course) {
      throw new BadRequestException('Selected course does not exist or is inactive.');
    }
    if (!course.is_active) {
      throw new BadRequestException('Cannot create a batch in an inactive course.');
    }

    const { data, error } = await supabase
      .from(TABLES.BATCHES)
      .insert({
        course_id: dto.courseId,
        name: dto.name,
        description: dto.description ?? null,
        schedule_type: dto.scheduleType ?? null,
        start_date: dto.startDate ?? null,
        end_date: dto.endDate ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create batch: ${error.message}`);
      throw new BadRequestException('Failed to create batch');
    }

    logEntityEvent(
      this.observabilityService,
      'BATCH_CREATED',
      'batch',
      data.id,
      createdBy,
      { name: dto.name, courseId: dto.courseId },
    ).catch(() => {});

    return data as unknown as Batch;
  }

  async remove(id: string) {
    const { data: batch } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id')
      .eq('id', id)
      .single();

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    const { error } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete batch ${id}: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete batch');
    }

    return { deleted: true };
  }

  async update(id: string, dto: Partial<CreateBatchDto>) {
    const updateData: Record<string, unknown> = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.scheduleType !== undefined) updateData.schedule_type = dto.scheduleType;
    if (dto.startDate !== undefined) updateData.start_date = dto.startDate;
    if (dto.endDate !== undefined) updateData.end_date = dto.endDate;

    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update batch ${id}: ${error?.message}`);
      throw new BadRequestException('Failed to update batch');
    }

    logEntityEvent(
      this.observabilityService,
      'BATCH_UPDATED',
      'batch',
      id,
      'system',
      { changes: Object.keys(updateData).join(',') },
    ).catch(() => {});

    return data as unknown as Batch;
  }

  async reassignCourse(batchId: string, newCourseId: string) {
    await this.findById(batchId);

    const supabase = this.supabaseService.client;
    const { data: course, error: courseErr } = await supabase
      .from(TABLES.COURSES)
      .select('id, is_active')
      .eq('id', newCourseId)
      .single();
    if (courseErr || !course) {
      throw new BadRequestException('Target course not found.');
    }
    if (!course.is_active) {
      throw new BadRequestException('Cannot move a batch to an inactive course.');
    }

    const { data, error } = await supabase
      .from(TABLES.BATCHES)
      .update({ course_id: newCourseId })
      .eq('id', batchId)
      .select('*')
      .single();
    if (error) {
      this.logger.error(`Reassignment failed: ${error.message}`);
      throw new InternalServerErrorException(`Reassignment failed: ${error.message}`);
    }
    return data;
  }

  async assignStudents(batchId: string, dto: AssignStudentsDto) {
    await this.findById(batchId);

    const { data: students } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .in('id', dto.studentIds)
      .eq('role', UserRole.STUDENT);

    const validIds = new Set((students ?? []).map((s: any) => s.id));
    const invalidIds = dto.studentIds.filter((id) => !validIds.has(id));

    if (invalidIds.length > 0) {
      throw new BadRequestException(
        `Invalid student IDs: ${invalidIds.join(', ')}. These users do not exist or are not students.`,
      );
    }

    const records = dto.studentIds.map((userId) => ({
      batch_id: batchId,
      user_id: userId,
    }));

    const { error } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .upsert(records, { onConflict: 'batch_id,user_id' });

    if (error) {
      this.logger.error(`Failed to assign students to batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Failed to assign students');
    }

    // H1: targeted recording cache invalidation — only affected students
    await this.redisCache.invalidateRecordingsCacheForUsers?.(dto.studentIds).catch(() => {});
    await this.redisCache.invalidateCoursesCacheForUsers?.(dto.studentIds).catch(() => {});
    await this.redisCache.invalidateTestsCacheForUser?.(dto.studentIds[0] ?? '').catch(()=>{}); // tests broad handled separately

    return { enrolledCount: dto.studentIds.length };
  }

  async removeStudents(batchId: string, studentIds: string[]) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .delete()
      .eq('batch_id', batchId)
      .in('user_id', studentIds)
      .select();

    if (error) {
      this.logger.error(`Failed to remove students from batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Failed to remove students');
    }

    // H1: targeted recording cache invalidation
    await this.redisCache.invalidateRecordingsCacheForUsers?.(studentIds).catch(() => {});
    await this.redisCache.invalidateCoursesCacheForUsers?.(studentIds).catch(() => {});

    return { removedCount: (data ?? []).length };
  }

  async assignTeachers(batchId: string, dto: AssignTeachersDto) {
    await this.findById(batchId);

    const { data: teachers } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .in('id', dto.teacherIds)
      .eq('role', UserRole.TEACHER);

    const validIds = new Set((teachers ?? []).map((t: any) => t.id));
    const invalidIds = dto.teacherIds.filter((id) => !validIds.has(id));

    if (invalidIds.length > 0) {
      throw new BadRequestException(
        `Invalid teacher IDs: ${invalidIds.join(', ')}. These users do not exist or are not teachers.`,
      );
    }

    const records = dto.teacherIds.map((userId) => ({
      batch_id: batchId,
      user_id: userId,
    }));

    const { error } = await this.supabaseService.client
      .from(TABLES.BATCH_TEACHERS)
      .upsert(records, { onConflict: 'batch_id,user_id' });

    if (error) {
      this.logger.error(`Failed to assign teachers to batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Failed to assign teachers');
    }

    return { assignedCount: dto.teacherIds.length };
  }

  async getStudents(batchId: string, page = 1, limit = 50) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('user_id, profiles!inner(id, name, email, role, is_active, created_at)', { count: 'exact' })
      .eq('batch_id', batchId)
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch students for batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Could not retrieve students');
    }

    return {
      items: (data ?? []).map((item: any) => item.profiles),
      total: count ?? 0,
      page,
      limit,
    };
  }

  async getTeachers(batchId: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCH_TEACHERS)
      .select('user_id, profiles!inner(id, name, email, role, is_active, created_at)')
      .eq('batch_id', batchId);

    if (error) {
      this.logger.error(`Failed to fetch teachers for batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Could not retrieve teachers');
    }

    return (data ?? []).map((item: any) => item.profiles);
  }

  async getSessionsForBatch(batchId: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('session_id, live_sessions!inner(*)')
      .eq('batch_id', batchId)
      .order('live_sessions(start_time)', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch sessions for batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Could not retrieve sessions');
    }

    return (data ?? []).map((item: any) => item.live_sessions);
  }

  async addStudent(batchId: string, dto: AddStudentDto) {
    const batch = await this.findById(batchId);

    const supabase = this.supabaseService.client;
    const name = `${dto.firstName} ${dto.lastName}`.trim();

    // 1. Check if user already exists by email
    const { data: existing } = await supabase
      .from(TABLES.PROFILES)
      .select('id')
      .eq('email', dto.email.toLowerCase())
      .maybeSingle();

    let userId: string;
    let tempPassword: string | undefined;

    if (existing) {
      userId = existing.id;
    } else {
      // 2. Create auth user with a temporary password — standardized 10+Aa1!
      tempPassword = generateTempPassword();
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: dto.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { name },
        });

      if (authError) {
        this.logger.error(`Failed to create auth user for ${dto.email}: ${authError.message}`);
        throw new BadRequestException(authError.message);
      }

      userId = authData.user.id;

      // 3. Insert profile
      const { error: profileError } = await supabase
        .from(TABLES.PROFILES)
        .insert({
          id: userId,
          name,
          email: dto.email.toLowerCase(),
          phone: dto.phone ?? null,
          role: UserRole.STUDENT,
          is_active: true,
          must_change_password: true,
        });

      if (profileError) {
        await supabase.auth.admin.deleteUser(userId);
        this.logger.error(`Failed to create profile for ${dto.email}: ${profileError.message}`);
        throw new BadRequestException('Failed to create student profile');
      }
    }

    // 4. Enroll in batch
    const { error: enrollError } = await supabase
      .from(TABLES.BATCH_STUDENTS)
      .upsert(
        { batch_id: batchId, user_id: userId },
        { onConflict: 'batch_id,user_id' },
      );

    if (enrollError) {
      this.logger.error(
        `Failed to enroll user ${userId} in batch ${batchId}: ${enrollError.message}`,
      );
      throw new BadRequestException('Failed to enroll student in batch');
    }

    // H1: targeted invalidation for the single affected student
    await this.redisCache.invalidateRecordingsCacheForUser?.(userId).catch(() => {});
    await this.redisCache.invalidateCoursesCacheForUser?.(userId).catch(() => {});

    // Fire-and-forget welcome email — only for newly created users
    if (tempPassword) {
      this.emailService
        .sendWelcomeEmail(dto.email, name, tempPassword)
        .catch((emailErr: any) =>
          this.logger.warn(
            `Welcome email failed for ${dto.email} in batch ${batchId}: ${emailErr.message}`,
          ),
        );
    }

    return {
      id: userId,
      name,
      email: dto.email.toLowerCase(),
      alreadyExisted: !!existing,
    };
  }

  async assignStudentToBatch(batchId: string, studentId: string): Promise<void> {
    await this.findById(batchId);

    const { data: student } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .eq('id', studentId)
      .eq('role', UserRole.STUDENT)
      .single();

    if (!student) {
      throw new BadRequestException(`Student ${studentId} does not exist or is not a student.`);
    }

    const { error } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .upsert({ batch_id: batchId, user_id: studentId }, { onConflict: 'batch_id,user_id' });

    if (error) {
      this.logger.error(`Failed to enroll student ${studentId} in batch ${batchId}: ${error.message}`);
      throw new BadRequestException('Failed to enroll student in batch');
    }

    // H1: targeted invalidation — bulk upload also benefits via this helper
    await this.redisCache.invalidateRecordingsCacheForUser?.(studentId).catch(() => {});
    await this.redisCache.invalidateCoursesCacheForUser?.(studentId).catch(() => {});
  }
}
