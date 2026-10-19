import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { AuthService } from './auth.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { DeviceService } from '../devices/device.service';
import { EmailService } from '../email/email.service';
import { PlaybackGuardService } from '../playback/playback-guard.service';
import { ObservabilityService } from '../observability/observability.service';

function redisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (...keys: string[]) => { keys.forEach(k => { store.delete(k); sets.delete(k); }); return keys.length; }),
    incr: jest.fn(async (k: string) => { const v = (parseInt(store.get(k) ?? '0', 10) + 1).toString(); store.set(k, v); return parseInt(v, 10); }),
    expire: jest.fn(async () => 1),
    keys: jest.fn(async () => []),
    sadd: jest.fn(async (k: string, ...members: string[]) => {
      let s = sets.get(k);
      if (!s) { s = new Set(); sets.set(k, s); }
      let added = 0;
      for (const m of members) if (!s.has(m)) { s.add(m); added++; }
      return added;
    }),
    smembers: jest.fn(async (k: string) => [...(sets.get(k) ?? [])]),
    srem: jest.fn(async (k: string, ...members: string[]) => {
      const s = sets.get(k);
      if (!s) return 0;
      let removed = 0;
      for (const m of members) if (s.delete(m)) removed++;
      return removed;
    }),
    _store: store,
    _sets: sets,
  };
}

