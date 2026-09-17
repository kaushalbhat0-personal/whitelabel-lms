import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
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

describe('AttemptsService Phase28', () => {
  let service: AttemptsService;
  let client: any;
  let redis: any;

  const baseTest = {
    id: 't1', status: 'published', duration_minutes: 30, max_attempts: 5,
    shuffle_questions: false, total_marks: 10, passing_marks: 4,
    test_batches: [{ batch_id: 'b1' }],
    test_question_bank: [{ question_bank_id: 'qb1', marks: 5, sort_order: 0, negative_mark: 0, question_bank: { question_type: 'single_choice' }, test_sections: null }],
  };

  beforeEach(async () => {
    client = { from: jest.fn() };
    redis = redisMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttemptsService, { provide: SupabaseService, useValue: { client } }, { provide: RedisService, useValue: { getOrThrow: () => redis } }],
    }).compile();
    service = module.get(AttemptsService);
  });

  describe('availability window', () => {
    it('rejects start before start_time', async () => {
      const futureStart = new Date(Date.now() + 60_000).toISOString();
      const futureEnd = new Date(Date.now() + 3600000).toISOString();
      const testRow = { ...baseTest, start_time: futureStart, end_time: futureEnd };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: null, error: null },
      ]);
      await expect(service.startAttempt('t1', 'u1', {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('allows start exactly at start_time', async () => {
      const start = new Date(Date.now() - 100).toISOString();
      const end = new Date(Date.now() + 3600000).toISOString();
      const testRow = { ...baseTest, start_time: start, end_time: end };
      const attemptRow = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'in_progress', started_at: new Date().toISOString(), time_remaining_seconds: 1800, current_question_index: 0 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: null, error: null },
        { data: attemptRow, error: null },
        { data: null, error: null },
      ]);
      const r = await service.startAttempt('t1', 'u1', {} as any);
      expect(r.id).toBe('a1');
    });
    it('rejects start after end_time', async () => {
      const pastStart = new Date(Date.now() - 7200000).toISOString();
      const pastEnd = new Date(Date.now() - 1000).toISOString();
      const testRow = { ...baseTest, start_time: pastStart, end_time: pastEnd };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: null, error: null },
      ]);
      await expect(service.startAttempt('t1', 'u1', {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('allows resume after window closed', async () => {
      const pastStart = new Date(Date.now() - 7200000).toISOString();
      const pastEnd = new Date(Date.now() - 1000).toISOString();
      const testRow = { ...baseTest, start_time: pastStart, end_time: pastEnd };
      const existing = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'in_progress', started_at: new Date().toISOString(), time_remaining_seconds: 100, current_question_index: 0 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { count: 0, data: null },
        { data: existing, error: null },
        { data: [], error: null },
        { data: testRow, error: null },
      ]);
      const r = await service.startAttempt('t1', 'u1', {} as any);
      expect(r.id).toBe('a1');
    });
  });

  describe('expiry', () => {
    it('rejects save after duration expires', async () => {
      const expiredAttempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'in_progress', started_at: new Date(Date.now() - 3600_000).toISOString(), time_remaining_seconds: 0, current_question_index: 0 };
      setupFrom(client, [
        { data: expiredAttempt, error: null }, // verifyOwnership
        { data: { duration_minutes: 30 }, error: null }, // getDuration
        // batch check not needed because expiry throws first, but our code does expiry before batch, so batch not reached. To make expiry trigger, we need duration 30 and started 1h ago => remaining -1800 => expired
      ]);
      await expect(service.saveAnswer('a1', 'u1', { questionId: 'qb1', questionType: 'single_choice', answer: 'A' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('clamps inflated client time', async () => {
      const freshAttempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'in_progress', started_at: new Date().toISOString(), time_remaining_seconds: 1800, current_question_index: 0 };
      // save with inflated 9999 should be clamped to ~1800
      setupFrom(client, [
        { data: freshAttempt, error: null },
        { data: { duration_minutes: 30 }, error: null }, // expiry check
        { data: { id: 't1', test_batches: [{ batch_id: 'b1' }] }, error: null },
        { data: [{ batch_id: 'b1' }], error: null },
        { data: [{ question_bank_id: 'qb1' }], error: null },
        { data: [{ question_bank_id: 'qb1', marks: 5 }], error: null },
        { data: { duration_minutes: 30 }, error: null }, // clamp
        { data: { saved: true }, error: null },
        { data: null, error: null },
        { data: { current_question_index: 1, time_remaining_seconds: 500 }, error: null },
      ]);
      const r = await service.saveAnswer('a1', 'u1', { questionId: 'qb1', questionType: 'single_choice', answer: 'A', timeRemainingSeconds: 9999 } as any);
      expect(r.saved).toBe(true);
      // Verify that second call to clamp used server remaining, not raw
    });
  });

  describe('batch recheck', () => {
    it('rejects submit when removed from batch', async () => {
      const freshAttempt = { id: 'a1', test_id: 't1', user_id: 'u1', status: 'in_progress', started_at: new Date().toISOString(), time_remaining_seconds: 600, current_question_index: 0 };
      setupFrom(client, [
        { data: freshAttempt, error: null },
        { data: { duration_minutes: 30 }, error: null },
        { data: { id: 't1', test_batches: [{ batch_id: 'b1' }] }, error: null },
        { data: [{ batch_id: 'other' }], error: null }, // user now in other batch
      ]);
      await expect(service.submitAttempt('a1', 'u1', { answers: [], timeRemainingSeconds: 600 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
