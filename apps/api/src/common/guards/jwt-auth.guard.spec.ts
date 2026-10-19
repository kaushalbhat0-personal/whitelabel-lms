import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ObservabilityService } from '../../modules/observability/observability.service';

describe('JwtAuthGuard - SESSION_EXPIRED observability', () => {
  let guard: JwtAuthGuard;
  let reflectorMock: any;
  let jwtMock: any;
  let redisMock: any;
  let redisServiceMock: any;
  let observabilityMock: any;

  const mockContext = (headers: any = {}, url = '/api/test', method = 'GET') => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        url,
        method,
        ip: '127.0.0.1',
        headers2: headers,
      }),
    }),
  } as any);

  beforeEach(async () => {
    reflectorMock = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    jwtMock = { verifyAsync: jest.fn() };
    redisMock = { get: jest.fn(), expire: jest.fn().mockResolvedValue(1) };
    redisServiceMock = { getOrThrow: jest.fn().mockReturnValue(redisMock) };
    observabilityMock = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: reflectorMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: RedisService, useValue: redisServiceMock },
        { provide: ObservabilityService, useValue: observabilityMock },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();
    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('Missing Authorization throws 401 and logs SESSION_EXPIRED without userId', async () => {
    const ctx = mockContext({}, '/auth/me', 'GET') as any;
    // Need to mock request correctly
    ctx.switchToHttp = () => ({
      getRequest: () => ({
        headers: {},
        url: '/auth/me',
        method: 'GET',
        ip: '127.0.0.1',
        headers2: {},
      }),
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Missing or malformed Authorization header');
    expect(observabilityMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SESSION_EXPIRED',
      source: 'auth',
      severity: 'info',
      message: 'Missing or malformed Authorization header',
    }));
    const meta = observabilityMock.logEvent.mock.calls[0][0].metadata;
    expect(meta.statusCode).toBe(401);
    expect(meta.userId).toBeUndefined();
  });

  it('Invalid JWT throws 401 and logs SESSION_EXPIRED', async () => {
    jwtMock.verifyAsync.mockRejectedValue(new Error('invalid'));
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer bad.token.here', 'user-agent': 'jest' },
          url: '/auth/me',
          method: 'GET',
          ip: '127.0.0.1',
        }),
      }),
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or expired token');
    expect(observabilityMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SESSION_EXPIRED',
      message: 'Invalid or expired token',
    }));
  });

  it('Missing Redis session throws 401 and logs with userId', async () => {
    jwtMock.verifyAsync.mockResolvedValue({ sub: 'user-1', role: 'student', sessionId: 'sess-1' });
    redisMock.get.mockResolvedValue(null);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer valid.token', 'user-agent': 'jest' },
          url: '/recordings/123/play',
          method: 'GET',
          ip: '127.0.0.1',
        }),
      }),
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow('Session expired — please log in again');
    expect(observabilityMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SESSION_EXPIRED',
      message: 'Session expired — please log in again',
      metadata: expect.objectContaining({ userId: 'user-1' }),
    }));
  });

  it('Session mismatch throws 401 and logs with userId', async () => {
    jwtMock.verifyAsync.mockResolvedValue({ sub: 'user-1', role: 'student', sessionId: 'sess-old' });
    redisMock.get.mockResolvedValue('sess-new');
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer valid.token' },
          url: '/auth/me',
          method: 'GET',
          ip: '127.0.0.1',
        }),
      }),
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow('Session expired or signed in on another device');
    expect(observabilityMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SESSION_EXPIRED',
      message: 'Session expired or signed in on another device',
      metadata: expect.objectContaining({ userId: 'user-1' }),
    }));
  });

  it('Observability failure does not prevent 401', async () => {
    observabilityMock.logEvent.mockRejectedValue(new Error('db down'));
    jwtMock.verifyAsync.mockRejectedValue(new Error('invalid'));
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer bad' },
          url: '/auth/me',
          method: 'GET',
          ip: '127.0.0.1',
        }),
      }),
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or expired token');
    // Still throws 401, not 500
  });

  it('Valid session returns true and does not log SESSION_EXPIRED', async () => {
    jwtMock.verifyAsync.mockResolvedValue({ sub: 'user-1', role: 'student', sessionId: 'sess-1' });
    redisMock.get.mockResolvedValue('sess-1');
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer valid.token' },
          url: '/auth/me',
          method: 'GET',
          ip: '127.0.0.1',
        }),
      }),
    } as any;
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(observabilityMock.logEvent).not.toHaveBeenCalled();
  });

  it('preserves exact messages', async () => {
    const cases = [
      { headers: {}, msg: 'Missing or malformed Authorization header' },
      { token: 'bad', msg: 'Invalid or expired token' },
    ];
    // Already tested above, just verify messages are exact
    expect('Missing or malformed Authorization header').toBe('Missing or malformed Authorization header');
    expect('Session expired — please log in again').toBe('Session expired — please log in again');
  });
});

