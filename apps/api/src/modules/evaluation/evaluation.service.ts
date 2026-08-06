import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { AttemptStatus, ReviewStatus, QuestionType } from '@lms/shared-types';
import { Transaction } from '../../common/utils/transaction.util';

export interface AutoGradeSummary {
  total: number;
  autoGraded: number;
  correct: number;
  incorrect: number;
  manualReview: number;
  marksAwarded: number;
  marksPossible: number;
}

interface ReviewQueueOptions {
  status?: string;
  assignedTo?: string;
  testId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Fetch test_answers enriched with question_bank + test_question_bank data.
   * Uses FK from test_answers.question_id -> question_bank.id (added in migration 014).
   * Fetches test_question_bank separately and merges in-memory.
   */
  private async fetchAnswersWithQuestions(
    attemptIds: string | string[],
    testId: string,
  ): Promise<any[]> {
    const ids = Array.isArray(attemptIds) ? attemptIds : [attemptIds];

    const { data: answers, error } = await this.supabaseService.client
      .from(TABLES.TEST_ANSWERS)
      .select(`*, question_bank!inner(*)`)
      .in('attempt_id', ids);

    if (error) throw error;
    if (!answers?.length) return [];

    const { data: tqbRecords } = await this.supabaseService.client
      .from(TABLES.TEST_QUESTION_BANK)
      .select('*')
      .eq('test_id', testId);

    const tqbByQuestionBankId = new Map(
      (tqbRecords ?? []).map((t) => [t.question_bank_id, t]),
    );

    return (answers ?? []).map((a) => ({
      ...a,
      tqb: tqbByQuestionBankId.get(a.question_id) ?? {},
    }));
  }

  async autoGradeAttempt(attemptId: string): Promise<{ summary: AutoGradeSummary; attempt: any }> {
    const { data: attempt, error: attemptError } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('*')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) throw new NotFoundException('Attempt not found');

    const { data: test, error: testError } = await this.supabaseService.client
      .from(TABLES.TESTS)
      .select('*')
      .eq('id', attempt.test_id)
      .single();

    if (testError || !test) throw new NotFoundException('Test not found');

    const answers = await this.fetchAnswersWithQuestions(attemptId, test.id);
    if (!answers.length) throw new NotFoundException('No answers found for this attempt');

    const autoGradableTypes = new Set([
      QuestionType.SINGLE_CHOICE,
      QuestionType.MULTIPLE_CHOICE,
      QuestionType.TRUE_FALSE,
      QuestionType.NUMERICAL,
    ]);

    const summary: AutoGradeSummary = {
      total: answers.length,
      autoGraded: 0,
      correct: 0,
      incorrect: 0,
      manualReview: 0,
      marksAwarded: 0,
      marksPossible: 0,
    };

    const reviewQueueEntries: { attempt_id: string; answer_id: string; test_id: string; question_id: string }[] = [];

    for (const answer of answers) {
      const questionBank = answer.question_bank;
      const tqb = answer.tqb;
      const marksPossible = tqb.marks ?? answer.marks_possible ?? 1;
      const negativeMark = tqb.negative_mark ?? 0;
      summary.marksPossible += marksPossible;

      const questionType = questionBank.question_type;
      const correctAnswer = questionBank.correct_answer;

      if (!correctAnswer || !autoGradableTypes.has(questionType)) {
        const { error: updateError } = await this.supabaseService.client
          .from(TABLES.TEST_ANSWERS)
          .update({
            is_manual_review: true,
            evaluated_at: new Date().toISOString(),
          })
          .eq('id', answer.id);

        if (updateError) this.logger.error(`Failed to mark answer ${answer.id} for manual review`, updateError);

        reviewQueueEntries.push({
          attempt_id: attemptId,
          answer_id: answer.id,
          test_id: test.id,
          question_id: questionBank.id,
        });

        summary.manualReview++;
        continue;
      }

      const isCorrect = this.evaluateAnswer(questionType, answer.answer, correctAnswer);
      const marksAwarded = isCorrect ? marksPossible : (test.negative_marking ? -Math.abs(negativeMark) : 0);

      const { error: updateError } = await this.supabaseService.client
        .from(TABLES.TEST_ANSWERS)
        .update({
          is_correct: isCorrect,
          marks_awarded: marksAwarded,
          evaluated_at: new Date().toISOString(),
        })
        .eq('id', answer.id);

      if (updateError) {
        this.logger.error(`Failed to update answer ${answer.id}`, updateError);
        continue;
      }

      summary.autoGraded++;
      summary.marksAwarded += marksAwarded;

      if (isCorrect) {
        summary.correct++;
      } else {
        summary.incorrect++;
      }
    }

