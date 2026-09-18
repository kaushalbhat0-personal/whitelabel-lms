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
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (...keys: string[]) => { keys.forEach(k => store.delete(k)); return keys.length; }),
    incr: jest.fn(async (k: string) => { const v = (parseInt(store.get(k) ?? '0', 10) + 1).toString(); store.set(k, v); return parseInt(v, 10); }),
    expire: jest.fn(async () => 1),
    keys: jest.fn(async () => []),
    _store: store,
  };
}

describe('AuthService — one-device graceful replacement', () => {
  let service: AuthService;
  let redis: ReturnType<typeof redisMock>;
  let supabase: any;
  let jwt: any;

  const profile = { id: 'u1', name: 'Student', email: 's@mct.com', role: 'student', is_active: true, must_change_password: false };

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
        { provide: ConfigService, useValue: { get: jest.fn(() => 'https://mctlms-web.vercel.app') } },
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
    const result = await service.login({ email: 's@mct.com', password: 'pass123' } as any, '1.1.1.1', 'UA');
    expect(result.token).toBe('jwt-token');
    expect(redis.setex).toHaveBeenCalledWith(expect.stringContaining('user_session:u1'), expect.any(Number), expect.any(String));
  });

  it('TEST 2: active session exists → revoked and SESSION_REPLACED, no new session created', async () => {
    // Pre-seed an active session
    await redis.setex('user_session:u1', 86400, 'old-session-id');
    await redis.setex('session:old-session-id', 86400, JSON.stringify({ userId: 'u1' }));

    let caught: any = null;
    try {
      await service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
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
    await expect(service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    // Old session should now be invalid
    expect(await service.validateSession('u1', 'old-id')).toBe(false);
  });

  it('TEST 4: second login after replacement succeeds', async () => {
    await redis.setex('user_session:u1', 86400, 'old-id');
    await redis.setex('session:old-id', 86400, '{}');
    await expect(service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    // Now no active session, next login should succeed
    const result = await service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
    expect(result.token).toBe('jwt-token');
    const newSession = await redis.get('user_session:u1');
    expect(newSession).toBeTruthy();
    expect(newSession).not.toBe('old-id');
  });

  it('TEST 5: wrong password still produces normal 401, not SESSION_REPLACED', async () => {
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid' } } as any);
    await expect(service.login({ email: 's@mct.com', password: 'wrong' } as any, '3.3.3.3', 'UA')).rejects.toThrow(UnauthorizedException);
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
    await expect(service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
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
    await expect(service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA')).rejects.toThrow(ConflictException);
    expect(playbackGuard.revokeUserTokens).not.toHaveBeenCalled();
    // Retry
    const result = await service.login({ email: 's@mct.com', password: 'pass123' } as any, '2.2.2.2', 'UA');
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
});
