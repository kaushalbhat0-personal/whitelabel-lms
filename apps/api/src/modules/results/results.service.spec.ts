import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ResultsService } from './results.service';
import { SupabaseService } from '../../common/services/supabase.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    order: jest.fn(() => q),
    range: jest.fn(() => q),
    limit: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
  // supabase-js queries are thenable — awaiting the chain resolves the query result.
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}

// Makes `from()` return a fresh query whose terminal resolves to results[index].
function setupFrom(client: any, results: any[]) {
  let i = 0;
  client.from.mockImplementation(() => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return mockQuery(r);
  });
}

describe('ResultsService', () => {
  let service: ResultsService;
  let client: any;
  const attemptId = 'attempt-1';
  const userId = 'user-a';

  beforeEach(async () => {
    client = { from: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResultsService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(ResultsService);
  });

  describe('getStudentResult', () => {
    const resultRow = {
      obtained_marks: 7, total_marks: 10, percentage: 70, rank: 1, total_attempts: 1,
      accuracy: 0.7, topic_analysis: null, question_analysis: null, teacher_feedback: null,
      passed: true, duration_seconds: 900, published_at: '2026-01-01',
      test: { title: 'T', total_marks: 10, passing_marks: 5, duration_minutes: 15, show_result_immediately: true },
    };
    const answerRow = { id: 'a1', question_id: 'q1', question_type: 'single_choice', answer: 'B', marks_possible: 5, marks_awarded: 5, is_correct: true, is_manual_review: false };

    it('returns sanitized answers for the owner when showResultImmediately', async () => {
      setupFrom(client, [
        { data: { user_id: userId, test_id: 'test-1' }, error: null },
        { data: { show_result_immediately: true }, error: null },
        { data: resultRow, error: null },
        { data: [answerRow], error: null },
      ]);
      const result = await service.getStudentResult(attemptId, userId);
      expect(result.obtained_marks).toBe(7);
      expect((result as any).answers).toHaveLength(1);
      expect((result as any).answers[0].marks_awarded).toBe(5);
      expect((result as any).answers[0].is_correct).toBe(true);
    });

    it('throws NotFoundException if attempt missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.getStudentResult(attemptId, userId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException for non-owner', async () => {
      setupFrom(client, [{ data: { user_id: 'other', test_id: 't' }, error: null }]);
      await expect(service.getStudentResult(attemptId, userId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('hides answers when show_result_immediately is false', async () => {
      setupFrom(client, [
        { data: { user_id: userId, test_id: 't' }, error: null },
        { data: { show_result_immediately: false }, error: null },
        { data: { ...resultRow, test: { ...resultRow.test, show_result_immediately: false } }, error: null },
      ]);
      const result = await service.getStudentResult(attemptId, userId);
      expect((result as any).answers).toBeUndefined();
    });
  });

  describe('getMyResults', () => {
    it('maps result rows to list shape', async () => {
      setupFrom(client, [{
        data: [{ id: 'r1', attempt_id: 'a1', test_id: 't1', test: { title: 'T' }, percentage: 70, rank: 1, passed: true, obtained_marks: 7, total_marks: 10, published_at: 'x' }],
        count: 1, error: null,
      }]);
      const result = await service.getMyResults(userId);
      expect(result.total).toBe(1);
      expect(result.items[0].test_title).toBe('T');
      expect(result.items[0].attempt_id).toBe('a1');
    });
  });

  describe('getTestResults', () => {
    it('orders by rank by default', async () => {
      setupFrom(client, [{ data: [{ id: 'r1', profile: { name: 'S' } }], count: 1, error: null }]);
      await service.getTestResults('t1', {});
      expect(client.from).toHaveBeenCalled();
    });

    it('orders by marks when requested', async () => {
      setupFrom(client, [{ data: [], count: 0, error: null }]);
      await service.getTestResults('t1', { orderBy: 'marks' });
      expect(client.from).toHaveBeenCalled();
    });
  });

  describe('getTestAnalytics', () => {
    it('returns latest snapshot', async () => {
      setupFrom(client, [{
        data: { total_attempts: 5, average_score: 60, highest_score: 90, lowest_score: 30, median_score: 60, pass_rate: 50, average_accuracy: 70, average_duration_seconds: 600, question_performance: [], topic_performance: [], batch_performance: [] },
        error: null,
      }]);
      const result = await service.getTestAnalytics('t1');
      expect(result.total_attempts).toBe(5);
    });

    it('throws when no snapshot', async () => {
      setupFrom(client, [{ data: null, error: null }]);
      await expect(service.getTestAnalytics('t1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getStudentAnalytics', () => {
    it('returns empty summary when no results', async () => {
      setupFrom(client, [{ data: [], error: null }]);
      const result = await service.getStudentAnalytics(userId);
      expect(result.total_tests_taken).toBe(0);
      expect(result.topic_strengths).toEqual([]);
    });

    it('computes averages and topic strengths', async () => {
      setupFrom(client, [{
        data: [
          { percentage: 90, passed: true, test_id: 't1', test: { title: 'T1' }, published_at: 'x', topic_analysis: [{ name: 'A', total_questions: 2, correct_answers: 2 }] },
          { percentage: 50, passed: false, test_id: 't2', test: { title: 'T2' }, published_at: 'x', topic_analysis: [{ name: 'B', total_questions: 2, correct_answers: 0 }] },
        ], error: null,
      }]);
      const result = await service.getStudentAnalytics(userId);
      expect(result.total_tests_taken).toBe(2);
      expect(result.average_percentage).toBe(70);
      expect(result.best_percentage).toBe(90);
      expect(result.topicStrengths).toContain('A');
      expect(result.topicWeaknesses).toContain('B');
      expect(result.recent_trend).toHaveLength(2);
    });
  });

  describe('getOverallAnalytics', () => {
    it('aggregates overall stats', async () => {
      setupFrom(client, [
        { count: 3, data: null },   // testCount
        { count: 4, data: null },   // resultCount
        { data: [{ percentage: 70, passed: true, user_id: 'u1' }], count: 1 }, // allResults
        { data: [{ user_id: 'u1' }], count: 1 }, // distinct students
      ]);
      const result = await service.getOverallAnalytics({});
      expect(result.total_tests).toBe(3);
      expect(result.total_attempts).toBe(4);
      expect(result.overall_average).toBe(70);
      expect(result.total_students_attempted).toBe(1);
    });
  });
});
