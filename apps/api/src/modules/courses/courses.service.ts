import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { ObservabilityService } from '../observability/observability.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { logEntityEvent } from '../../common/utils/observability-helper';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly observabilityService: ObservabilityService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) {}

  async create(dto: CreateCourseDto) {
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate) {
      throw new BadRequestException('End date cannot be earlier than start date.');
    }

    const { data, error } = await this.supabaseService.client
      .from(TABLES.COURSES)
      .insert({
        name: dto.name,
        description: dto.description ?? null,
        start_date: dto.startDate ?? null,
        end_date: dto.endDate ?? null,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to create course: ${error.message}`);
      throw new InternalServerErrorException(`Could not create course: ${error.message}`);
    }
    logEntityEvent(
      this.observabilityService,
      'COURSE_CREATED',
      'course',
      data.id,
      'system',
      { name: dto.name },
    ).catch(() => {});
    return data;
  }

  async findAll(page = 1, pageSize = 20, includeInactive = false) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabaseService.client
      .from(TABLES.COURSES)
      .select('*, batches:batches(id, name, schedule_type, is_active, start_date, end_date, created_at)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logger.error(`Failed to list courses: ${error.message}`);
      throw new InternalServerErrorException(`Could not load courses: ${error.message}`);
    }

    const items = (data ?? []).map((c: any) => ({
      ...c,
      batchCount: Array.isArray(c.batches) ? c.batches.length : 0,
    }));

    return {
      items,
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async findById(id: string, currentUser?: { id: string; role: string }) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.COURSES)
      .select('*, batches:batches(id, name, schedule_type, start_date, end_date, is_active)')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Course with id "${id}" not found.`);
    }

    if (currentUser && currentUser.role === UserRole.STUDENT && currentUser.id) {
      const batches = (data as any).batches ?? [];
      const batchIds = batches.map((b: any) => b.id);

      if (batchIds.length > 0) {
        const { data: enrolRows } = await this.supabaseService.client
          .from(TABLES.BATCH_STUDENTS)
          .select('batch_id')
          .eq('user_id', currentUser.id)
          .in('batch_id', batchIds);

        const enrolledBatchIds = new Set((enrolRows ?? []).map((r: any) => r.batch_id));
        (data as any).enrolledBatches = batches.filter((b: any) => enrolledBatchIds.has(b.id));
      } else {
        (data as any).enrolledBatches = [];
      }
    }

    return data;
  }

  async update(id: string, dto: UpdateCourseDto) {
    const existing = await this.findById(id);

    const newStart = dto.startDate ?? existing.start_date;
    const newEnd = dto.endDate ?? existing.end_date;
    if (newStart && newEnd && newEnd < newStart) {
      throw new BadRequestException('End date cannot be earlier than start date.');
    }

    const updates: Record<string, any> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.startDate !== undefined) updates.start_date = dto.startDate;
    if (dto.endDate !== undefined) updates.end_date = dto.endDate;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;

    const { data, error } = await this.supabaseService.client
      .from(TABLES.COURSES)
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to update course ${id}: ${error.message}`);
      throw new InternalServerErrorException(`Could not update course: ${error.message}`);
    }
    logEntityEvent(
      this.observabilityService,
      'COURSE_UPDATED',
      'course',
      id,
      'system',
      { name: dto.name ?? 'unknown', changes: Object.keys(updates).join(',') },
    ).catch(() => {});
    return data;
  }

  async duplicate(id: string) {
    const course = await this.findById(id);
    const newName = `${course.name} (Copy)`;

    const { data: newCourse, error: insertErr } = await this.supabaseService.client
      .from(TABLES.COURSES)
      .insert({
        name: newName,
        description: course.description,
        start_date: course.start_date,
        end_date: course.end_date,
      })
      .select('*')
      .single();

    if (insertErr) {
      this.logger.error(`Failed to duplicate course ${id}: ${insertErr.message}`);
      throw new InternalServerErrorException(`Could not duplicate course: ${insertErr.message}`);
    }

    const batches = (course as any).batches ?? [];
    if (batches.length > 0) {
      const { data: newBatches, error: batchErr } = await this.supabaseService.client
        .from(TABLES.BATCHES)
        .insert(
          batches.map((b: any) => ({
            course_id: newCourse.id,
            name: b.name,
            schedule_type: b.schedule_type,
            is_active: false,
          })),
        )
        .select('id');

      if (batchErr) {
        this.logger.error(`Failed to copy batches for duplicated course: ${batchErr.message}`);
      } else if (newBatches) {
        for (let i = 0; i < batches.length; i++) {
          const oldBatchId = batches[i].id;
          const newBatchId = newBatches[i]?.id;
          if (!oldBatchId || !newBatchId) continue;

            const { data: curriculum } = await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .select('*')
              .eq('batch_id', oldBatchId);

            if (curriculum && curriculum.length > 0) {
              const { error: copyErr } = await this.supabaseService.client
                .from(TABLES.BATCH_RECORDING_CURRICULUM)
                .insert(
                  (curriculum as any[]).map((c: any) => ({
                    batch_id: newBatchId,
                    content_id: c.content_id,
                    content_type: c.content_type ?? 'recording',
                    category_name: c.category_name,
                    module_name: c.module_name,
                    sort_order: c.sort_order,
                    is_published: false,
                    pdf_url: c.pdf_url,
                    pdf_title: c.pdf_title,
                    title_override: c.title_override,
                  })),
                );

              if (copyErr) {
                this.logger.error(`Failed to copy curriculum for batch ${oldBatchId}: ${copyErr.message}`);
              }
            }
        }
      }
    }

    return newCourse;
  }

  async deactivate(id: string) {
    await this.findById(id);
    return this.update(id, { isActive: false });
  }

  async activate(id: string) {
    await this.findById(id);
    return this.update(id, { isActive: true });
  }

  async getBatches(courseId: string) {
    await this.findById(courseId);

    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('*')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to get batches for course ${courseId}: ${error.message}`);
      throw new InternalServerErrorException(`Could not load batches: ${error.message}`);
    }
    return data ?? [];
  }

  async getStats(courseId: string) {
    await this.findById(courseId);

    const { count: batchCount, error: batchErr } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id', { count: 'exact', head: true })
      .eq('course_id', courseId);
    if (batchErr) {
      throw new InternalServerErrorException(`Stats failed: ${batchErr.message}`);
    }

    const { data: batches, error: batchListErr } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id')
      .eq('course_id', courseId);
    if (batchListErr) {
      throw new InternalServerErrorException(`Stats failed: ${batchListErr.message}`);
    }
    const batchIds = (batches ?? []).map((b: any) => b.id);

    if (batchIds.length === 0) {
      return { batchCount: 0, studentCount: 0, upcomingSessions: 0 };
    }

    const { data: studentRows, error: studErr } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('user_id')
      .in('batch_id', batchIds);
    if (studErr) {
      throw new InternalServerErrorException(`Stats failed: ${studErr.message}`);
    }
    const uniqueStudents = new Set((studentRows ?? []).map((r: any) => r.user_id));

    const { data: sessionRows, error: sessErr } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('session_id, live_sessions!inner(status, start_time)')
      .in('batch_id', batchIds)
      .eq('live_sessions.status', 'scheduled')
      .gte('live_sessions.start_time', new Date().toISOString());
    if (sessErr) {
      throw new InternalServerErrorException(`Stats failed: ${sessErr.message}`);
    }
    const uniqueSessions = new Set((sessionRows ?? []).map((r: any) => r.session_id));

    return {
      batchCount: batchCount ?? 0,
      studentCount: uniqueStudents.size,
      upcomingSessions: uniqueSessions.size,
    };
  }

  async getCoursesForStudent(studentId: string) {
    if (!this.redisCache) return this.fetchCoursesForStudent(studentId);
    const cacheKey = this.redisCache.key('courses', studentId);
    return this.redisCache.wrap(cacheKey, 300, async () => {
      return this.fetchCoursesForStudent(studentId);
    });
  }

  async getDashboardCoursesForStudent(studentId: string): Promise<{ courses: any[]; name: string | null }> {
    if (!this.redisCache) {
      const courses = await this.fetchCoursesForStudent(studentId);
      const { data: profile } = await this.supabaseService.client.from(TABLES.PROFILES).select('name').eq('id', studentId).single();
      return { courses, name: (profile as any)?.name ?? null };
    }
    const cacheKey = this.redisCache.key('courses', studentId, 'dashboard');
    return this.redisCache.wrap(cacheKey, 300, async () => {
      const courses = await this.fetchCoursesForStudent(studentId);
      const { data: profile } = await this.supabaseService.client.from(TABLES.PROFILES).select('name').eq('id', studentId).single();
      return { courses, name: (profile as any)?.name ?? null };
    });
  }

  private async fetchCoursesForStudent(studentId: string) {
    const { data: enrolments, error: enrolErr } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id, batches:batches(id, name, course_id)')
      .eq('user_id', studentId);
    if (enrolErr) {
      throw new InternalServerErrorException(`Could not load enrolments: ${enrolErr.message}`);
    }

    const courseMap = new Map<string, { courseId: string; batches: any[] }>();
    for (const row of enrolments ?? []) {
      const batch = (row as any).batches;
      if (!batch?.course_id) continue;
      const existing = courseMap.get(batch.course_id);
      if (existing) {
        existing.batches.push(batch);
      } else {
        courseMap.set(batch.course_id, { courseId: batch.course_id, batches: [batch] });
      }
    }

    if (courseMap.size === 0) return [];

    const courseIds = Array.from(courseMap.keys());
    const { data: courses, error: courseErr } = await this.supabaseService.client
      .from(TABLES.COURSES)
      .select('*')
      .in('id', courseIds)
      .eq('is_active', true);
    if (courseErr) {
      throw new InternalServerErrorException(`Could not load courses: ${courseErr.message}`);
    }

    return (courses ?? []).map((c: any) => ({
      ...c,
      enrolledBatches: courseMap.get(c.id)?.batches ?? [],
    }));
  }
}
