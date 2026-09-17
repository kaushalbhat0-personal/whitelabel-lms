import { Injectable, Logger, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';

@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);
  private readonly dashboardProjection = 'id, attempt_id, test_id, test_title:tests(title), percentage, rank, passed, obtained_marks, total_marks, published_at';

  constructor(private readonly supabaseService: SupabaseService, @Optional() private readonly redisCache?: RedisCacheService) {}

  async getStudentResult(attemptId: string, userId: string) {
    // Verify ownership and fetch full attempt for fallback
    const { data: attempt, error: attemptError } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('user_id, test_id, status, started_at, submitted_at, time_remaining_seconds')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempt.user_id !== userId) {
      throw new ForbiddenException('You do not own this attempt');
    }

    if (attempt.status === 'in_progress') {
      throw new NotFoundException('Result not available — attempt still in progress');
    }

    // Fetch test to check result visibility
    const { data: test, error: testError } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .select('title, total_marks, passing_marks, duration_minutes, show_result_immediately')
      .eq('id', attempt.test_id)
      .single();

    if (testError || !test) {
      throw new NotFoundException('Test not found');
    }

    // Fetch result with test join
    const { data: result } = await this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select(`
        *,
        test:${TABLES.TESTS}(title, total_marks, passing_marks, duration_minutes, show_result_immediately)
      `)
      .eq('attempt_id', attemptId)
      .maybeSingle();

    // If published result exists, return it (respect show_result_immediately)
    if (result) {
      const showResults = (result as any).test?.show_result_immediately !== false;

      const base = {
        obtained_marks: result.obtained_marks,
        total_marks: result.total_marks,
        percentage: result.percentage,
        rank: result.rank,
        total_attempts: result.total_attempts,
        accuracy: result.accuracy,
        topic_analysis: result.topic_analysis,
        question_analysis: result.question_analysis,
        teacher_feedback: result.teacher_feedback,
        passed: result.passed,
        duration_seconds: result.duration_seconds,
        published_at: result.published_at,
        status: 'published',
        is_published: true,
        attempt_status: attempt.status,
      };

      if (!showResults) {
        return base;
      }

      // Fetch answers with question_bank details for full review
      const { data: answers } = await this.supabaseService.client
        .from(TABLES.TEST_ANSWERS)
        .select(`*, question_bank!inner(id, question_text, question_type, options, correct_answer, image_url, explanation, difficulty, topic_id)`)
        .eq('attempt_id', attemptId);

      const sanitizeWithQuestion = (rows: any[]) =>
        (rows ?? []).map((a: any) => ({
          id: a.id,
          question_id: a.question_id,
          question_type: a.question_type,
          answer: a.answer,
          marks_possible: a.marks_possible ?? null,
          marks_awarded: showResults ? (a.marks_awarded ?? null) : null,
          is_correct: showResults ? (a.is_correct ?? null) : null,
          is_manual_review: a.is_manual_review ?? null,
          feedback: a.feedback ?? null,
          question_text: a.question_bank?.question_text ?? null,
          options: a.question_bank?.options ?? null,
          correct_answer: showResults ? (a.question_bank?.correct_answer ?? null) : null,
          image_url: a.question_bank?.image_url ?? null,
          explanation: showResults ? (a.question_bank?.explanation ?? null) : null,
          difficulty: a.question_bank?.difficulty ?? null,
          topic_id: a.question_bank?.topic_id ?? null,
        }));

      return {
        ...base,
        answers: sanitizeWithQuestion(answers ?? []),
        question_analysis: (result as any).question_analysis ?? null,
        topic_analysis: (result as any).topic_analysis ?? null,
      };
    }

    // No published result yet — build interim result from graded answers
    // This covers manual-review pending (partially_evaluated / evaluated without publish)
    const { data: answers } = await this.supabaseService.client
      .from(TABLES.TEST_ANSWERS)
      .select(`*, question_bank!inner(id, question_text, question_type, options, correct_answer, image_url, explanation, difficulty, topic_id)`)
      .eq('attempt_id', attemptId);

    const answerRows = answers ?? [];
    const manualPending = answerRows.some((a: any) => a.is_manual_review === true);
    const hasAnyGrading = answerRows.some((a: any) => a.marks_awarded != null || a.is_correct != null);

    // If submission hasn't been auto-graded at all, trigger hint for caller
    if (!hasAnyGrading && !manualPending && attempt.status === 'submitted') {
      // Still return interim with zero progress rather than 404
      this.logger.warn(`Interim result: attempt ${attemptId} submitted but no grading yet`);
    }

    const obtainedMarks = answerRows.reduce((sum: number, a: any) => sum + (a.marks_awarded ?? 0), 0);
    const totalMarks = (test as any).total_marks ?? 0;
    const totalQuestions = answerRows.length;
    const correctCount = answerRows.filter((a: any) => a.is_correct === true).length;
    const incorrectCount = answerRows.filter((a: any) => a.is_correct === false).length;
    const pendingCount = answerRows.filter((a: any) => a.is_manual_review === true).length;
    const unansweredCount = answerRows.filter((a: any) => a.answer == null || a.answer === '' || (Array.isArray(a.answer) && a.answer.length === 0)).length;
    const accuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 10000) / 100 : 0;
    const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 10000) / 100 : 0;
    const durationSeconds =
      attempt.started_at && attempt.submitted_at
        ? Math.round((new Date(attempt.submitted_at).getTime() - new Date(attempt.started_at).getTime()) / 1000)
        : null;

    // Build question_analysis for interim so frontend can display per-question review even before publish
    const interimQuestionAnalysis = answerRows.map((a: any) => ({
      questionId: a.question_bank?.id ?? a.question_id,
      questionText: a.question_bank?.question_text ?? null,
      questionType: a.question_bank?.question_type ?? a.question_type,
      options: a.question_bank?.options ?? null,
      correctAnswer: a.question_bank?.correct_answer ?? null,
      userAnswer: a.answer,
      isCorrect: a.is_correct,
      isManualReview: a.is_manual_review,
      marksPossible: a.marks_possible ?? 1,
      marksAwarded: a.marks_awarded ?? 0,
      feedback: a.feedback ?? null,
      imageUrl: a.question_bank?.image_url ?? null,
    }));

    const sanitizedInterimAnswers = answerRows.map((a: any) => ({
      id: a.id,
      question_id: a.question_id,
      question_type: a.question_type,
      question_text: a.question_bank?.question_text ?? null,
      options: a.question_bank?.options ?? null,
      correct_answer: a.question_bank?.correct_answer ?? null,
      image_url: a.question_bank?.image_url ?? null,
      answer: a.answer,
      marks_possible: a.marks_possible ?? null,
      marks_awarded: a.marks_awarded ?? null,
      is_correct: a.is_correct ?? null,
      is_manual_review: a.is_manual_review ?? null,
      feedback: a.feedback ?? null,
    }));

    return {
      obtained_marks: obtainedMarks,
      total_marks: totalMarks,
      percentage,
      rank: null,
      total_attempts: 1,
      accuracy,
      topic_analysis: null,
      question_analysis: interimQuestionAnalysis,
      teacher_feedback: null,
      passed: totalMarks > 0 ? obtainedMarks >= ((test as any).passing_marks ?? 0) : false,
      duration_seconds: durationSeconds,
      published_at: attempt.submitted_at,
      status: manualPending ? 'pending_review' : attempt.status,
      is_published: false,
      is_pending_review: manualPending,
      attempt_status: attempt.status,
      pending_review_count: pendingCount,
      total_questions: totalQuestions,
      correct_answers: correctCount,
      incorrect_answers: incorrectCount,
      unanswered_count: unansweredCount,
      answers: sanitizedInterimAnswers,
      test_title: (test as any).title,
    };
  }

  async getMyResults(
    userId: string,
    options?: { page?: number; limit?: number },
  ) {
    if (!this.redisCache) return this.fetchMyResults(userId, options);
    const cacheKey = this.redisCache.key('results', userId, String(options?.page ?? 1), String(options?.limit ?? 50));
    return this.redisCache.wrap(cacheKey, 300, async () => this.fetchMyResults(userId, options));
  }

  async getDashboardResults(userId: string) {
    if (!this.redisCache) return this.fetchMyResults(userId, { page: 1, limit: 5 });
    const cacheKey = this.redisCache.key('results', userId, 'dashboard');
    return this.redisCache.wrap(cacheKey, 300, async () => {
      const r = await this.fetchMyResults(userId, { page: 1, limit: 5 });
      // projection already slim; ensure no large JSON leaked
      return r;
    });
  }

  private async fetchMyResults(
    userId: string,
    options?: { page?: number; limit?: number },
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const query = this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select(`
        id, attempt_id, test_id, obtained_marks, total_marks, percentage, rank, passed, published_at,
        test:${TABLES.TESTS}(id, title)
      `, { count: 'exact' })
      .eq('user_id', userId)
      .order('published_at', { ascending: false })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      attempt_id: r.attempt_id,
      test_id: r.test_id,
      test_title: r.test?.title ?? null,
      percentage: r.percentage,
      rank: r.rank,
      passed: r.passed,
      obtained_marks: r.obtained_marks,
      total_marks: r.total_marks,
      published_at: r.published_at,
    }));

    return { items, total: count ?? 0, page, limit };
  }

  async getTestResults(
    testId: string,
    options?: { page?: number; limit?: number; orderBy?: string },
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const orderColumn = options?.orderBy === 'marks' ? 'obtained_marks' : 'rank';

    const query = this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select(`
        *,
        profile:${TABLES.PROFILES}!user_id(id, name, email)
      `, { count: 'exact' })
      .eq('test_id', testId)
      .order(orderColumn, { ascending: true })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      student_name: r.profile?.name ?? null,
      student_email: r.profile?.email ?? null,
      obtained_marks: r.obtained_marks,
      total_marks: r.total_marks,
      percentage: r.percentage,
      rank: r.rank,
      duration_seconds: r.duration_seconds,
      passed: r.passed,
      published_at: r.published_at,
    }));

    return { items, total: count ?? 0, page, limit };
  }

  async getTestAnalytics(testId: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.TEST_ANALYTICS_SNAPSHOTS)
      .select('*')
      .eq('test_id', testId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      throw new NotFoundException('No analytics snapshot found for this test');
    }

    return {
      total_attempts: data.total_attempts,
      average_score: data.average_score,
      highest_score: data.highest_score,
      lowest_score: data.lowest_score,
      median_score: data.median_score,
      pass_rate: data.pass_rate,
      average_accuracy: data.average_accuracy,
      average_duration_seconds: data.average_duration_seconds,
      question_performance: data.question_performance,
      topic_performance: data.topic_performance,
      batch_performance: data.batch_performance,
    };
  }

  async getStudentAnalytics(userId: string) {
    const { data: results, error } = await this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select(`
        *,
        test:${TABLES.TESTS}(id, title)
      `)
      .eq('user_id', userId)
      .order('published_at', { ascending: false });

    if (error) throw error;

    if (!results || results.length === 0) {
      return {
        total_tests_taken: 0,
        average_percentage: 0,
        best_percentage: 0,
        worst_percentage: 0,
        topic_strengths: [],
        topic_weaknesses: [],
        recent_trend: [],
      };
    }

    const percentages = results.map((r: any) => r.percentage);
    const averagePercentage = percentages.reduce((a: number, b: number) => a + b, 0) / percentages.length;
    const bestPercentage = Math.max(...percentages);
    const worstPercentage = Math.min(...percentages);

    // Aggregate topic analysis across all results
    const topicMap = new Map<string, { total: number; correct: number }>();
    for (const r of results) {
      const topicAnalysis = r.topic_analysis;
      if (Array.isArray(topicAnalysis)) {
        for (const topic of topicAnalysis) {
          const name = topic.name ?? topic.topicId ?? topic.topic ?? String(topic.topic_id ?? 'unknown');
          const total = topic.total_questions ?? topic.total ?? topic.totalQuestions ?? 0;
          const correct = topic.correct_answers ?? topic.correct ?? topic.correctAnswers ?? 0;
          const existing = topicMap.get(name) ?? { total: 0, correct: 0 };
          existing.total += total;
          existing.correct += correct;
          topicMap.set(name, existing);
        }
      }
    }

    const topicStrengths: string[] = [];
    const topicWeaknesses: string[] = [];
    for (const [name, stats] of topicMap) {
      const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
      if (accuracy > 0.7) topicStrengths.push(name);
      if (accuracy < 0.4) topicWeaknesses.push(name);
    }

    const recentTrend = results.slice(0, 5).map((r: any) => ({
      test_id: r.test_id,
      test_title: r.test?.title ?? null,
      percentage: r.percentage,
      passed: r.passed,
      published_at: r.published_at,
    }));

    return {
      total_tests_taken: results.length,
      average_percentage: Math.round(averagePercentage * 100) / 100,
      best_percentage: bestPercentage,
      worst_percentage: worstPercentage,
      topicStrengths,
      topicWeaknesses,
      recent_trend: recentTrend,
    };
  }

  async getOverallAnalytics(options?: { batchId?: string }) {
    const [testCount, resultCount, allResults, studentsResult] =
      await Promise.all([
        // Total tests
        this.supabaseService.client
          .from(TABLES.TESTS)
          .select('id', { count: 'exact', head: true }),

        // Total published results
        this.supabaseService.client
          .from(TABLES.TEST_RESULTS)
          .select('id', { count: 'exact', head: true }),

        // All published results for aggregation
        this.supabaseService.client
          .from(TABLES.TEST_RESULTS)
          .select('percentage, passed, user_id'),

        // Distinct students who attempted tests
        this.supabaseService.client
          .from(TABLES.TEST_RESULTS)
          .select('user_id'),
      ]);

    const totalTests = (testCount as any).count ?? 0;
    const totalAttempts = (resultCount as any).count ?? 0;
    const results = (allResults.data ?? []) as any[];

    let totalStudents = 0;
    if (studentsResult.data) {
      const uniqueStudents = new Set(studentsResult.data.map((r: any) => r.user_id));
      totalStudents = uniqueStudents.size;
    }

    const overallAverage = results.length > 0
      ? results.reduce((sum: number, r: any) => sum + r.percentage, 0) / results.length
      : 0;

    const passed = results.filter((r: any) => r.passed).length;
    const failed = results.length - passed;

    let performanceByBatch: any[] = [];

    if (options?.batchId) {
      // Resolve users in the batch via batch_students (profiles has no batch_id)
      const { data: memberships } = await this.supabaseService.client
        .from(TABLES.BATCH_STUDENTS)
        .select('user_id')
        .eq('batch_id', options.batchId);

      const userIds = (memberships ?? []).map((m: any) => m.user_id);
      if (userIds.length > 0) {
        const { data: batchResults } = await this.supabaseService.client
          .from(TABLES.TEST_RESULTS)
          .select('percentage, passed')
          .in('user_id', userIds);

        if (batchResults && batchResults.length > 0) {
          const batchPercentages = batchResults.map((r: any) => r.percentage);
          const batchAvg = batchPercentages.reduce((a: number, b: number) => a + b, 0) / batchPercentages.length;
          const batchPassed = batchResults.filter((r: any) => r.passed).length;

          performanceByBatch = [{
            batch_id: options.batchId,
            attempts: batchResults.length,
            average_percentage: Math.round(batchAvg * 100) / 100,
            pass_rate: Math.round((batchPassed / batchResults.length) * 10000) / 100,
          }];
        }
      }
    }

    return {
      total_tests: totalTests,
      total_attempts: totalAttempts,
      overall_average: Math.round(overallAverage * 100) / 100,
      total_students_attempted: totalStudents,
      tests_by_status: { passed, failed },
      performance_by_batch: performanceByBatch,
    };
  }
}