describe('AuthService — one-device graceful replacement', () => {
  let service: AuthService;
  let redis: ReturnType<typeof redisMock>;
  let supabase: any;
  let jwt: any;

  const profile = { id: 'u1', name: 'Student', email: 's@example.com', role: 'student', is_active: true, must_change_password: false };

  beforeEach(async () => {
    redis = redisMock();
    supabase = {
      authClient: { auth: { signInWithPassword: jest.fn(), admin: { updateUserById: jest.fn() } } },
      client: { from: jest.fn() },
    };
    jwt = { signAsync: jest.fn(async () => 'jwt-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabase },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => key === 'FRONTEND_URL' ? 'http://localhost:3000' : undefined) } },
        { provide: DeviceService, useValue: { registerDevice: jest.fn(async () => ({ device: null, isNew: false })) } },
        { provide: EmailService, useValue: {} },
        { provide: PlaybackGuardService, useValue: { revokeUserTokens: jest.fn(async () => {}) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn(async () => {}) } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();

    service = module.get(AuthService);

    // Default: supabase auth success
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    // Profile found
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({ data: profile, error: null })),
      insert: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(async () => ({ data: null, error: null })) })) })),
    } as any);
  });

  it('TEST 1: no active session → normal login succeeds', async () => {
    const result = await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    expect(result.token).toBe('jwt-token');
    expect(redis.setex).toHaveBeenCalledWith(expect.stringContaining('user_session:u1'), expect.any(Number), expect.any(String));
  });

  it('TEST 2: active session exists → revoked and SESSION_REPLACED, no new session created', async () => {
    // Pre-seed an active session
    await redis.setex('user_session:u1', 86400, 'old-session-id');
    await redis.setex('session:old-session-id', 86400, JSON.stringify({ userId: 'u1' }));

    let caught: any = null;
    try {
      await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught.getResponse()).toMatchObject({ code: 'SESSION_REPLACED' });
    expect(caught.getStatus()).toBe(409);

    // Old session must be gone, and no new session created (userSession deleted, not recreated)
    expect(await redis.get('user_session:u1')).toBeNull();
    expect(await redis.get('session:old-session-id')).toBeNull();
  });

  it('TEST 3: after replacement, old session is rejected via validateSession', async () => {
    await redis.setex('user_session:u1', 86400, 'old-id');
    await redis.setex('session:old-id', 86400, '{}');
    // First login revokes
    await expect(service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    // Old session should now be invalid
    expect(await service.validateSession('u1', 'old-id')).toBe(false);
  });

  it('TEST 4: second login after replacement succeeds', async () => {
    await redis.setex('user_session:u1', 86400, 'old-id');
    await redis.setex('session:old-id', 86400, '{}');
    await expect(service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    // Now no active session, next login should succeed
    const result = await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    expect(result.token).toBe('jwt-token');
    const newSession = await redis.get('user_session:u1');
    expect(newSession).toBeTruthy();
    expect(newSession).not.toBe('old-id');
  });

  it('TEST 5: wrong password still produces normal 401, not SESSION_REPLACED', async () => {
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid' } } as any);
    await expect(service.login({ email: 's@example.com', password: 'wrong' } as any, '3.3.3.3', 'UA')).rejects.toThrow(UnauthorizedException);
  });

  it('TEST 6: normal logout still works and clears both keys', async () => {
    await redis.setex('user_session:u1', 86400, 'sess1');
    await redis.setex('session:sess1', 86400, '{}');
    const res = await service.logout('u1', 'sess1');
    expect(res.message).toMatch(/Logged out/);
    expect(await redis.get('user_session:u1')).toBeNull();
    expect(await redis.get('session:sess1')).toBeNull();
  });

  // ── Phase 28.1 playback logout regression ───────────────────────
  it('TEST 7: normal logout does NOT create playback_revoked', async () => {
    await redis.setex('user_session:u1', 86400, 'sess1');
    await redis.setex('session:sess1', 86400, '{}');
    // Seed mock revoke spy
    const playbackGuard = (service as any).playbackGuard as { revokeUserTokens: jest.Mock };
    playbackGuard.revokeUserTokens.mockClear();
    await service.logout('u1', 'sess1');
    expect(playbackGuard.revokeUserTokens).not.toHaveBeenCalled();
    expect(redis._store.has('playback_revoked:u1')).toBe(false);
    expect(await redis.get('playback_revoked:u1')).toBeNull();
  });

  it('TEST 8: normal logout remains idempotent and does NOT create playback_revoked on second call', async () => {
    await redis.setex('user_session:u1', 86400, 'sess1');
    await redis.setex('session:sess1', 86400, '{}');
    const playbackGuard = (service as any).playbackGuard as { revokeUserTokens: jest.Mock };
    playbackGuard.revokeUserTokens.mockClear();
    await service.logout('u1', 'sess1');
    // Second logout with same (now missing) session — still succeeds per idempotent contract
    const res2 = await service.logout('u1', 'sess1');
    expect(res2.message).toMatch(/Logged out/);
    expect(playbackGuard.revokeUserTokens).not.toHaveBeenCalled();
    expect(await redis.get('playback_revoked:u1')).toBeNull();
  });

  it('TEST 9: session replacement does NOT create playback_revoked', async () => {
    await redis.setex('user_session:u1', 86400, 'old-session-id');
    await redis.setex('session:old-session-id', 86400, JSON.stringify({ userId: 'u1' }));
    const playbackGuard = (service as any).playbackGuard as { revokeUserTokens: jest.Mock };
    playbackGuard.revokeUserTokens.mockClear();
    await expect(service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    expect(playbackGuard.revokeUserTokens).not.toHaveBeenCalled();
    expect(await redis.get('playback_revoked:u1')).toBeNull();
    // Old session gone
    expect(await redis.get('user_session:u1')).toBeNull();
    expect(await redis.get('session:old-session-id')).toBeNull();
  });

  it('TEST 10: retry login after SESSION_REPLACED succeeds and still does NOT create playback_revoked', async () => {
    await redis.setex('user_session:u1', 86400, 'old-id');
    await redis.setex('session:old-id', 86400, '{}');
    const playbackGuard = (service as any).playbackGuard as { revokeUserTokens: jest.Mock };
    playbackGuard.revokeUserTokens.mockClear();
    await expect(service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    expect(playbackGuard.revokeUserTokens).not.toHaveBeenCalled();
    // Retry
    const result = await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    expect(result.token).toBe('jwt-token');
    expect(playbackGuard.revokeUserTokens).not.toHaveBeenCalled();
    expect(await redis.get('playback_revoked:u1')).toBeNull();
    const newSession = await redis.get('user_session:u1');
    expect(newSession).toBeTruthy();
    expect(newSession).not.toBe('old-id');
  });

  it('TEST 11: logout invalidates authentication session (validateSession false after)', async () => {
    await redis.setex('user_session:u1', 86400, 'sess-logout-test');
    await redis.setex('session:sess-logout-test', 86400, '{}');
    await service.logout('u1', 'sess-logout-test');
    expect(await service.validateSession('u1', 'sess-logout-test')).toBe(false);
    expect(await service.validateSession('u1', 'any-other')).toBe(false);
  });

  it('TEST 12: login tracks the session set and forceLogout clears pointer + set + all session keys', async () => {
    const result = await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    expect(result.token).toBe('jwt-token');
    const sid = await redis.get('user_session:u1');
    expect(await redis.smembers('user_sessions:u1')).toEqual([sid]);
    await service.forceLogoutUser('u1');
    expect(await redis.get('user_session:u1')).toBeNull();
    expect(await redis.get(`session:${sid}`)).toBeNull();
    expect(await redis.smembers('user_sessions:u1')).toEqual([]);
  });

  it('TEST 13: expired temporary account (expires_at past) cannot log in', async () => {
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: {
          id: 'u1', name: 'Demo Guest', email: 'demo-abc@demo.invalid', role: 'student',
          is_active: true, must_change_password: false,
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      })),
    } as any);
    await expect(
      service.login({ email: 'demo-abc@demo.invalid', password: 'x' } as any, '1.1.1.1', 'UA'),
    ).rejects.toThrow('Your demo access has expired');
    // No session created for the expired account.
    expect(await redis.get('user_session:u1')).toBeNull();
  });

  it('TEST 14: unexpired temporary account (expires_at future) logs in normally', async () => {
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: {
          id: 'u1', name: 'Demo Guest', email: 'demo-abc@demo.invalid', role: 'student',
          is_active: true, must_change_password: false,
          expires_at: new Date(Date.now() + 29 * 60_000).toISOString(),
        },
        error: null,
      })),
    } as any);
    const result = await service.login({ email: 'demo-abc@demo.invalid', password: 'x' } as any, '1.1.1.1', 'UA');
    expect(result.token).toBe('jwt-token');
  });

  it('TEST 15: permanent account (expires_at NULL) logs in normally', async () => {
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: {
          id: 'u1', name: 'Student', email: 's@example.com', role: 'student',
          is_active: true, must_change_password: false, expires_at: null,
        },
        error: null,
      })),
    } as any);
    const result = await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    expect(result.token).toBe('jwt-token');
  });
});

