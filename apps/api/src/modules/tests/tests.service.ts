import { Injectable, NotFoundException, ConflictException, BadRequestException, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { ObservabilityService } from '../observability/observability.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { logEntityEvent } from '../../common/utils/observability-helper';
import { ilikeContains } from '../../common/utils/like-escape.util';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';

const TEST_SELECT = `
  *,
  test_batches(batch_id, batches(name)),
  test_sections(*),
  test_question_bank(
    *,
    question_bank(id, question_text, question_type, options, correct_answer, explanation, difficulty, topic_id, topics(name))
  )
`;

@Injectable()
export class TestsService {
  private readonly logger = new Logger(TestsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly observabilityService: ObservabilityService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) {}

  async create(dto: CreateTestDto, createdBy: string) {
    const { sections, questions, batches, ...testData } = dto;

    // Enforce invariant: end = start + duration (IST round-trip already handled by frontend to UTC)
    let startISO = testData.startTime ?? null;
    let endISO = testData.endTime ?? null;
    if (startISO && testData.durationMinutes) {
      const computed = new Date(new Date(startISO).getTime() + testData.durationMinutes * 60000).toISOString();
      if (endISO && Math.abs(new Date(endISO).getTime() - new Date(computed).getTime()) > 60000) {
        this.logger.warn(`create test "${testData.title}" end_time corrected from ${endISO} to ${computed} to match duration ${testData.durationMinutes}`);
      }
      endISO = computed;
    }

    const { data: test, error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .insert({
        title: testData.title,
        description: testData.description ?? null,
        duration_minutes: testData.durationMinutes ?? null,
        total_marks: testData.totalMarks,
        passing_marks: testData.passingMarks ?? Math.ceil(testData.totalMarks * 0.4),
        status: startISO ? 'scheduled' : 'draft',
        start_time: startISO,
        end_time: endISO,
        shuffle_questions: testData.shuffleQuestions ?? false,
        shuffle_options: testData.shuffleOptions ?? false,
        show_result_immediately: testData.showResultImmediately ?? true,
        negative_marking: testData.negativeMarking ?? false,
        negative_per_question: testData.negativePerQuestion ?? 0.25,
        max_attempts: testData.maxAttempts ?? 1,
        instructions: testData.instructions ?? null,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw this.toCreateError(error);
    // Validate marks arithmetic: sum of question marks should equal total_marks
    if (questions?.length) {
      const sumMarks = questions.reduce((s: number, q: any) => s + (q.marks ?? 1), 0);
      if (sumMarks !== testData.totalMarks) {
        this.logger.warn(`create test "${testData.title}" total_marks ${testData.totalMarks} != sum_marks ${sumMarks} (${questions.length} questions) — arithmetic mismatch will show as 11q/12m`);
      }
    }
    try {
      const result = await this.insertRelations(test.id, sections, questions, batches);
      // Cache is best-effort — database is authoritative
      if (this.redisCache) await this.redisCache.invalidateAllTestsCache().catch(()=>{});
      logEntityEvent(
        this.observabilityService,
        'TEST_CREATED',
        'test',
        test.id,
        createdBy,
        { title: testData.title },
      ).catch(() => {});
      return result;
    } catch (e) {
      await this.cleanupFailedCreate(test.id, e);
      throw e;
    }
  }

  async duplicate(id: string, createdBy: string) {
    const original = await this.findOne(id);
    if (!original) throw new NotFoundException('Test not found');

    const { data: test, error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .insert({
        title: `${original.title} (Copy)`,
        description: original.description,
        duration_minutes: original.duration_minutes,
        total_marks: original.total_marks,
        passing_marks: original.passing_marks,
        status: 'draft',
        shuffle_questions: original.shuffle_questions,
        shuffle_options: original.shuffle_options,
        show_result_immediately: original.show_result_immediately,
        negative_marking: original.negative_marking,
        negative_per_question: original.negative_per_question,
        max_attempts: original.max_attempts,
        instructions: original.instructions,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw error;

    const sections = original.test_sections?.map((s: any) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      instructions: s.instructions,
      sort_order: s.sort_order,
    })) ?? [];

    const questions = original.test_question_bank?.map((q: any) => ({
      questionBankId: q.question_bank_id,
      marks: q.marks,
      negativeMark: q.negative_mark,
      sortOrder: q.sort_order,
      sectionId: q.section_id,
      isCompulsory: q.is_compulsory,
    })) ?? [];

    const batches = original.test_batches?.map((b: any) => ({
      batchId: b.batch_id,
    })) ?? [];

    return this.insertRelations(test.id, sections, questions, batches);
  }

  private async insertRelations(
    testId: string,
    sections?: any[],
    questions?: any[],
    batches?: any[],
  ) {
    // Insert sections — build oldSectionId → newSectionId map
    const sectionIdMap = new Map<string, string>();
    if (sections?.length) {
      const { data: inserted, error } = await this.supabaseService.client
        .from(TABLES.TEST_SECTIONS)
        .insert(sections.map((s, i) => ({
          test_id: testId,
          title: s.title,
          description: s.description ?? null,
          instructions: s.instructions ?? null,
          sort_order: s.sortOrder ?? i,
        })))
        .select();

      if (error) throw this.toRelationError(error, 'sections');
      if (inserted) {
        for (let i = 0; i < inserted.length; i++) {
          sectionIdMap.set(sections[i].id, inserted[i].id);
        }
      }
    }

    // Insert question bank links — reattach using sectionIdMap
    if (questions?.length) {
      const { error } = await this.supabaseService.client
        .from(TABLES.TEST_QUESTION_BANK)
        .insert(questions.map((q, i) => {
          const newSectionId = q.sectionId ? sectionIdMap.get(q.sectionId) : undefined;
          return {
            test_id: testId,
            question_bank_id: q.questionBankId,
            marks: q.marks ?? 1,
            negative_mark: q.negativeMark ?? 0,
            sort_order: q.sortOrder ?? i,
            section_id: newSectionId ?? null,
            is_compulsory: q.isCompulsory ?? false,
          };
        }));
      if (error) throw this.toRelationError(error, 'questions');
    }

    // Insert batch assignments
    if (batches?.length) {
      const { error } = await this.supabaseService.client
        .from(TABLES.TEST_BATCHES)
        .insert(batches.map((b) => ({
          test_id: testId,
          batch_id: b.batchId,
        })));
      if (error) throw this.toRelationError(error, 'batches');
    }

    return this.findOne(testId);
  }

  private toRelationError(error: any, relation: string): Error {
    const code = (error as any)?.code;
    const msg = (error as any)?.message ?? String(error);
    // FK / unique violations are client errors (invalid batch/question id, duplicate)
    if (code === '23503') {
      const safe = relation === 'batches' ? 'Invalid batch selected' : relation === 'questions' ? 'Invalid question selected' : `Invalid ${relation} data`;
      this.logger.warn(`insertRelations ${relation} FK violation for test: ${msg}`);
      return new BadRequestException(safe);
    }
    if (code === '23505') {
      return new BadRequestException(`Duplicate ${relation} entry`);
    }
    if (code && String(code).startsWith('23')) {
      return new BadRequestException(`Invalid ${relation} data`);
    }
    this.logger.error(`insertRelations ${relation} failed: ${msg}`);
    return new InternalServerErrorException('Failed to create test relations');
  }

  private toCreateError(error: any): Error {
    const code = (error as any)?.code;
    const msg = (error as any)?.message ?? String(error);
    if (code && String(code).startsWith('23')) {
      return new BadRequestException(msg || 'Invalid test data');
    }
    this.logger.error(`create test failed: ${msg}`);
    return new InternalServerErrorException('Failed to create test');
  }

  private async cleanupFailedCreate(testId: string, originalError: unknown): Promise<void> {
    this.logger.warn(`Cleaning up failed test creation ${testId} after error: ${(originalError as any)?.message ?? String(originalError)}`);
    const steps: Array<{ table: string; label: string }> = [
      { table: TABLES.TEST_QUESTION_BANK, label: 'test_question_bank' },
      { table: TABLES.TEST_SECTIONS, label: 'test_sections' },
      { table: TABLES.TEST_BATCHES, label: 'test_batches' },
      { table: TABLES.TESTS, label: 'tests' },
    ];
    for (const step of steps) {
      try {
        const col = step.table === TABLES.TESTS ? 'id' : 'test_id';
        const { error } = await this.supabaseService.client.from(step.table).delete().eq(col, testId);
        if (error) {
          this.logger.error(`Rollback failed for ${step.label} (test ${testId}): ${error.message}`);
        }
      } catch (e) {
        this.logger.error(`Rollback exception for ${step.label} (test ${testId}): ${(e as any)?.message ?? String(e)}`);
      }
    }
  }

  async findAll(options?: { status?: string; batchId?: string; search?: string; page?: number; limit?: number }) {
    let query = this.supabaseService.client
      .from(TABLES.TESTS)
      .select(TEST_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (options?.status) query = query.eq('status', options.status);
    if (options?.batchId) query = query.eq('test_batches.batch_id', options.batchId);
    if (options?.search) query = query.ilike('title', ilikeContains(options.search));

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    return { items: data ?? [], total: count ?? 0, page, limit };
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .select(TEST_SELECT)
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Test not found');
    return data;
  }

  async update(id: string, dto: UpdateTestDto) {
    const existing = await this.findOne(id);
    if (!existing) throw new NotFoundException('Test not found');

    const { sections, questions, batches, ...testData } = dto;

    if (Object.keys(testData).length > 0) {
      const updates: Record<string, any> = {};
      if (testData.title !== undefined) updates.title = testData.title;
      if (testData.description !== undefined) updates.description = testData.description;
      if (testData.durationMinutes !== undefined) updates.duration_minutes = testData.durationMinutes;
      if (testData.totalMarks !== undefined) updates.total_marks = testData.totalMarks;
      if (testData.passingMarks !== undefined) updates.passing_marks = testData.passingMarks;
      if (testData.shuffleQuestions !== undefined) updates.shuffle_questions = testData.shuffleQuestions;
      if (testData.shuffleOptions !== undefined) updates.shuffle_options = testData.shuffleOptions;
      if (testData.showResultImmediately !== undefined) updates.show_result_immediately = testData.showResultImmediately;
      if (testData.negativeMarking !== undefined) updates.negative_marking = testData.negativeMarking;
      if (testData.negativePerQuestion !== undefined) updates.negative_per_question = testData.negativePerQuestion;
      if (testData.maxAttempts !== undefined) updates.max_attempts = testData.maxAttempts;
      if (testData.instructions !== undefined) updates.instructions = testData.instructions;
      if (testData.startTime !== undefined) updates.start_time = testData.startTime;
      if (testData.endTime !== undefined) updates.end_time = testData.endTime;
      // Enforce end = start + duration when both known
      const finalStart = testData.startTime !== undefined ? testData.startTime : (existing as any).start_time;
      const finalDuration = testData.durationMinutes !== undefined ? testData.durationMinutes : (existing as any).duration_minutes;
      if (finalStart && finalDuration) {
        const computed = new Date(new Date(finalStart).getTime() + finalDuration * 60000).toISOString();
        if (updates.end_time && Math.abs(new Date(updates.end_time).getTime() - new Date(computed).getTime()) > 60000) {
          this.logger.warn(`update test "${existing.title}" end_time corrected from ${updates.end_time} to ${computed} to match duration ${finalDuration}`);
        }
        updates.end_time = computed;
        if (testData.startTime === undefined && finalStart !== (existing as any).start_time) {
          updates.start_time = finalStart;
        }
      }
      updates.updated_at = new Date().toISOString();

      const { error } = await this.supabaseService.client
        .from(TABLES.TESTS)
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    }

    // Re-insert relations only for provided arrays (partial PATCH must not wipe other relations)
    const needsRelationRewrite = sections !== undefined || questions !== undefined || batches !== undefined;
    if (needsRelationRewrite) {
      if (sections !== undefined) {
        await this.supabaseService.client.from(TABLES.TEST_SECTIONS).delete().eq('test_id', id);
      }
      if (questions !== undefined) {
        await this.supabaseService.client.from(TABLES.TEST_QUESTION_BANK).delete().eq('test_id', id);
      }
      if (batches !== undefined) {
        await this.supabaseService.client.from(TABLES.TEST_BATCHES).delete().eq('test_id', id);
      }
      // Preserve existing relations for omitted arrays
      const existingSections = sections === undefined ? (existing as any).test_sections?.map((s: any) => ({
        id: s.id, title: s.title, description: s.description, instructions: s.instructions, sort_order: s.sort_order,
      })) : undefined;
      const existingQuestions = questions === undefined ? (existing as any).test_question_bank?.map((q: any) => ({
        questionBankId: q.question_bank_id, marks: q.marks, negativeMark: q.negative_mark, sortOrder: q.sort_order, sectionId: q.section_id, isCompulsory: q.is_compulsory,
      })) : undefined;
      const existingBatches = batches === undefined ? (existing as any).test_batches?.map((b: any) => ({ batchId: b.batch_id })) : undefined;
      if (this.redisCache) await this.redisCache.invalidateAllTestsCache().catch(()=>{}).catch(()=>{});
    return this.insertRelations(
        id,
        sections ?? existingSections,
        questions ?? existingQuestions,
        batches ?? existingBatches,
      );
    }
    if (this.redisCache) await this.redisCache.invalidateAllTestsCache().catch(()=>{}).catch(()=>{});
    return this.findOne(id);
  }

  async updateStatus(id: string, status: string) {
    if (this.redisCache) await this.redisCache.invalidateAllTestsCache().catch(()=>{}).catch(()=>{});
    const valid = ['draft', 'published', 'scheduled', 'active', 'closed', 'archived'];
    if (!valid.includes(status)) throw new ConflictException('Invalid status');

    const { error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    const result = await this.findOne(id);
    if (['published', 'scheduled', 'active'].includes(status)) {
      logEntityEvent(
        this.observabilityService,
        'TEST_PUBLISHED',
        'test',
        id,
        'system',
        { status },
      ).catch(() => {});
    }
    return result;
  }

  async archive(id: string) {
    if (this.redisCache) await this.redisCache.invalidateAllTestsCache().catch(()=>{}).catch(()=>{});
    return this.updateStatus(id, 'archived');
  }

  async remove(id: string) {
    if (this.redisCache) await this.redisCache.invalidateAllTestsCache().catch(()=>{}).catch(()=>{});
    const { error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { deleted: true };
  }

  async getMyTests(userId: string, options?: { page?: number; limit?: number }) {
    if (!this.redisCache) return this.fetchMyTests(userId, options);
    const cacheKey = this.redisCache.key('tests', userId, String(options?.page ?? 1), String(options?.limit ?? 20));
    return this.redisCache.wrap(cacheKey, 300, async () => this.fetchMyTests(userId, options));
  }

  async getDashboardTests(userId: string) {
    if (!this.redisCache) return this.fetchMyTests(userId, { page: 1, limit: 50 }).then(full=>({ items: (full.items ?? []).map((t:any)=>({ id:t.id, title:t.title, status:t.status, end_time:t.end_time ?? null, max_attempts:t.max_attempts ?? null, start_time:t.start_time ?? null })), total: full.total, page:1, limit:50 }));
    const cacheKey = this.redisCache.key('tests', userId, 'dashboard');
    return this.redisCache.wrap(cacheKey, 300, async () => {
      const full = await this.fetchMyTests(userId, { page: 1, limit: 50 });
      // Slim DTO: only required fields, pending detection needs earliest due
      const slimItems = (full.items ?? []).map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        end_time: t.end_time ?? null,
        max_attempts: t.max_attempts ?? null,
        start_time: t.start_time ?? null,
      }));
      // Ensure pending test can be found: status published/active + earliest end_time already computed client-side; keep as is
      return { items: slimItems, total: full.total, page: 1, limit: 50 };
    });
  }

  private async fetchMyTests(userId: string, options?: { page?: number; limit?: number }) {
    const { data: enrolments } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);

    const batchIds = (enrolments ?? []).map((e: any) => e.batch_id);

    if (batchIds.length === 0) {
      return { items: [], total: 0, page: options?.page ?? 1, limit: options?.limit ?? 20 };
    }

    const { data: testBatches } = await this.supabaseService.client
      .from(TABLES.TEST_BATCHES)
      .select('test_id')
      .in('batch_id', batchIds);

    const testIds = [...new Set((testBatches ?? []).map((tb: any) => tb.test_id))];

    if (testIds.length === 0) {
      return { items: [], total: 0, page: options?.page ?? 1, limit: options?.limit ?? 20 };
    }

    let query = this.supabaseService.client
      .from(TABLES.TESTS)
      .select(`*, test_batches(batch_id, batches(name))`, { count: 'exact' })
      .in('id', testIds)
      .in('status', ['published', 'scheduled', 'active'])
      .order('created_at', { ascending: false });

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      this.logger.error(`Failed to fetch student tests: ${(error as any).message}`);
      throw error;
    }

    return { items: data ?? [], total: count ?? 0, page, limit };
  }
}
