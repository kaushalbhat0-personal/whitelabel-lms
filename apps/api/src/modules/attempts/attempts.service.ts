import { Injectable, NotFoundException, ForbiddenException, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';
import { StartAttemptDto, SaveAnswerDto, SubmitAttemptDto } from './dto/start-attempt.dto';
import { EvaluationService } from '../evaluation/evaluation.service';

const ATTEMPT_WITH_ANSWERS_SELECT = `
  *,
  test:test_id(*),
  test_answers(*)
`;

const TEST_FOR_ATTEMPT_SELECT = `
  *,
  test_batches(batch_id),
  test_question_bank(
    *,
    question_bank(id, question_text, question_type, options, correct_answer, explanation, difficulty, topic_id, image_url),
    test_sections(id, title)
  )
`;

@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);
  private readonly redis: Redis;

  constructor(
    private readonly supabaseService: SupabaseService,
    redisService: RedisService,
    @Optional() private readonly evaluationService?: EvaluationService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  async startAttempt(testId: string, userId: string, dto: StartAttemptDto) {
    const { data: test, error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .select(TEST_FOR_ATTEMPT_SELECT)
      .eq('id', testId)
      .single();

    if (error || !test) throw new NotFoundException('Test not found');

    const validStatuses = ['published', 'scheduled', 'active'];
    if (!validStatuses.includes(test.status)) {
      throw new ForbiddenException('Test is not available for attempts');
    }

    const testBatchIds = (test.test_batches ?? []).map((b: any) => b.batch_id);
    if (testBatchIds.length > 0) {
      const { data: userBatches } = await this.supabaseService.client
        .from(TABLES.BATCH_STUDENTS)
        .select('batch_id')
        .eq('user_id', userId);

      const userBatchIds = (userBatches ?? []).map((b: any) => b.batch_id);
      const hasAccess = testBatchIds.some((id: string) => userBatchIds.includes(id));
      if (!hasAccess) {
        throw new ForbiddenException('You are not enrolled in any batch assigned to this test');
      }
    }

    const { count: completedCount } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('*', { count: 'exact', head: true })
      .eq('test_id', testId)
      .eq('user_id', userId)
      .neq('status', 'in_progress');

    if (test.max_attempts && (completedCount ?? 0) >= test.max_attempts) {
      throw new ForbiddenException('Maximum attempts reached for this test');
    }

    const { data: existingAttempt } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('*')
      .eq('test_id', testId)
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (existingAttempt) {
      return this.buildAttemptResponse(existingAttempt);
    }

    // Server-side availability window — controls STARTING a new attempt only
    // Resume (existing in_progress) is allowed even if window has closed.
    const now = new Date();
    if ((test as any).start_time) {
      const start = new Date((test as any).start_time);
      if (now < start) {
        throw new ForbiddenException('Test not yet available');
      }
    }
    if ((test as any).end_time) {
      const end = new Date((test as any).end_time);
      if (now > end) {
        throw new ForbiddenException('Test window closed');
      }
    }

    const timeRemainingSeconds = test.duration_minutes ? test.duration_minutes * 60 : null;

    const { data: attempt, error: insertError } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .insert({
        test_id: testId,
        user_id: userId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        current_question_index: 0,
        time_remaining_seconds: timeRemainingSeconds,
        device_fingerprint: dto.deviceFingerprint ?? null,
        attempt_number: (completedCount ?? 0) + 1,
      })
      .select()
      .single();

    if (insertError) {
      // Handle concurrent race: DB unique constraint caught a duplicate in_progress attempt
      if ((insertError as any).code === '23505') {
        this.logger.warn(`Race condition handled: duplicate in_progress attempt for user=${userId} test=${testId}`);
        const { data: existing } = await this.supabaseService.client
          .from(TABLES.TEST_ATTEMPTS)
          .select(ATTEMPT_WITH_ANSWERS_SELECT)
          .eq('test_id', testId)
          .eq('user_id', userId)
          .eq('status', 'in_progress')
          .single();

        if (existing) return this.buildAttemptResponse(existing);
      }
      throw insertError;
    }

    const questions = test.test_question_bank ?? [];
    if (questions.length > 0) {
      const ordered = [...questions];
      if (test.shuffle_questions) {
        for (let i = ordered.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        }
      }

      const answerRows = ordered.map((q: any) => ({
        attempt_id: attempt.id,
        question_id: q.question_bank_id,
        question_type: q.question_bank?.question_type ?? 'single_choice',
        marks_possible: q.marks ?? 1,
        marks_awarded: 0,
        is_correct: null,
        is_manual_review: false,
      }));

      const { error: answersError } = await this.supabaseService.client
        .from(TABLES.TEST_ANSWERS)
        .insert(answerRows);

      if (answersError) throw answersError;
    }

    if (timeRemainingSeconds) {
      await this.redis.setex(
        REDIS_KEYS.attemptTimer(attempt.id),
        REDIS_TTL.ATTEMPT_TIMER,
        timeRemainingSeconds.toString(),
      );
    }

    return this.buildAttemptResponse(attempt);
  }

  async getAttempt(attemptId: string, userId: string) {
    const { data: attempt, error } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select(ATTEMPT_WITH_ANSWERS_SELECT)
      .eq('id', attemptId)
      .single();

    if (error || !attempt) throw new NotFoundException('Attempt not found');
    if (attempt.user_id !== userId) throw new ForbiddenException('Access denied');

    const shuffled = this.maybeShuffleQuestions(attempt);
    return { ...attempt, test_answers: shuffled ?? attempt.test_answers };
  }

  async saveAnswer(attemptId: string, userId: string, dto: SaveAnswerDto) {
    const attempt = await this.verifyOwnership(attemptId, userId);

    if (attempt.status !== 'in_progress') {
      throw new ForbiddenException('Attempt is no longer in progress');
    }

    await this.assertNotExpired(attempt);
    await this.assertHasBatchAccess(attempt.test_id, userId);

    await this.validateQuestionsBelongToTest(attempt.test_id, [dto.questionId]);

    const marksPossible = await this.resolveMarksPossible(attempt.test_id, dto.questionId);

    const { error: upsertError } = await this.supabaseService.client
      .from(TABLES.TEST_ANSWERS)
      .upsert(
        {
          attempt_id: attemptId,
          question_id: dto.questionId,
          question_type: dto.questionType,
          answer: dto.answer,
          marks_possible: marksPossible,
        },
        { onConflict: 'attempt_id,question_id' },
      )
      .select()
      .single();

    if (upsertError) throw upsertError;

    const updates: Record<string, any> = { last_saved_at: new Date().toISOString() };
    if (dto.currentQuestionIndex !== undefined) updates.current_question_index = dto.currentQuestionIndex;
    if (dto.timeRemainingSeconds !== undefined) {
      updates.time_remaining_seconds = await this.clampTimeRemaining(dto.timeRemainingSeconds, attempt);
    }

    await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .update(updates)
      .eq('id', attemptId);

    await this.saveCheckpoint(attemptId);

    return { saved: true };
  }

  async saveAllAnswers(attemptId: string, userId: string, answers: SaveAnswerDto[]) {
    const attempt = await this.verifyOwnership(attemptId, userId);

    if (attempt.status !== 'in_progress') {
      throw new ForbiddenException('Attempt is no longer in progress');
    }

    await this.assertNotExpired(attempt);
    await this.assertHasBatchAccess(attempt.test_id, userId);

    await this.validateQuestionsBelongToTest(attempt.test_id, answers.map((a) => a.questionId));

    const marksMap = await this.resolveMarksMap(attempt.test_id, answers.map((a) => a.questionId));

    for (const answer of answers) {
      const { error } = await this.supabaseService.client
        .from(TABLES.TEST_ANSWERS)
        .upsert(
          {
            attempt_id: attemptId,
            question_id: answer.questionId,
            question_type: answer.questionType,
            answer: answer.answer,
            marks_possible: marksMap.get(answer.questionId) ?? 1,
          },
          { onConflict: 'attempt_id,question_id' },
        );

      if (error) throw error;
    }

    const lastAnswer = answers[answers.length - 1];
    const updates: Record<string, any> = { last_saved_at: new Date().toISOString() };
    if (lastAnswer?.currentQuestionIndex !== undefined) updates.current_question_index = lastAnswer.currentQuestionIndex;
    if (lastAnswer?.timeRemainingSeconds !== undefined) {
      updates.time_remaining_seconds = await this.clampTimeRemaining(lastAnswer.timeRemainingSeconds, attempt);
    }

    await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .update(updates)
      .eq('id', attemptId);

    await this.saveCheckpoint(attemptId);

    return { saved: true, count: answers.length };
  }

  async submitAttempt(attemptId: string, userId: string, dto: SubmitAttemptDto) {
    const attempt = await this.verifyOwnership(attemptId, userId);

    if (attempt.status !== 'in_progress') {
      throw new ForbiddenException('Attempt is no longer in progress');
    }

    await this.assertNotExpired(attempt);
    await this.assertHasBatchAccess(attempt.test_id, userId);

    await this.validateQuestionsBelongToTest(attempt.test_id, dto.answers.map((a) => a.questionId));

    const submitMarksMap = await this.resolveMarksMap(attempt.test_id, dto.answers.map((a) => a.questionId));

    for (const answer of dto.answers) {
      const { error } = await this.supabaseService.client
        .from(TABLES.TEST_ANSWERS)
        .upsert(
          {
            attempt_id: attemptId,
            question_id: answer.questionId,
            question_type: answer.questionType,
            answer: answer.answer,
            marks_possible: submitMarksMap.get(answer.questionId) ?? 1,
          },
          { onConflict: 'attempt_id,question_id' },
        );

      if (error) throw error;
    }

    const clampedRemaining =
      dto.timeRemainingSeconds !== undefined
        ? await this.clampTimeRemaining(dto.timeRemainingSeconds, attempt)
        : attempt.time_remaining_seconds;

    const { data: updated, error: updateError } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        time_remaining_seconds: clampedRemaining,
        last_saved_at: new Date().toISOString(),
      })
      .eq('id', attemptId)
      .select()
      .single();

    if (updateError) throw updateError;

    await this.redis.del(REDIS_KEYS.attemptTimer(attemptId));
    await this.redis.del(REDIS_KEYS.attemptCheckpoint(attemptId));

    // Instant results: auto-grade if test allows it
    try {
      const { data: testForGrade } = await this.supabaseService.client
        .from(TABLES.TESTS)
        .select('show_result_immediately')
        .eq('id', attempt.test_id)
        .single();
      if (testForGrade?.show_result_immediately && this.evaluationService) {
        await this.evaluationService.autoGradeAttempt(attemptId).catch((e) => {
          this.logger.warn(`Auto-grade failed for attempt ${attemptId}: ${(e as Error).message}`);
        });
      }
    } catch (e) {
      this.logger.warn(`Auto-grade check failed for ${attemptId}: ${(e as Error).message}`);
    }

    return updated;
  }

  async getAttemptsByUser(userId: string, options?: { page?: number; limit?: number }) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('*, test:test_id(*)', { count: 'exact' })
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return { items: data ?? [], total: count ?? 0, page, limit };
  }

  async getAttemptTimer(attemptId: string, userId: string) {
    // Verify ownership first — prevents Redis cache leak for unowned attempts
    const { data: attempt, error } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('time_remaining_seconds, started_at, user_id, test:test_id(duration_minutes)')
      .eq('id', attemptId)
      .single();

    if (error || !attempt) throw new NotFoundException('Attempt not found');
    if (attempt.user_id !== userId) throw new ForbiddenException('Access denied');

    const key = REDIS_KEYS.attemptTimer(attemptId);
    const cached = await this.redis.get(key);

    if (cached !== null) {
      return { timeRemainingSeconds: parseInt(cached, 10) };
    }

    if (attempt.time_remaining_seconds !== null) {
      return { timeRemainingSeconds: attempt.time_remaining_seconds };
    }

    const test = attempt.test as any;
    if (test?.duration_minutes && attempt.started_at) {
      const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
      const remaining = Math.max(0, test.duration_minutes * 60 - elapsed);
      return { timeRemainingSeconds: Math.floor(remaining) };
    }

    return { timeRemainingSeconds: null };
  }

  private async verifyOwnership(attemptId: string, userId: string) {
    const { data: attempt, error } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('*')
      .eq('id', attemptId)
      .single();

    if (error || !attempt) throw new NotFoundException('Attempt not found');
    if (attempt.user_id !== userId) throw new ForbiddenException('Access denied');
    return attempt;
  }

  private async assertHasBatchAccess(testId: string, userId: string): Promise<void> {
    const { data: test, error } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .select('id, test_batches(batch_id)')
      .eq('id', testId)
      .single();
    if (error || !test) throw new NotFoundException('Test not found');
    const testBatchIds = ((test as any).test_batches ?? []).map((b: any) => b.batch_id);
    if (testBatchIds.length === 0) return; // open test
    const { data: userBatches } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);
    const userBatchIds = (userBatches ?? []).map((b: any) => b.batch_id);
    const hasAccess = testBatchIds.some((id: string) => userBatchIds.includes(id));
    if (!hasAccess) {
      throw new ForbiddenException('You are no longer enrolled in this test');
    }
  }

  private async getDurationForAttempt(attempt: any): Promise<number | null> {
    if (attempt?.test?.duration_minutes != null) return attempt.test.duration_minutes;
    if ((attempt as any)?.duration_minutes != null) return (attempt as any).duration_minutes;
    // Fetch authoritative duration from tests table
    try {
      const { data: test } = await this.supabaseService.client
        .from(TABLES.TESTS)
        .select('duration_minutes')
        .eq('id', attempt.test_id)
        .single();
      return (test as any)?.duration_minutes ?? null;
    } catch {
      return null;
    }
  }

  private async getServerRemainingSeconds(attempt: any): Promise<number | null> {
    const duration = await this.getDurationForAttempt(attempt);
    if (duration == null || !attempt?.started_at) return null;
    const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
    return Math.floor(duration * 60 - elapsed);
  }

  private async assertNotExpired(attempt: any): Promise<void> {
    const remaining = await this.getServerRemainingSeconds(attempt);
    if (remaining == null) return;
    if (remaining <= 0) {
      // Transition to terminal state idempotently — only if still in_progress
      try {
        await this.supabaseService.client
          .from(TABLES.TEST_ATTEMPTS)
          .update({
            status: 'submitted',
            submitted_at: new Date().toISOString(),
            time_remaining_seconds: 0,
            last_saved_at: new Date().toISOString(),
          })
          .eq('id', attempt.id)
          .eq('status', 'in_progress');
      } catch {}
      try {
        await this.redis.del(REDIS_KEYS.attemptTimer(attempt.id));
        await this.redis.del(REDIS_KEYS.attemptCheckpoint(attempt.id));
      } catch {}
      throw new ForbiddenException('Time expired');
    }
  }

  private async saveCheckpoint(attemptId: string) {
    const { data: attempt } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('current_question_index, time_remaining_seconds')
      .eq('id', attemptId)
      .single();

    if (attempt) {
      await this.redis.setex(
        REDIS_KEYS.attemptCheckpoint(attemptId),
        REDIS_TTL.ATTEMPT_CHECKPOINT,
        JSON.stringify(attempt),
      );
    }
  }

  private async buildAttemptResponse(attempt: any) {
    const { data: answers } = await this.supabaseService.client
      .from(TABLES.TEST_ANSWERS)
      .select('*')
      .eq('attempt_id', attempt.id);

    const { data: test } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .select(TEST_FOR_ATTEMPT_SELECT)
      .eq('id', attempt.test_id)
      .single();

    return {
      ...attempt,
      test: test ?? null,
      questions: (test?.test_question_bank ?? []).map((q: any) => ({
        id: q.question_bank_id,
        question_text: q.question_bank?.question_text,
        question_type: q.question_bank?.question_type,
        options: q.question_bank?.options,
        marks: q.marks,
        negative_marks: q.negative_mark,
        sort_order: q.sort_order,
        section_title: q.test_sections?.title ?? null,
        image_url: q.question_bank?.image_url,
      })),
      test_answers: this.maybeShuffleQuestions({ ...attempt, test_answers: answers ?? [] }),
    };
  }

  private async validateQuestionsBelongToTest(testId: string, questionIds: string[]): Promise<void> {
    if (!questionIds.length) return;

    const { data: validQuestions, error } = await this.supabaseService.client
      .from(TABLES.TEST_QUESTION_BANK)
      .select('question_bank_id')
      .eq('test_id', testId);

    if (error) throw error;

    const validIds = new Set((validQuestions ?? []).map((q) => q.question_bank_id));
    for (const qid of questionIds) {
      if (!validIds.has(qid)) {
        throw new ForbiddenException(`Question ${qid} does not belong to this test`);
      }
    }
  }

  private maybeShuffleQuestions(attempt: any) {
    // test_answers have no sort_order column; rows are inserted in
    // test_question_bank.sort_order order at attempt creation, so order is
    // already correct (incl. after question shuffling).
    return attempt.test_answers;
  }

  private async resolveMarksPossible(testId: string, questionId: string): Promise<number> {
    const map = await this.resolveMarksMap(testId, [questionId]);
    return map.get(questionId) ?? 1;
  }

  private async resolveMarksMap(testId: string, questionIds: string[]): Promise<Map<string, number>> {
    if (!questionIds.length) return new Map();
    const { data } = await this.supabaseService.client
      .from(TABLES.TEST_QUESTION_BANK)
      .select('question_bank_id, marks')
      .eq('test_id', testId)
      .in('question_bank_id', questionIds);
    const map = new Map<string, number>();
    const rows: any[] = Array.isArray(data) ? data : [];
    for (const row of rows) {
      if (row?.question_bank_id) map.set(row.question_bank_id, row.marks ?? 1);
    }
    return map;
  }

  private async clampTimeRemaining(clientValue: number, attempt: any): Promise<number> {
    const raw = Math.floor(clientValue);
    if (!attempt?.started_at) return Math.max(0, raw);
    let duration: number | null = attempt.test?.duration_minutes ?? (attempt as any)?.duration_minutes ?? null;
    if (duration == null) {
      duration = await this.getDurationForAttempt(attempt);
    }
    if (duration == null) return Math.max(0, raw);
    const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
    const serverRemaining = Math.max(0, Math.floor(duration * 60 - elapsed));
    return Math.min(raw, serverRemaining);
  }
}
