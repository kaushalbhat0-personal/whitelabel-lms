import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { SupabaseService } from '../../common/services/supabase.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    order: jest.fn(() => q),
    range: jest.fn(() => q),
    insert: jest.fn(() => q),
    update: jest.fn(() => q),
    upsert: jest.fn(() => q),
    delete: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    neq: jest.fn(() => q),
    head: jest.fn(() => q),
    limit: jest.fn(() => q),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}

function setupFrom(client: any, results: any[]) {
  let i = 0;
  client.from.mockImplementation(() => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return mockQuery(r);
  });
}

describe('EvaluationService', () => {
  let service: EvaluationService;
  let client: any;

  beforeEach(async () => {
    client = { from: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [EvaluationService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(EvaluationService);
  });

  describe('autoGradeAttempt', () => {
    const attempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'submitted' };
    const test = { id: 't1', negative_marking: false, total_marks: 10, passing_marks: 5 };

    it('auto-grades single choice answers and publishes when all auto', async () => {
      setupFrom(client, [
        { data: attempt, error: null },                          // attempt
        { data: test, error: null },                             // test
        { data: [                                                      // answers + question_bank
          { id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'B', marks_possible: 5, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'B' } },
        ], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null }, // tqb
        { data: null, error: null },                             // update answer
        { data: null, error: null },                             // update attempt status
        // publishResults queries:
        { data: { ...attempt, status: 'submitted', tests: test }, error: null }, // attempt (single)
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'B', marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'B' } }], error: null }, // answers
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null }, // tqb
        { count: 0, data: null },                                // existing result (maybeSingle)
        { data: { id: 'res1' }, error: null },                   // insert result (single)
        { data: null, error: null },                             // update attempt published
      ]);
      const result = await service.autoGradeAttempt('a1');
      expect(result.summary.autoGraded).toBe(1);
      expect(result.summary.correct).toBe(1);
      expect(result.summary.marksAwarded).toBe(5);
      expect(result.summary.manualReview).toBe(0);
    });

    it('routes non-auto-gradable answers to manual review', async () => {
      setupFrom(client, [
        { data: attempt, error: null },
        { data: test, error: null },
        { data: [
          { id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: { text: 'x' }, marks_possible: 5, question_bank: { id: 'qb1', question_type: 'long_answer', correct_answer: null } },
        ], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { data: null, error: null },  // update answer is_manual_review
        { data: null, error: null },  // insert review queue
        { data: null, error: null },  // update attempt status
      ]);
      const result = await service.autoGradeAttempt('a1');
      expect(result.summary.manualReview).toBe(1);
      expect(result.summary.autoGraded).toBe(0);
    });

    it('applies negative marking for wrong answers when enabled', async () => {
      const negTest = { ...test, negative_marking: true };
      setupFrom(client, [
        { data: attempt, error: null },
        { data: negTest, error: null },
        { data: [
          { id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'A', marks_possible: 5, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'B' } },
        ], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0.25 }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        // publish path
        { data: { ...attempt, status: 'submitted', tests: negTest }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'A', marks_awarded: -0.25, is_correct: false, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'B' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0.25 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
      ]);
      const result = await service.autoGradeAttempt('a1');
      expect(result.summary.marksAwarded).toBeLessThan(0);
      expect(result.summary.incorrect).toBe(1);
    });

    it('throws NotFound when attempt missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.autoGradeAttempt('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('evaluateAnswer (via autoGrade)', () => {
    it('correctly grades multiple-choice exact match', async () => {
      const attempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'submitted' };
      const test = { id: 't1', negative_marking: false, total_marks: 10, passing_marks: 5 };
      setupFrom(client, [
        { data: attempt, error: null },
        { data: test, error: null },
        { data: [
          { id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: ['A', 'B'], marks_possible: 5, question_bank: { id: 'qb1', question_type: 'multiple_choice', correct_answer: 'A,B' } },
        ], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        // publish
        { data: { ...attempt, status: 'submitted', tests: test }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: ['A', 'B'], marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'multiple_choice', correct_answer: 'A,B' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
      ]);
      const result = await service.autoGradeAttempt('a1');
      expect(result.summary.correct).toBe(1);
    });

    it('grades numerical within tolerance', async () => {
      const attempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'submitted' };
      const test = { id: 't1', negative_marking: false, total_marks: 10, passing_marks: 5 };
      setupFrom(client, [
        { data: attempt, error: null },
        { data: test, error: null },
        { data: [
          { id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 3.141, marks_possible: 5, question_bank: { id: 'qb1', question_type: 'numerical', correct_answer: '3.14' } },
        ], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        // publish
        { data: { ...attempt, status: 'submitted', tests: test }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 3.141, marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'numerical', correct_answer: '3.14' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
      ]);
      const result = await service.autoGradeAttempt('a1');
      expect(result.summary.correct).toBe(1);
    });

    it('grades true_false case-insensitively', async () => {
      const attempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'submitted' };
      const test = { id: 't1', negative_marking: false, total_marks: 10, passing_marks: 5 };
      setupFrom(client, [
        { data: attempt, error: null },
        { data: test, error: null },
        { data: [
          { id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'TRUE', marks_possible: 5, question_bank: { id: 'qb1', question_type: 'true_false', correct_answer: 'true' } },
        ], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: { ...attempt, status: 'submitted', tests: test }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'TRUE', marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'true_false', correct_answer: 'true' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
      ]);
      const result = await service.autoGradeAttempt('a1');
      expect(result.summary.correct).toBe(1);
    });
  });

  describe('getReviewQueue', () => {
    it('returns items with filters', async () => {
      setupFrom(client, [{ data: [{ id: 'rq1', status: 'pending' }], error: null }]);
      const result = await service.getReviewQueue({ status: 'pending' });
      expect(result.items).toHaveLength(1);
    });
  });

  describe('assignForReview', () => {
    it('assigns reviewer', async () => {
      setupFrom(client, [
        { data: { id: 'rq1', status: 'pending' }, error: null },
        { data: null, error: null },
      ]);
      const result = await service.assignForReview('rq1', 'teacher1');
      expect(result.assignedTo).toBe('teacher1');
      expect(result.status).toBe('in_review');
    });

    it('throws NotFound when missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.assignForReview('nope', 't')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('submitReview', () => {
    it('reviews an answer and publishes when all reviewed', async () => {
      const reviewItem = { id: 'rq1', attempt_id: 'a1', answer_id: 'ans1', status: 'pending', test_answers: { id: 'ans1', marks_awarded: null, feedback: null, evaluated_by: null, evaluated_at: null, is_manual_review: true } };
      setupFrom(client, [
        { data: reviewItem, error: null },                    // review item + answers
        { data: null, error: null },                          // tx step1 update answer
        { data: null, error: null },                          // tx step2 update queue
        { count: 0, data: null },                             // checkAllManualReviewsComplete
        { data: { status: 'partially_evaluated' }, error: null }, // attempt before
        { data: null, error: null },                          // update attempt evaluated
        // publishResults
        { data: { id: 'a1', test_id: 't1', user_id: 'u1', status: 'evaluated', tests: { total_marks: 10, passing_marks: 5 } }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'x', marks_awarded: 4, is_correct: null, question_bank: { id: 'qb1', question_type: 'long_answer', correct_answer: null } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { count: 0, data: null },                             // existing result
        { data: { id: 'res1' }, error: null },                // insert result
        { data: null, error: null },                          // update attempt published
      ]);
      const result = await service.submitReview('rq1', { marksAwarded: 4, feedback: 'Good' }, 'teacher1');
      expect(result.status).toBe('reviewed');
    });

    it('throws NotFound when review missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.submitReview('nope', { marksAwarded: 1 }, 't')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('publishResults', () => {
    it('publishes result with rank and analytics', async () => {
      setupFrom(client, [
        { data: { id: 'a1', test_id: 't1', user_id: 'u1', status: 'evaluated', tests: { total_marks: 10, passing_marks: 5 } }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'B', marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'B' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { count: 0, data: null },                             // existing result
        { data: { id: 'res1' }, error: null },                // insert result
        { data: null, error: null },                          // update attempt published
        // calculateRank queries
        { data: [{ id: 'a2' }], error: null },                // other attempts
        { data: [{ attempt_id: 'a2', marks_awarded: 3 }], error: null }, // their answers
        // calculateAnalytics
        { data: [{ id: 'res1', obtained_marks: 5, accuracy: 100, test_attempts: { user_id: 'u1', started_at: '2026-01-01', submitted_at: '2026-01-01T00:10:00', profiles: { batch_id: 'b1' }, tests: { passing_marks: 5 } } }], error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'single_choice', topic_id: 'top1' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { data: null, error: null },                          // insert analytics snapshot
      ]);
      const result = await service.publishResults('a1');
      expect(result.obtainedMarks).toBe(5);
      expect(result.rank).toBe(1);
    });

    it('throws NotFound when attempt missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.publishResults('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('calculateRank', () => {
    it('returns rank 1 when no other attempts', async () => {
      setupFrom(client, [
        { data: { id: 'a1', test_id: 't1', user_id: 'u1', status: 'evaluated', tests: { total_marks: 10, passing_marks: 5 } }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'B', marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'single_choice' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
        // rank: no other attempts
        { data: [], error: null },
      ]);
      const result = await service.publishResults('a1');
      expect(result.rank).toBe(1);
    });
  });

  describe('calculateAnalytics', () => {
    it('computes snapshot aggregates', async () => {
      setupFrom(client, [
        { data: [
          { id: 'res1', obtained_marks: 5, accuracy: 100, total_marks: 10, test_attempts: { user_id: 'u1', started_at: '2026-01-01', submitted_at: '2026-01-01T00:10:00', profiles: { batch_id: 'b1' }, tests: { passing_marks: 5 } } },
        ], error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', marks_awarded: 5, is_correct: true, question_bank: { id: 'qb1', question_type: 'single_choice', topic_id: 'top1' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5, negative_mark: 0 }], error: null },
        { data: null, error: null }, // insert snapshot
      ]);
      const result = await service.calculateAnalytics('t1');
      expect((result as any).total_attempts).toBe(1);
      expect((result as any).highest_score).toBe(5);
      expect((result as any).pass_rate).toBe(100);
    });
  });

  describe('ASSESS-001 MCQ answer-key contract', () => {
    // Regression for ASSESS-001: frontend must persist option KEY (e.g. "C") not display text ("Weak trend").
    // Backend evaluation expects keys: single_choice compare is exact String(userAnswer) === String(correctAnswer).
    // Options shape is { "A": "Strong trend", "B": "Sideways", "C": "Weak trend" }, correct_answer = "C".
    it('grades key "C" as correct and display text "Weak trend" as incorrect', async () => {
      const attempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'submitted' };
      const test = { id: 't1', negative_marking: false, total_marks: 10, passing_marks: 5 };
      // Correct key path
      setupFrom(client, [
        { data: attempt, error: null },
        { data: test, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'C', marks_possible: 1, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'C' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 1, negative_mark: 0 }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        // publish
        { data: { ...attempt, status: 'submitted', tests: test }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'C', marks_awarded: 1, is_correct: true, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'C' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 1, negative_mark: 0 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
      ]);
      const ok = await service.autoGradeAttempt('a1');
      expect(ok.summary.correct).toBe(1);
      expect(ok.summary.incorrect).toBe(0);
      expect(ok.summary.marksAwarded).toBe(1);

      // Display-text path (buggy old frontend would send "Weak trend") must be graded incorrect
      setupFrom(client, [
        { data: attempt, error: null },
        { data: test, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'Weak trend', marks_possible: 1, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'C' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 1, negative_mark: 0 }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        // publish would not be reached in partially graded? but autoGrade still counts incorrect
        { data: { ...attempt, status: 'submitted', tests: test }, error: null },
        { data: [{ id: 'ans1', attempt_id: 'a1', question_id: 'qb1', answer: 'Weak trend', marks_awarded: 0, is_correct: false, question_bank: { id: 'qb1', question_type: 'single_choice', correct_answer: 'C' } }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 1, negative_mark: 0 }], error: null },
        { count: 0, data: null },
        { data: { id: 'res1' }, error: null },
        { data: null, error: null },
      ]);
      // Reset client for second call (need fresh module instance? reuse same service but setupFrom resets)
      const result2 = await service.autoGradeAttempt('a1');
      expect(result2.summary.correct).toBe(0);
      expect(result2.summary.incorrect).toBe(1);
      expect(result2.summary.marksAwarded).toBe(0);
    });

    it('documents that options object must be persisted as key, not via Object.values', () => {
      // Simulate old buggy frontend: Object.values({A:"Strong",C:"Weak"}) => ["Strong","Weak"] loses keys.
      const rawOptions = { A: 'Strong trend', B: 'Sideways', C: 'Weak trend' };
      const buggyChoices = Object.values(rawOptions); // ["Strong trend", ...]
      expect(buggyChoices).not.toContain('C');
      expect(buggyChoices).toContain('Weak trend');
      // Fixed helper normalizeOptions preserves keys
      const fixed = Object.entries(rawOptions).map(([k, v]) => ({ key: k, value: v as string }));
      expect(fixed.find(o => o.key === 'C')?.value).toBe('Weak trend');
      expect(fixed.find(o => o.value === 'Weak trend')?.key).toBe('C');
    });
  });
});