describe('AuthService — SESSION_POLICY=multi (concurrent sessions)', () => {
  let service: AuthService;
  let redis: ReturnType<typeof redisMock>;
  let supabase: any;
  let jwt: any;
  let sessionCounter = 0;

  beforeEach(async () => {
    redis = redisMock();
    supabase = {
      authClient: { auth: { signInWithPassword: jest.fn(), admin: { updateUserById: jest.fn() } } },
      client: { from: jest.fn() },
    };
    // Distinct sessionId per login so concurrency is observable
    jwt = { signAsync: jest.fn(async () => `jwt-token-${++sessionCounter}`) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabase },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => key === 'SESSION_POLICY' ? 'multi' : key === 'FRONTEND_URL' ? 'http://localhost:3000' : undefined) } },
        { provide: DeviceService, useValue: { registerDevice: jest.fn(async () => ({ device: null, isNew: false })) } },
        { provide: EmailService, useValue: {} },
        { provide: PlaybackGuardService, useValue: { revokeUserTokens: jest.fn(async () => {}) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn(async () => {}) } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();

    service = module.get(AuthService);

    supabase.authClient.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    supabase.client.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({ data: { id: 'u1', name: 'Student', email: 's@example.com', role: 'student', is_active: true, must_change_password: false }, error: null })),
      insert: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(async () => ({ data: null, error: null })) })) })),
    } as any);
  });

  it('M1: login A succeeds, login B succeeds immediately with NO SESSION_REPLACED', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    const second = service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    await expect(second).resolves.toMatchObject({ token: 'jwt-token-2' });
  });

  it('M2: session IDs differ, both session keys exist, set contains both', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    const members = await redis.smembers('user_sessions:u1');
    expect(members).toHaveLength(2);
    expect(new Set(members).size).toBe(2);
    for (const sid of members) {
      expect(await redis.get(`session:${sid}`)).not.toBeNull();
    }
  });

  it('M3: both tokens validate concurrently', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    const [a, b] = await redis.smembers('user_sessions:u1');
    expect(await service.validateSession('u1', a)).toBe(true);
    expect(await service.validateSession('u1', b)).toBe(true);
  });

  it('M4: logout A invalidates A only — B remains valid; logout is idempotent', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    const [a, b] = await redis.smembers('user_sessions:u1');
    await service.logout('u1', a);
    expect(await service.validateSession('u1', a)).toBe(false);
    expect(await service.validateSession('u1', b)).toBe(true);
    expect(await redis.smembers('user_sessions:u1')).toEqual([b]);
    // Idempotent second logout of A
    await expect(service.logout('u1', a)).resolves.toMatchObject({ message: expect.stringMatching(/Logged out/) });
    expect(await service.validateSession('u1', b)).toBe(true);
    await service.logout('u1', b);
    expect(await service.validateSession('u1', b)).toBe(false);
    expect(await redis.smembers('user_sessions:u1')).toEqual([]);
  });

  it('M5: forceLogoutUser revokes ALL sessions (suspend/deactivate/remove path)', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    const members = await redis.smembers('user_sessions:u1');
    await service.forceLogoutUser('u1');
    for (const sid of members) {
      expect(await service.validateSession('u1', sid)).toBe(false);
      expect(await redis.get(`session:${sid}`)).toBeNull();
    }
    expect(await redis.smembers('user_sessions:u1')).toEqual([]);
    expect(await redis.get('user_session:u1')).toBeNull();
  });

  it('M6: session belonging to another user cannot validate', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    const [a] = await redis.smembers('user_sessions:u1');
    expect(await service.validateSession('u2', a)).toBe(false);
  });

  it('M7: missing session key returns false even if ID lingers in the set', async () => {
    await redis.sadd('user_sessions:u1', 'ghost-session');
    expect(await service.validateSession('u1', 'ghost-session')).toBe(false);
  });

  it('M8: changePassword preserves existing sessions (no silent revocation)', async () => {
    await service.login({ email: 's@example.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    const [a] = await redis.smembers('user_sessions:u1');
    const updateUserById = jest.fn().mockResolvedValue({ error: null });
    supabase.client = {
      auth: { admin: { updateUserById } },
      from: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };
    await service.changePassword('u1', 'NewPass123', 'NewPass123');
    expect(await service.validateSession('u1', a)).toBe(true);
  });
});