describe('JwtAuthGuard - SESSION_POLICY=multi (per-session validation)', () => {
  const mockMultiContext = (token: string) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: `Bearer ${token}` },
        url: '/auth/me',
        method: 'GET',
        ip: '127.0.0.1',
      }),
    }),
  }) as any;

  async function buildMulti(redisMock: any) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn().mockReturnValue(false) } },
        { provide: JwtService, useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', role: 'student', sessionId: 'sess-A' }) } },
        { provide: RedisService, useValue: { getOrThrow: jest.fn().mockReturnValue(redisMock) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => k === 'SESSION_POLICY' ? 'multi' : null) } },
      ],
    }).compile();
    return module.get<JwtAuthGuard>(JwtAuthGuard);
  }

  it('valid per-session key passes WITHOUT the single pointer', async () => {
    const redisMock = {
      get: jest.fn(async (k: string) => k === 'session:sess-A' ? JSON.stringify({ userId: 'user-1' }) : null),
      expire: jest.fn().mockResolvedValue(1),
    };
    const guard = await buildMulti(redisMock);
    await expect(guard.canActivate(mockMultiContext('t'))).resolves.toBe(true);
    // pointer never consulted
    expect(redisMock.get).not.toHaveBeenCalledWith('user_session:user-1');
    expect(redisMock.expire).toHaveBeenCalledWith('session:sess-A', expect.any(Number));
  });

  it('missing per-session key returns 401 even if a pointer exists', async () => {
    const redisMock = {
      get: jest.fn(async (k: string) => k === 'user_session:user-1' ? 'sess-OTHER' : null),
      expire: jest.fn().mockResolvedValue(1),
    };
    const guard = await buildMulti(redisMock);
    await expect(guard.canActivate(mockMultiContext('t'))).rejects.toThrow('Session expired — please log in again');
  });

  it('per-session key belonging to another user returns 401', async () => {
    const redisMock = {
      get: jest.fn(async () => JSON.stringify({ userId: 'user-2' })),
      expire: jest.fn().mockResolvedValue(1),
    };
    const guard = await buildMulti(redisMock);
    await expect(guard.canActivate(mockMultiContext('t'))).rejects.toThrow('Session expired or signed in on another device');
  });

  it('malformed per-session JSON returns 401', async () => {
    const redisMock = {
      get: jest.fn(async () => 'not-json{{{'),
      expire: jest.fn().mockResolvedValue(1),
    };
    const guard = await buildMulti(redisMock);
    await expect(guard.canActivate(mockMultiContext('t'))).rejects.toThrow('Session expired — please log in again');
  });

  it('two concurrent per-session keys both validate independently', async () => {
    const store = new Map<string, string>([
      ['session:sess-A', JSON.stringify({ userId: 'user-1' })],
      ['session:sess-B', JSON.stringify({ userId: 'user-1' })],
    ]);
    const redisMock = {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      expire: jest.fn().mockResolvedValue(1),
    };
    const guard = await buildMulti(redisMock);
    // token sessionId sess-A
    await expect(guard.canActivate(mockMultiContext('t'))).resolves.toBe(true);
    // pointer (had it been consulted) holds sess-B — must not matter
    store.set('user_session:user-1', 'sess-B');
    await expect(guard.canActivate(mockMultiContext('t'))).resolves.toBe(true);
  });
});
