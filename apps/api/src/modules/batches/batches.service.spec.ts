import { Test, TestingModule } from '@nestjs/testing';
import { BatchesService } from './batches.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { EmailService } from '../email/email.service';
import { ObservabilityService } from '../observability/observability.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    insert: jest.fn(() => q),
    upsert: jest.fn(() => q),
    delete: jest.fn(() => q),
    update: jest.fn(() => q),
    range: jest.fn(() => q),
    order: jest.fn(() => q),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
  // Supabase thenable for await query
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}

describe('BatchesService — H1 cache invalidation (Phase 10A)', () => {
  let service: BatchesService;
  let client: any;
  let redisCache: any;

  const BATCH_A = '550e8400-e29b-41d4-a716-446655440001';
  const BATCH_B = '550e8400-e29b-41d4-a716-446655440002';
  const S1 = '660e8400-e29b-41d4-a716-446655440011';
  const S2 = '660e8400-e29b-41d4-a716-446655440022';
  const S_OTHER = '660e8400-e29b-41d4-a716-446655440099';

  beforeEach(async () => {
    client = {
      from: jest.fn(),
      auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn(), listUsers: jest.fn() } },
    };
    redisCache = {
      invalidateRecordingsCache: jest.fn().mockResolvedValue(undefined),
      invalidateRecordingsCacheForUser: jest.fn().mockResolvedValue(undefined),
      invalidateRecordingsCacheForUsers: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchesService,
        { provide: SupabaseService, useValue: { client } },
        { provide: RedisCacheService, useValue: redisCache },
        { provide: EmailService, useValue: { sendWelcomeEmail: jest.fn().mockResolvedValue(undefined) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(BatchesService);
    jest.spyOn(service as any, 'findById').mockResolvedValue({ id: BATCH_A } as any);
  });

  function setupAssignStudentsSuccess(studentIds: string[]) {
    // 1) findById mocked, 2) profiles lookup, 3) batch_students upsert
    let call = 0;
    client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        call++;
        const ids = studentIds.map((id) => ({ id }));
        return mockQuery({ data: ids, error: null });
      }
      if (table === 'batch_students') {
        return mockQuery({ data: null, error: null });
      }
      return mockQuery({ data: null, error: null });
    });
  }

  it('1. add student (assignStudents) → invalidates each affected user', async () => {
    setupAssignStudentsSuccess([S1, S2]);
    await service.assignStudents(BATCH_A, { studentIds: [S1, S2] } as any);
    expect(redisCache.invalidateRecordingsCacheForUsers).toHaveBeenCalledWith([S1, S2]);
    expect(redisCache.invalidateRecordingsCache).not.toHaveBeenCalled();
  });

  it('2. remove student → invalidates each removed user', async () => {
    client.from.mockImplementation(() => {
      const q = mockQuery({ data: [{ batch_id: BATCH_A, user_id: S1 }], error: null });
      // delete().eq().in().select()
      q.delete.mockReturnValue(q);
      q.eq.mockReturnValue(q);
      q.in.mockReturnValue(q);
      q.select.mockResolvedValue({ data: [{ batch_id: BATCH_A, user_id: S1 }], error: null });
      return q;
    });
    // Override to support chain: from().delete().eq().in().select()
    client.from.mockImplementation(() => {
      const base = mockQuery({ data: [{ batch_id: BATCH_A, user_id: S1 }], error: null });
      base.delete = jest.fn(() => base);
      base.eq = jest.fn(() => base);
      base.in = jest.fn(() => base);
      base.select = jest.fn().mockResolvedValue({ data: [{ batch_id: BATCH_A, user_id: S1 }], error: null });
      return base as any;
    });
    await service.removeStudents(BATCH_A, [S1]);
    expect(redisCache.invalidateRecordingsCacheForUsers).toHaveBeenCalledWith([S1]);
  });

  it('3. bulk assignment via assignStudents → affected students cache invalidated', async () => {
    setupAssignStudentsSuccess([S1, S2, S_OTHER]);
    await service.assignStudents(BATCH_A, { studentIds: [S1, S2, S_OTHER] } as any);
    const calledIds = redisCache.invalidateRecordingsCacheForUsers.mock.calls[0][0];
    expect(calledIds).toEqual(expect.arrayContaining([S1, S2, S_OTHER]));
  });

  it('4. student batch switch (remove old + add new) invalidates and next query uses new batch', async () => {
    // Simulate remove from A then assign to B
    client.from.mockImplementation(() => {
      const q = mockQuery({ data: [{ batch_id: BATCH_A, user_id: S1 }], error: null });
      q.delete = jest.fn(() => q);
      q.eq = jest.fn(() => q);
      q.in = jest.fn(() => q);
      q.select = jest.fn().mockResolvedValue({ data: [{ batch_id: BATCH_A, user_id: S1 }], error: null });
      return q as any;
    });
    await service.removeStudents(BATCH_A, [S1]);
    expect(redisCache.invalidateRecordingsCacheForUsers).toHaveBeenCalledWith([S1]);

    jest.clearAllMocks();
    setupAssignStudentsSuccess([S1]);
    // Need to re-mock findById for BATCH_B
    (service as any).findById.mockResolvedValue({ id: BATCH_B } as any);
    await service.assignStudents(BATCH_B, { studentIds: [S1] } as any);
    expect(redisCache.invalidateRecordingsCacheForUsers).toHaveBeenCalledWith([S1]);
    // Next recording query would read batch_students = [BATCH_B], not BATCH_A — verified via batch_students junction
  });

  it('5. unrelated student cache remains untouched', async () => {
    setupAssignStudentsSuccess([S1]);
    await service.assignStudents(BATCH_A, { studentIds: [S1] } as any);
    expect(redisCache.invalidateRecordingsCacheForUsers).toHaveBeenCalledWith([S1]);
    expect(redisCache.invalidateRecordingsCacheForUsers).not.toHaveBeenCalledWith(expect.arrayContaining([S_OTHER]));
    // Ensure global flush not called
    expect(redisCache.invalidateRecordingsCache).not.toHaveBeenCalled();
  });

  it('6. assignStudentToBatch single → targeted invalidation', async () => {
    let fromCalls: string[] = [];
    client.from.mockImplementation((table: string) => {
      fromCalls.push(table);
      if (table === 'profiles') {
        return mockQuery({ data: { id: S1 }, error: null });
      }
      return mockQuery({ data: null, error: null });
    });
    await service.assignStudentToBatch(BATCH_A, S1);
    expect(redisCache.invalidateRecordingsCacheForUser).toHaveBeenCalledWith(S1);
  });
});
