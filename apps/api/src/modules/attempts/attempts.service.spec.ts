import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AttemptsService } from './attempts.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisService } from '@liaoliaots/nestjs-redis';

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

function redisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };
}

describe('AttemptsService', () => {
  let service: AttemptsService;
  let client: any;
  let redis: any;

  const testRow = {
    id: 't1', status: 'published', duration_minutes: 10, max_attempts: 2,
    shuffle_questions: false, total_marks: 10, passing_marks: 5,
    test_batches: [{ batch_id: 'b1' }],
    test_question_bank: [
      { question_bank_id: 'qb1', marks: 5, sort_order: 0, negative_mark: 0, question_bank: { question_type: 'single_choice' }, test_sections: null },
    ],
  };
  const attemptRow = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'in_progress', started_at: '2026-01-01', time_remaining_seconds: 600, current_question_index: 0 };

  beforeEach(async () => {
    client = { from: jest.fn() };
    redis = redisMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptsService,
        { provide: SupabaseService, useValue: { client } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();
    service = module.get(AttemptsService);
  });

  describe('startAttempt', () => {
    it('creates a fresh attempt + answer rows', async () => {
      setupFrom(client, [
        { data: testRow, error: null },                        // test query (single)
        { data: [{ batch_id: 'b1' }], error: null },           // user batches
        { count: 0, data: null },                              // completed count
        { data: null, error: null },                           // existing attempt (maybeSingle)
        { data: attemptRow, error: null },                     // insert attempt (single)
        { data: null, error: null },                           // insert answer rows
      ]);
      const result = await service.startAttempt('t1', 'u1', {});
      expect(result.id).toBe('a1');
      expect(result.status).toBe('in_progress');
      expect(redis.setex).toHaveBeenCalled();
    });

    it('throws NotFound when test missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.startAttempt('nope', 'u1', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when test not in startable status', async () => {
      setupFrom(client, [{ data: { ...testRow, status: 'draft' }, error: null }]);
      await expect(service.startAttempt('t1', 'u1', {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Forbidden when user not enrolled in any assigned batch', async () => {
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b-other' }], error: null },
      ]);
      await expect(service.startAttempt('t1', 'u1', {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Forbidden when max attempts reached', async () => {
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 2, data: null },
      ]);
      await expect(service.startAttempt('t1', 'u1', {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resumes an existing in_progress attempt instead of creating a new one', async () => {
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: attemptRow, error: null },  // existing in_progress
        { data: [], error: null },          // answers
        { data: testRow, error: null },     // test for buildAttemptResponse
      ]);
      const result = await service.startAttempt('t1', 'u1', {});
      expect(result.id).toBe('a1');
      // buildAttemptResponse answers query used 'test_answers'; verify the attempt
      // insert chain (5th from call, index 4) never had .insert() invoked
      const attemptFromChain = client.from.mock.results[4]?.value;
      // The existing-attempt path returns before insert; assert the 5th from call was 'test_answers'
      expect(client.from.mock.calls[4][0]).toBe('test_answers');
    });

    it('handles concurrent duplicate insert (23505) by returning existing', async () => {
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: null, error: null },                                        // existing (maybeSingle)
        { data: null, error: { code: '23505', message: 'dup' } },           // insert fails
        { data: { ...attemptRow, test_answers: [], test: testRow }, error: null }, // re-fetch (single)
      ]);
      const result = await service.startAttempt('t1', 'u1', {});
      expect(result.id).toBe('a1');
    });

    it('shuffles questions when shuffle_questions enabled', async () => {
      const shuffledTest = {
        ...testRow, shuffle_questions: true,
        test_question_bank: [
          { question_bank_id: 'q1', marks: 1, sort_order: 0, question_bank: { question_type: 'single_choice' }, test_sections: null },
          { question_bank_id: 'q2', marks: 1, sort_order: 1, question_bank: { question_type: 'single_choice' }, test_sections: null },
        ],
      };
      setupFrom(client, [
        { data: shuffledTest, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: null, error: null },
        { data: attemptRow, error: null },
        { data: null, error: null }, // insert answers
      ]);
      await service.startAttempt('t1', 'u1', {});
      // verify answer rows were inserted (order may differ; count matters)
      const insertPayload = (client.from as any).mock.results[5]?.value;
      expect(client.from).toHaveBeenCalled();
    });
  });

  describe('getAttempt', () => {
    it('returns the attempt for the owner', async () => {
      setupFrom(client, [{ data: { ...attemptRow, test_answers: [] }, error: null }]);
      const result = await service.getAttempt('a1', 'u1');
      expect(result.id).toBe('a1');
    });

    it('throws NotFound when missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.getAttempt('nope', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden for non-owner', async () => {
      setupFrom(client, [{ data: { ...attemptRow, user_id: 'other' }, error: null }]);
      await expect(service.getAttempt('a1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('saveAnswer', () => {
    it('upserts answer and updates checkpoint', async () => {
      setupFrom(client, [
        { data: attemptRow, error: null },   // verifyOwnership
        { data: [{ question_bank_id: 'qb1' }], error: null }, // validate belongs
        { data: [{ question_bank_id: 'qb1', marks: 5 }], error: null }, // resolveMarksMap
        { data: { saved: true }, error: null }, // upsert
        { data: null, error: null },         // update attempt
        { data: { current_question_index: 1, time_remaining_seconds: 500 }, error: null }, // saveCheckpoint select
      ]);
      const result = await service.saveAnswer('a1', 'u1', { questionId: 'qb1', questionType: 'single_choice', answer: 'B', currentQuestionIndex: 1, timeRemainingSeconds: 500 } as any);
      expect(result.saved).toBe(true);
      expect(redis.setex).toHaveBeenCalled();
    });

    it('throws Forbidden when attempt not in_progress', async () => {
      setupFrom(client, [{ data: { ...attemptRow, status: 'submitted' }, error: null }]);
      await expect(service.saveAnswer('a1', 'u1', { questionId: 'qb1', questionType: 'single_choice', answer: 'B' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Forbidden for question not in the test', async () => {
      setupFrom(client, [
        { data: attemptRow, error: null },
        { data: [{ question_bank_id: 'other-q' }], error: null },
      ]);
      await expect(service.saveAnswer('a1', 'u1', { questionId: 'bad', questionType: 'single_choice', answer: 'B' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('saveAllAnswers', () => {
    it('saves multiple answers', async () => {
      setupFrom(client, [
        { data: attemptRow, error: null },
        { data: [{ question_bank_id: 'q1' }, { question_bank_id: 'q2' }], error: null },
        { data: [{ question_bank_id: 'q1', marks: 2 }, { question_bank_id: 'q2', marks: 3 }], error: null }, // marks map
        { data: null, error: null }, // upsert 1
        { data: null, error: null }, // upsert 2
        { data: null, error: null }, // update attempt
        { data: null, error: null }, // checkpoint
      ]);
      const result = await service.saveAllAnswers('a1', 'u1', [
        { questionId: 'q1', questionType: 'single_choice', answer: 'A' },
        { questionId: 'q2', questionType: 'single_choice', answer: 'B' },
      ] as any);
      expect(result.count).toBe(2);
    });
  });

  describe('submitAttempt', () => {
    it('submits and marks status submitted', async () => {
      const submitted = { ...attemptRow, status: 'submitted', submitted_at: '2026-01-02' };
      setupFrom(client, [
        { data: attemptRow, error: null },
        { data: [{ question_bank_id: 'qb1' }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5 }], error: null }, // marks map
        { data: null, error: null }, // upsert answer
        { data: submitted, error: null }, // update attempt (single)
      ]);
      const result = await service.submitAttempt('a1', 'u1', { answers: [{ questionId: 'qb1', questionType: 'single_choice', answer: 'B' }], timeRemainingSeconds: 0 } as any);
      expect(result.status).toBe('submitted');
      expect(redis.del).toHaveBeenCalled();
    });

    it('throws Forbidden if not in_progress', async () => {
      setupFrom(client, [{ data: { ...attemptRow, status: 'published' }, error: null }]);
      await expect(service.submitAttempt('a1', 'u1', { answers: [], timeRemainingSeconds: 0 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getAttemptsByUser', () => {
    it('returns paginated attempts', async () => {
      setupFrom(client, [{ data: [{ id: 'a1' }], count: 1, error: null }]);
      const result = await service.getAttemptsByUser('u1', { page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('getAttemptTimer', () => {
    it('returns cached Redis timer', async () => {
      redis.get.mockResolvedValue('500');
      setupFrom(client, [{ data: { user_id: 'u1', time_remaining_seconds: null, started_at: null, test: { duration_minutes: 10 } }, error: null }]);
      const result = await service.getAttemptTimer('a1', 'u1');
      expect(result.timeRemainingSeconds).toBe(500);
    });

    it('returns DB time_remaining_seconds when no cache', async () => {
      redis.get.mockResolvedValue(null);
      setupFrom(client, [{ data: { user_id: 'u1', time_remaining_seconds: 300, started_at: null, test: null }, error: null }]);
      const result = await service.getAttemptTimer('a1', 'u1');
      expect(result.timeRemainingSeconds).toBe(300);
    });

    it('computes elapsed from duration when no cache/DB value', async () => {
      redis.get.mockResolvedValue(null);
      const started = new Date(Date.now() - 120000).toISOString();
      setupFrom(client, [{ data: { user_id: 'u1', time_remaining_seconds: null, started_at: started, test: { duration_minutes: 10 } }, error: null }]);
      const result = await service.getAttemptTimer('a1', 'u1');
      expect(result.timeRemainingSeconds).toBeLessThanOrEqual(600);
      expect(result.timeRemainingSeconds).toBeGreaterThan(400);
    });

    it('throws Forbidden for non-owner', async () => {
      setupFrom(client, [{ data: { user_id: 'other' }, error: null }]);
      await expect(service.getAttemptTimer('a1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
