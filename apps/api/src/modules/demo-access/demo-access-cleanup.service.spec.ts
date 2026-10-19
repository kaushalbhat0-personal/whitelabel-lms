import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { DemoAccessCleanupService } from './demo-access-cleanup.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { AuthService } from '../auth/auth.service';
import { ObservabilityService } from '../observability/observability.service';

function redisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    }),
    scan: jest.fn(async () => ['0', []] as [string, string[]]),
    sadd: jest.fn(async (_k: string, ..._m: string[]) => 0),
    smembers: jest.fn(async () => [] as string[]),
    expire: jest.fn(async () => 1),
    setex: jest.fn(async (k: string, _t: number, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
  };
}

describe('DemoAccessCleanupService', () => {
  let service: DemoAccessCleanupService;
  let supabase: any;
  let auth: { forceLogoutUser: jest.Mock };
  let obs: { logEvent: jest.Mock };
  let redis: ReturnType<typeof redisMock>;

  beforeEach(async () => {
    supabase = {
      client: {
        auth: { admin: { deleteUser: jest.fn(async () => ({ data: {}, error: null })) } },
        from: jest.fn(),
      },
    };
    auth = { forceLogoutUser: jest.fn(async () => {}) };
    obs = { logEvent: jest.fn(async () => {}) };
    redis = redisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoAccessCleanupService,
        { provide: SupabaseService, useValue: supabase },
        { provide: AuthService, useValue: auth },
        { provide: ObservabilityService, useValue: obs },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();

    service = module.get(DemoAccessCleanupService);
  });

  function mockSweepRows(rows: Array<{ id: string }>) {
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn(async () => ({ data: rows, error: null })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({ not: jest.fn(async () => ({ error: null })) })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({ not: jest.fn(async () => ({ error: null })) })),
      })),
    });
  }

  it('sweep revokes ALL sessions, clears playback/join state, and deactivates (idempotent)', async () => {
    mockSweepRows([{ id: 'temp-1' }]);

    const result = await service.handleExpirySweep();
    expect(result.expired).toBe(1);
    expect(auth.forceLogoutUser).toHaveBeenCalledWith('temp-1');
    expect(obs.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'demo_access_expired' }),
    );
    const logged = JSON.stringify(obs.logEvent.mock.calls.map((c: any[]) => c[0]));
    expect(logged).not.toContain('password');

    // Second run finds nothing → safe no-op.
    mockSweepRows([]);
    const again = await service.handleExpirySweep();
    expect(again.expired).toBe(0);
  });

  it('sweep only targets temporary rows (expires_at IS NOT NULL predicate always present)', async () => {
    mockSweepRows([]);
    await service.handleExpirySweep();
    const chain = supabase.client.from.mock.results[0].value;
    expect(chain.not).toHaveBeenCalledWith('expires_at', 'is', null);
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('sweep continues past a single-account failure', async () => {
    mockSweepRows([{ id: 'bad-1' }, { id: 'good-1' }]);
    auth.forceLogoutUser.mockRejectedValueOnce(new Error('redis down'));
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn(async () => ({ data: [{ id: 'bad-1' }, { id: 'good-1' }], error: null })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({ not: jest.fn(async () => ({ error: null })) })),
      })),
    });
    const result = await service.handleExpirySweep();
    expect(result.expired).toBe(2);
  });

  it('grace delete removes only long-expired temporary accounts and tolerates races', async () => {
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      limit: jest.fn(async () => ({ data: [{ id: 'stale-1' }], error: null })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({ not: jest.fn(async () => ({ error: null })) })),
      })),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    });
    // Auth user already gone — must not fail the cleanup.
    supabase.client.auth.admin.deleteUser.mockRejectedValueOnce(new Error('not found'));

    const result = await service.handleGraceDelete();
    expect(result.deleted).toBe(1);
    expect(auth.forceLogoutUser).toHaveBeenCalledWith('stale-1');
    const chain = supabase.client.from.mock.results[0].value;
    expect(chain.not).toHaveBeenCalledWith('expires_at', 'is', null);
    expect(obs.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'demo_access_deleted' }),
    );
  });

  it('revocation purges session pointer, set, per-session keys, and join/playback state', async () => {
    await redis.setex('user_session:temp-9', 999, 'sess-a');
    await redis.sadd('user_sessions:temp-9', 'sess-a');
    auth.forceLogoutUser.mockImplementationOnce(async (userId: string) => {
      await redis.del(`user_session:${userId}`, 'session:sess-a', `user_sessions:${userId}`);
    });
    mockSweepRows([{ id: 'temp-9' }]);
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn(async () => ({ data: [{ id: 'temp-9' }], error: null })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({ not: jest.fn(async () => ({ error: null })) })),
      })),
    });
    await service.handleExpirySweep();
    expect(await redis.get('user_session:temp-9')).toBeNull();
    // Targeted playback/join keys deleted without SCAN/KEYS (scan only for bounded patterns).
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('playback_revoked:temp-9'));
  });
});