describe('AuthService — PASSWORD_MANAGEMENT=disabled (operator-managed demo)', () => {
  let service: AuthService;

  beforeEach(async () => {
    const redis = redisMock();
    const supabase: any = {
      authClient: { auth: { signInWithPassword: jest.fn(), resetPasswordForEmail: jest.fn() } },
      client: { from: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabase },
        { provide: JwtService, useValue: { signAsync: jest.fn(async () => 'jwt') } },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => key === 'PASSWORD_MANAGEMENT' ? 'disabled' : null) } },
        { provide: DeviceService, useValue: { registerDevice: jest.fn(async () => ({ device: null, isNew: false })) } },
        { provide: EmailService, useValue: {} },
        { provide: PlaybackGuardService, useValue: {} },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn(async () => {}) } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();
    service = module.get(AuthService);
    (service as any).supabase = supabase;
  });

  it('forgot password is blocked without issuing a reset email', async () => {
    const supabase = (service as any).supabaseService as any;
    await expect(service.forgotPassword('anyone@example.com')).rejects.toThrow(/managed by the demo operator/);
    expect(supabase.authClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('change password is blocked without touching Supabase Auth', async () => {
    const supabase = (service as any).supabaseService as any;
    const adminSpy = jest.fn();
    supabase.client = { auth: { admin: { updateUserById: adminSpy } }, from: jest.fn() };
    await expect(service.changePassword('u1', 'NewPass123', 'NewPass123')).rejects.toThrow(/managed by the demo operator/);
    expect(adminSpy).not.toHaveBeenCalled();
  });

  it('block message is identical regardless of address (no enumeration)', async () => {
    await expect(service.forgotPassword('a@example.com')).rejects.toThrow('Password changes are managed by the demo operator. Request fresh demo access if you need help signing in.');
    await expect(service.forgotPassword('b@example.com')).rejects.toThrow('Password changes are managed by the demo operator. Request fresh demo access if you need help signing in.');
  });
});

describe('AuthService — PASSWORD_MANAGEMENT enabled/default (client behavior)', () => {
  it('unset policy keeps forgot-password available (always-200, sends email)', async () => {
    const redis = redisMock();
    const resetSpy = jest.fn().mockResolvedValue({ error: null });
    const supabase: any = {
      authClient: { auth: { resetPasswordForEmail: resetSpy } },
      client: { from: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabase },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => key === 'FRONTEND_URL' ? 'http://localhost:3000' : undefined) } },
        { provide: DeviceService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: PlaybackGuardService, useValue: {} },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn(async () => {}) } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();
    const svc = module.get(AuthService);
    await expect(svc.forgotPassword('s@example.com')).resolves.toMatchObject({ message: expect.stringMatching(/reset link has been sent/) });
    expect(resetSpy).toHaveBeenCalled();
  });

  it.each(['nope', 'DISABLED', 'off', '0'])('invalid PASSWORD_MANAGEMENT=%p fails fast at startup', async (value) => {
    await expect(Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => k === 'PASSWORD_MANAGEMENT' ? value : null) } },
        { provide: DeviceService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: PlaybackGuardService, useValue: {} },
        { provide: ObservabilityService, useValue: {} },
        { provide: RedisService, useValue: { getOrThrow: () => redisMock() } },
      ],
    }).compile()).rejects.toThrow(/PASSWORD_MANAGEMENT/);
  });
});
describe('AuthService — SESSION_POLICY configuration', () => {
  it('unset SESSION_POLICY behaves exactly like single mode (409 on second login)', async () => {
    const redisLocal = redisMock();
    const supabaseLocal: any = {
      authClient: { auth: { signInWithPassword: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) } },
      client: { from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(async () => ({ data: { id: 'u1', name: 'S', email: 's@example.com', role: 'student', is_active: true, must_change_password: false }, error: null })),
      }) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabaseLocal },
        { provide: JwtService, useValue: { signAsync: jest.fn(async () => 'jwt') } },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: DeviceService, useValue: { registerDevice: jest.fn(async () => ({ device: null, isNew: false })) } },
        { provide: EmailService, useValue: {} },
        { provide: PlaybackGuardService, useValue: {} },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn(async () => {}) } },
        { provide: RedisService, useValue: { getOrThrow: () => redisLocal } },
      ],
    }).compile();
    const svc = mod.get(AuthService);
    await svc.login({ email: 's@example.com', password: 'p' } as any, '1.1.1.1', 'UA');
    await expect(svc.login({ email: 's@example.com', password: 'p' } as any, '1.1.1.1', 'UA')).rejects.toThrow(ConflictException);
  });

  it.each(['foo', 'MULTI', 'Single', ' multi', '0', 'true'])(
    'invalid SESSION_POLICY=%p fails fast at startup',
    async (value) => {
      await expect(Test.createTestingModule({
        providers: [
          AuthService,
          { provide: SupabaseService, useValue: {} },
          { provide: JwtService, useValue: {} },
          { provide: ConfigService, useValue: { get: jest.fn((k: string) => k === 'SESSION_POLICY' ? value : null) } },
          { provide: DeviceService, useValue: {} },
          { provide: EmailService, useValue: {} },
          { provide: PlaybackGuardService, useValue: {} },
          { provide: ObservabilityService, useValue: {} },
          { provide: RedisService, useValue: { getOrThrow: () => redisMock() } },
        ],
      }).compile()).rejects.toThrow(/SESSION_POLICY/);
    },
  );
});