    if (reviewQueueEntries.length > 0) {
      const { error: queueError } = await this.supabaseService.client
        .from(TABLES.TEST_REVIEW_QUEUE)
        .insert(reviewQueueEntries.map((entry) => ({
          attempt_id: entry.attempt_id,
          answer_id: entry.answer_id,
          test_id: entry.test_id,
          question_id: entry.question_id,
          status: ReviewStatus.PENDING,
        })));

      if (queueError) this.logger.error('Failed to create review queue entries', queueError);
    }

    const newStatus = summary.manualReview === 0
      ? AttemptStatus.EVALUATED
      : AttemptStatus.PARTIALLY_EVALUATED;

    const { error: statusError } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .update({
        status: newStatus,
        last_saved_at: new Date().toISOString(),
      })
      .eq('id', attemptId);

    if (statusError) throw statusError;

    if (newStatus === AttemptStatus.EVALUATED) {
      await this.publishResults(attemptId).catch((err) =>
        this.logger.error('Auto-publish failed', err),
      );
    }

    return { summary, attempt: { ...attempt, status: newStatus } };
  }

  private evaluateAnswer(questionType: string, userAnswer: any, correctAnswer: string): boolean {
    if (userAnswer === null || userAnswer === undefined || userAnswer === '') return false;

    try {
      switch (questionType) {
        case QuestionType.SINGLE_CHOICE:
          return String(userAnswer).trim() === String(correctAnswer).trim();

        case QuestionType.MULTIPLE_CHOICE: {
          const userKeys = this.parseMultiChoiceAnswer(userAnswer);
          const correctKeys = this.parseMultiChoiceAnswer(correctAnswer);
          if (userKeys.length !== correctKeys.length) return false;
          const sortedUser = [...userKeys].sort();
          const sortedCorrect = [...correctKeys].sort();
          return sortedUser.every((key, i) => key === sortedCorrect[i]);
        }

        case QuestionType.TRUE_FALSE:
          return String(userAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();

        case QuestionType.NUMERICAL: {
          const userNum = parseFloat(String(userAnswer).trim());
          const correctNum = parseFloat(String(correctAnswer).trim());
          if (isNaN(userNum) || isNaN(correctNum)) return false;
          return Math.abs(userNum - correctNum) <= 0.01;
        }

        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private parseMultiChoiceAnswer(answer: any): string[] {
    if (Array.isArray(answer)) return answer.map(String);
    if (typeof answer === 'string') {
      return answer
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  async getReviewQueue(options: ReviewQueueOptions = {}) {
    let query = this.supabaseService.client
      .from(TABLES.TEST_REVIEW_QUEUE)
      .select(`
        *,
        test_attempts!inner(
          id,
          status,
          submitted_at,
          user_id,
          profiles!inner(id, name, email)
        ),
        test_answers!inner(
          id,
          answer,
          marks_possible,
          question_id,
          question_bank!inner(id, question_text, question_type)
        )
      `)
      .order('created_at', { ascending: false });

    if (options.status) query = query.eq('status', options.status);
    if (options.assignedTo) query = query.eq('assigned_to', options.assignedTo);
    if (options.testId) query = query.eq('test_attempts.test_id', options.testId);

    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error } = await query;
    if (error) throw error;

    return { items: data ?? [], page, limit };
  }

  async assignForReview(reviewId: string, reviewerId: string) {
    const { data: existing, error: fetchError } = await this.supabaseService.client
      .from(TABLES.TEST_REVIEW_QUEUE)
      .select('id, status')
      .eq('id', reviewId)
      .single();

    if (fetchError || !existing) throw new NotFoundException('Review queue item not found');

    const { error } = await this.supabaseService.client
      .from(TABLES.TEST_REVIEW_QUEUE)
      .update({
        assigned_to: reviewerId,
        status: ReviewStatus.IN_REVIEW,
      })
      .eq('id', reviewId);

    if (error) throw error;

    return { id: reviewId, assignedTo: reviewerId, status: ReviewStatus.IN_REVIEW };
  }

  async submitReview(reviewId: string, dto: { marksAwarded: number; feedback?: string }, evaluatedBy: string) {
    const { data: reviewItem, error: reviewError } = await this.supabaseService.client
      .from(TABLES.TEST_REVIEW_QUEUE)
      .select('*, test_answers!inner(*)')
      .eq('id', reviewId)
      .single();

    if (reviewError || !reviewItem) throw new NotFoundException('Review queue item not found');

    const answerBefore = reviewItem.test_answers;
    const oldStatus = reviewItem.status;
    const attemptId = reviewItem.attempt_id;

    const tx = new Transaction();
    await tx.run([
      {
        name: 'update test_answer',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.TEST_ANSWERS)
            .update({
              marks_awarded: dto.marksAwarded,
              feedback: dto.feedback ?? null,
              evaluated_by: evaluatedBy,
              evaluated_at: new Date().toISOString(),
              is_manual_review: false,
            })
            .eq('id', reviewItem.answer_id);
          if (error) throw error;
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.TEST_ANSWERS)
            .update({
              marks_awarded: answerBefore.marks_awarded,
              feedback: answerBefore.feedback,
              evaluated_by: answerBefore.evaluated_by,
              evaluated_at: answerBefore.evaluated_at,
              is_manual_review: answerBefore.is_manual_review,
            })
            .eq('id', reviewItem.answer_id);
        },
      },
      {
        name: 'update review_queue status',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.TEST_REVIEW_QUEUE)
            .update({
              status: ReviewStatus.REVIEWED,
              reviewed_at: new Date().toISOString(),
            })
            .eq('id', reviewId);
          if (error) throw error;
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.TEST_REVIEW_QUEUE)
            .update({
              status: oldStatus,
              reviewed_at: null,
            })
            .eq('id', reviewId);
        },
      },
    ]);

    const allManualReviewed = await this.checkAllManualReviewsComplete(attemptId);
    if (allManualReviewed) {
      const { data: attemptBefore } = await this.supabaseService.client
        .from(TABLES.TEST_ATTEMPTS)
        .select('status')
        .eq('id', attemptId)
        .single();

      const prevStatus = (attemptBefore as any)?.status;

      const { error: statusError } = await this.supabaseService.client
        .from(TABLES.TEST_ATTEMPTS)
        .update({ status: AttemptStatus.EVALUATED, last_saved_at: new Date().toISOString() })
        .eq('id', attemptId);

      if (statusError) {
        await this.supabaseService.client
          .from(TABLES.TEST_ANSWERS)
          .update({
            is_manual_review: answerBefore.is_manual_review,
          })
          .eq('id', reviewItem.answer_id);

        await this.supabaseService.client
          .from(TABLES.TEST_REVIEW_QUEUE)
          .update({ status: oldStatus, reviewed_at: null })
          .eq('id', reviewId);

        throw statusError;
      }

      await this.publishResults(attemptId).catch(async (err) => {
        this.logger.error('Auto-publish after review failed', err);
        await this.supabaseService.client
          .from(TABLES.TEST_ATTEMPTS)
          .update({ status: prevStatus, last_saved_at: new Date().toISOString() })
          .eq('id', attemptId);
      });
    }

    return { id: reviewId, status: ReviewStatus.REVIEWED };
  }

  private async checkAllManualReviewsComplete(attemptId: string): Promise<boolean> {
    const { count, error } = await this.supabaseService.client
      .from(TABLES.TEST_REVIEW_QUEUE)
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', attemptId)
      .neq('status', ReviewStatus.REVIEWED);

    if (error) {
      this.logger.error('Failed to check manual review status', error);
      return false;
    }

    return count === 0;
  }

  async publishResults(attemptId: string) {
    const { data: attempt, error: attemptError } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('*, tests(*)')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) throw new NotFoundException('Attempt not found');

    const answers = await this.fetchAnswersWithQuestions(attemptId, attempt.test_id);
    if (!answers.length) throw new NotFoundException('No answers found for this attempt');

    const totalMarks = attempt.tests.total_marks;
    const obtainedMarks = answers.reduce((sum, a) => sum + (a.marks_awarded ?? 0), 0);
    const totalQuestions = answers.length;
    const correctAnswers = answers.filter((a) => a.is_correct === true).length;
    const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 10000) / 100 : 0;
    const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 10000) / 100 : 0;

    const rank = await this.calculateRank(attempt.test_id, obtainedMarks, attemptId);
    const topicAnalysis = this.buildTopicAnalysis(answers);
    const questionAnalysis = this.buildQuestionAnalysis(answers);
    const passingMarks = attempt.tests?.passing_marks ?? 0;

    const payload = {
      attempt_id: attemptId,
      test_id: attempt.test_id,
      user_id: attempt.user_id,
      obtained_marks: obtainedMarks,
      total_marks: totalMarks,
      percentage,
      accuracy,
      rank,
      passed: obtainedMarks >= passingMarks,
      topic_analysis: topicAnalysis,
      question_analysis: questionAnalysis,
      published_at: new Date().toISOString(),
    };

    const { data: existing } = await this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select('id')
      .eq('attempt_id', attemptId)
      .maybeSingle();

    let resultId: string | null = null;
    let isNewResult = false;

    const tx = new Transaction();
    await tx.run([
      {
        name: 'upsert test_results',
        execute: async () => {
          if (existing) {
            resultId = existing.id;
            const { error } = await this.supabaseService.client
              .from(TABLES.TEST_RESULTS)
              .update(payload)
              .eq('id', existing.id);
            if (error) throw error;
          } else {
            isNewResult = true;
            const { data, error } = await this.supabaseService.client
              .from(TABLES.TEST_RESULTS)
              .insert(payload)
              .select('id')
              .single();
            if (error) throw error;
            resultId = data.id;
          }
        },
        rollback: async () => {
          if (isNewResult && resultId) {
            await this.supabaseService.client
              .from(TABLES.TEST_RESULTS)
              .delete()
              .eq('id', resultId);
          }
        },
      },
      {
        name: 'update attempt status to PUBLISHED',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.TEST_ATTEMPTS)
            .update({
              status: AttemptStatus.PUBLISHED,
              last_saved_at: new Date().toISOString(),
            })
            .eq('id', attemptId);
          if (error) throw error;
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.TEST_ATTEMPTS)
            .update({
              status: attempt.status,
              last_saved_at: new Date().toISOString(),
            })
            .eq('id', attemptId);
        },
      },
    ]);

    await this.calculateAnalytics(attempt.test_id).catch((err) =>
      this.logger.error('Analytics recalculation failed', err),
    );

    return { attemptId, obtainedMarks, totalMarks, accuracy, rank, topicAnalysis, questionAnalysis };
  }

  private async calculateRank(testId: string, obtainedMarks: number, currentAttemptId: string): Promise<number> {
    const { data: otherAttempts, error } = await this.supabaseService.client
      .from(TABLES.TEST_ATTEMPTS)
      .select('id')
      .eq('test_id', testId)
      .in('status', [AttemptStatus.PUBLISHED, AttemptStatus.EVALUATED])
      .neq('id', currentAttemptId);

    if (error) {
      this.logger.error('Failed to calculate rank', error);
      return 1;
    }

    if (!otherAttempts?.length) return 1;

    const attemptIds = otherAttempts.map((a) => a.id);
    const { data: allAnswers, error: answersError } = await this.supabaseService.client
      .from(TABLES.TEST_ANSWERS)
      .select('attempt_id, marks_awarded')
      .in('attempt_id', attemptIds);

    if (answersError) {
      this.logger.error('Failed to fetch answers for rank calculation', answersError);
      return 1;
    }

    const scoreMap = new Map<string, number>();
    for (const ans of allAnswers ?? []) {
      const current = scoreMap.get(ans.attempt_id) ?? 0;
      scoreMap.set(ans.attempt_id, current + (ans.marks_awarded ?? 0));
    }

    let betterCount = 0;
    for (const [, total] of scoreMap) {
      if (total > obtainedMarks) betterCount++;
    }

    return betterCount + 1;
  }

  private buildTopicAnalysis(answers: any[]) {
    const topicMap = new Map<string, { correct: number; total: number; marks: number }>();

    for (const answer of answers) {
      const topicId = answer.question_bank?.topic_id ?? answer.tqb?.question_bank?.topic_id ?? 'unknown';
      const marks = answer.marks_awarded ?? 0;
      const isCorrect = answer.is_correct === true;

      if (!topicMap.has(topicId)) {
        topicMap.set(topicId, { correct: 0, total: 0, marks: 0 });
      }

      const topic = topicMap.get(topicId)!;
      topic.total++;
      topic.marks += marks;
      if (isCorrect) topic.correct++;
    }

    return Array.from(topicMap.entries()).map(([topicId, data]) => ({
      topicId,
      correct: data.correct,
      total: data.total,
      marks: data.marks,
      accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 10000) / 100 : 0,
    }));
  }

  private buildQuestionAnalysis(answers: any[]) {
    return answers.map((answer) => ({
      questionId: answer.question_bank?.id,
      questionText: answer.question_bank?.question_text,
      questionType: answer.question_bank?.question_type,
      userAnswer: answer.answer,
      correctAnswer: answer.question_bank?.correct_answer,
      isCorrect: answer.is_correct,
      marksPossible: answer.marks_possible ?? answer.tqb?.marks ?? 1,
      marksAwarded: answer.marks_awarded ?? 0,
      feedback: answer.feedback,
    }));
  }

  async calculateAnalytics(testId: string) {
    const { data: results, error: resultsError } = await this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select(`
        *,
        test_attempts!inner(
          user_id,
          started_at,
          submitted_at,
          profiles!inner(batch_id),
          tests!inner(passing_marks)
        )
      `)
      .eq('test_attempts.test_id', testId);

    if (resultsError) throw resultsError;
    if (!results?.length) return { testId, message: 'No published results yet' };

    const scores = results.map((r) => r.obtained_marks);
    const totalAttempts = results.length;
    const averageScore = scores.reduce((a, b) => a + b, 0) / totalAttempts;
    const highest = Math.max(...scores);
    const lowest = Math.min(...scores);
    const sorted = [...scores].sort((a, b) => a - b);
    const median = totalAttempts % 2 === 0
      ? (sorted[totalAttempts / 2 - 1] + sorted[totalAttempts / 2]) / 2
      : sorted[Math.floor(totalAttempts / 2)];

    const passMarks = results[0]?.test_attempts?.tests?.passing_marks ?? 0;
    const passed = scores.filter((s) => s >= passMarks).length;
    const passRate = Math.round((passed / totalAttempts) * 10000) / 100;
    const averageAccuracy = results.reduce((sum, r) => sum + (r.accuracy ?? 0), 0) / totalAttempts;

    const durations = results
      .map((r) => {
        const submitted = r.test_attempts?.submitted_at;
        const started = r.test_attempts?.started_at;
        if (submitted && started) {
          return (new Date(submitted).getTime() - new Date(started).getTime()) / 60000;
        }
        return null;
      })
      .filter((d): d is number => d !== null);

    const averageDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const attemptIds = results.map((r) => r.attempt_id);
    const allAnswers = await this.fetchAnswersWithQuestions(attemptIds, testId);

    const questionPerformance = this.buildQuestionPerformance(allAnswers ?? []);
    const topicPerformance = this.buildTopicPerformance(allAnswers ?? []);

    const batchPerformance = await this.buildBatchPerformance(results);

    const snapshot = {
      test_id: testId,
      total_attempts: totalAttempts,
      average_score: Math.round(averageScore * 100) / 100,
      highest_score: highest,
      lowest_score: lowest,
      median_score: median,
      pass_rate: passRate,
      average_accuracy: Math.round(averageAccuracy * 100) / 100,
      average_duration_seconds: Math.round(averageDuration * 100) / 100,
      question_performance: questionPerformance,
      topic_performance: topicPerformance,
      batch_performance: batchPerformance,
      calculated_at: new Date().toISOString(),
    };

    const { error: insertError } = await this.supabaseService.client
      .from(TABLES.TEST_ANALYTICS_SNAPSHOTS)
      .insert(snapshot);

    if (insertError) throw insertError;

    return snapshot;
  }

  private buildQuestionPerformance(answers: any[]) {
    const questionMap = new Map<string, { correct: number; total: number; questionText: string }>();

    for (const answer of answers) {
      const qb = answer.question_bank;
      if (!qb) continue;

      const questionId = qb.id;
      if (!questionMap.has(questionId)) {
        questionMap.set(questionId, { correct: 0, total: 0, questionText: qb.question_text ?? '' });
      }

      const entry = questionMap.get(questionId)!;
      entry.total++;
      if (answer.is_correct === true) entry.correct++;
    }

    return Array.from(questionMap.entries()).map(([questionId, data]) => ({
      questionId,
      questionText: data.questionText,
      correct: data.correct,
      total: data.total,
      accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 10000) / 100 : 0,
    }));
  }

  private buildTopicPerformance(answers: any[]) {
    const topicMap = new Map<string, { correct: number; total: number }>();

    for (const answer of answers) {
      const qb = answer.question_bank;
      if (!qb) continue;

      const topicId = qb.topic_id ?? 'unknown';
      if (!topicMap.has(topicId)) {
        topicMap.set(topicId, { correct: 0, total: 0 });
      }

      const entry = topicMap.get(topicId)!;
      entry.total++;
      if (answer.is_correct === true) entry.correct++;
    }

    return Array.from(topicMap.entries()).map(([topicId, data]) => ({
      topicId,
      correct: data.correct,
      total: data.total,
      accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 10000) / 100 : 0,
    }));
  }

  private async buildBatchPerformance(results: any[]) {
    const batchMap = new Map<string, { attempts: number; totalScore: number; totalMarks: number }>();

    for (const result of results) {
      const batchId = result.test_attempts?.profiles?.batch_id ?? 'unknown';

      if (!batchMap.has(batchId)) {
        batchMap.set(batchId, { attempts: 0, totalScore: 0, totalMarks: 0 });
      }

      const entry = batchMap.get(batchId)!;
      entry.attempts++;
      entry.totalScore += result.obtained_marks ?? 0;
      entry.totalMarks += result.total_marks ?? 0;
    }

    return Array.from(batchMap.entries()).map(([batchId, data]) => ({
      batchId,
      attempts: data.attempts,
      averageScore: data.attempts > 0 ? Math.round((data.totalScore / data.attempts) * 100) / 100 : 0,
      totalMarks: data.totalMarks,
    }));
  }
}
