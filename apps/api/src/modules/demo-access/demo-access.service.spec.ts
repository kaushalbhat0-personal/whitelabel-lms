import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { DemoAccessService, DEMO_SHOWCASE_BATCH_ENV } from './demo-access.service';
import { DemoAccessController } from './demo-access.controller';
import { DemoAccessRequestDto } from './dto/demo-access-request.dto';
import { SupabaseService } from '../../common/services/supabase.service';
import { ObservabilityService } from '../observability/observability.service';
import { UserRole } from '@lms/shared-types';

function redisMock() {
  const store = new Map<string, string>();
  return {
    incr: jest.fn(async (k: string) => {
      const v = parseInt(store.get(k) ?? '0', 10) + 1;
      store.set(k, String(v));
      return v;
    }),
    decr: jest.fn(async (k: string) => {
      const v = parseInt(store.get(k) ?? '0', 10) - 1;
      store.set(k, String(v));
      return v;
    }),
    expire: jest.fn(async () => 1),
    _store: store,
  };
}

function supabaseMock() {
  return {
    client: {
      auth: {
        admin: {
          createUser: jest.fn(),
          deleteUser: jest.fn(async () => ({ data: {}, error: null })),
        },
      },
      from: jest.fn(),
    },
  };
}

describe('DemoAccessService', () => {
  let service: DemoAccessService;
  let controller: DemoAccessController;
  let supabase: ReturnType<typeof supabaseMock>;
  let redis: ReturnType<typeof redisMock>;
  let obs: { logEvent: jest.Mock };

  const SHOWCASE_BATCH_ID = '11111111-1111-4111-8111-111111111111';

  const configFor = (policy: string | undefined, showcase: string | null = SHOWCASE_BATCH_ID) =>
    ({
      get: jest.fn((key: string) => {
        if (key === 'TEMP_DEMO_ACCESS') return policy;
        // null sentinel = env var missing entirely (ConfigService returns undefined).
        if (key === DEMO_SHOWCASE_BATCH_ENV) return showcase === null ? undefined : showcase;
        if (key === 'FRONTEND_URL') return 'https://demo.example.com';
        return undefined;
      }),
    }) as any;

  async function buildModule(policy: string | undefined, showcase: string | null = SHOWCASE_BATCH_ID) {
    supabase = supabaseMock();
    redis = redisMock();
    obs = { logEvent: jest.fn(async () => {}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemoAccessController],
      providers: [
        DemoAccessService,
        { provide: SupabaseService, useValue: supabase },
        { provide: ConfigService, useValue: configFor(policy, showcase) },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
        { provide: ObservabilityService, useValue: obs },
      ],
    }).compile();

    service = module.get(DemoAccessService);
    controller = module.get(DemoAccessController);
  }

  function batchLookupMock(row: { id: string } | null) {
    const maybeSingle = jest.fn(async () => ({ data: row, error: null }));
    const eq = jest.fn(() => ({ maybeSingle }));
    return { select: jest.fn(() => ({ eq })), eq, maybeSingle };
  }

  function tableMock(table: string) {
    if (table === 'batches') return batchLookupMock({ id: SHOWCASE_BATCH_ID });
    if (table === 'batch_students')
      return {
        upsert: jest.fn(async () => ({ error: null })),
        delete: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
      };
    if (table === 'profiles')
      return {
        insert: jest.fn(async () => ({ error: null })),
        delete: jest.fn(() => ({
          eq: jest.fn(() => ({ not: jest.fn(async () => ({ error: null })) })),
        })),
      };
    return {};
  }

  function mockSuccess() {
    supabase.client.auth.admin.createUser.mockImplementation(async ({ email }: any) => ({
      data: { user: { id: `auth-${email}` } },
      error: null,
    }));
    supabase.client.from.mockImplementation(tableMock);
  }

  beforeEach(async () => {
    await buildModule('enabled');
    mockSuccess();
  });

  it('issues a temporary STUDENT account with ~30min expiry and one-time credentials', async () => {
    const before = Date.now();
    const result = await controller.create({} as any, { ip: '9.9.9.9', headers: {} } as any);

    expect(result.loginUrl).toBe('https://demo.example.com/login');
    expect(result.username).toMatch(/^demo-[0-9a-f]{16}@demo\.invalid$/);
    expect(result.password).toMatch(/^[A-Za-z0-9\-_]{32}$/);
    const expiresMs = new Date(result.expiresAt).getTime() - before;
    expect(expiresMs).toBeGreaterThan(29 * 60 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(31 * 60 * 1000);

    // Profile insert: hardcoded student, active, no forced password change, expires_at set.
    const insertArg = supabase.client.from.mock.calls[0][0];
    expect(insertArg).toBe('profiles');
    const insertPayload = supabase.client.from.mock.results[0].value.insert.mock.calls[0][0];
    expect(insertPayload).toMatchObject({
      role: UserRole.STUDENT,
      is_active: true,
      must_change_password: false,
    });
    expect(insertPayload.role).not.toBe(UserRole.ADMIN);
    expect(typeof insertPayload.expires_at).toBe('string');
    expect(insertPayload.password).toBeUndefined();

    // createUser used email_confirm (no welcome/verification email path exists here).
    expect(supabase.client.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: result.username, email_confirm: true }),
    );
  });

  it('never exposes password/token in observability metadata or error paths', async () => {
    const result = await service.issue('1.2.3.4');
    const allMeta = obs.logEvent.mock.calls.map((c: any[]) => JSON.stringify(c[0]));
    expect(allMeta.join('\n')).not.toContain(result.password);
    expect(allMeta.join('\n')).not.toContain('password');
    expect(obs.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'demo_access_created' }),
    );

    // Failure path: sanitized neutral error, no Supabase message leaked.
    supabase.client.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'connection refused (db secret)' },
    });
    let caught: any = null;
    try {
      await service.issue('5.6.7.8');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(caught.message).not.toContain('connection refused');
    expect(caught.message).not.toContain('secret');
    expect(caught.message).toBe('Demo access is temporarily unavailable. Please try again later.');
    // Rollback attempted for the orphan Auth user when profile insert fails.
    supabase.client.from.mockReturnValueOnce({
      insert: jest.fn(async () => ({ error: { message: 'db down' } })),
    });
    supabase.client.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'orphan-1' } },
      error: null,
    });
    caught = null;
    try {
      await service.issue('5.6.7.9');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(supabase.client.auth.admin.deleteUser).toHaveBeenCalledWith('orphan-1');
  });

  it('retries once on identity collision (still independent, still student)', async () => {
    supabase.client.auth.admin.createUser
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'User already registered' } })
      .mockImplementationOnce(async ({ email }: any) => ({
        data: { user: { id: `auth-${email}` } },
        error: null,
      }));
    const result = await service.issue('7.7.7.7');
    expect(result.username).toMatch(/^demo-[0-9a-f]{16}@demo\.invalid$/);
    expect(supabase.client.auth.admin.createUser).toHaveBeenCalledTimes(2);
  });

  it('enforces per-IP cap (3/hour) with a neutral message', async () => {
    for (let i = 0; i < 3; i++) {
      await service.issue('10.0.0.1');
    }
    let caught: any = null;
    try {
      await service.issue('10.0.0.1');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(caught.message).toBe('Demo access is temporarily unavailable. Please try again later.');
    expect(obs.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'demo_access_rate_limited' }),
    );
    // A different IP is unaffected.
    const ok = await service.issue('10.0.0.2');
    expect(ok.username).toMatch(/@demo\.invalid$/);
  });

  it('failed attempts release their slot (no quota burn)', async () => {
    supabase.client.auth.admin.createUser.mockRejectedValueOnce(new Error('boom'));
    await expect(service.issue('10.1.1.1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    // 3 more successes must still fit within the per-IP cap.
    await service.issue('10.1.1.1');
    await service.issue('10.1.1.1');
    await service.issue('10.1.1.1');
  });

  it('concurrent issuance creates independent accounts (10 parallel)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => service.issue(`192.168.1.${i}`)),
    );
    const usernames = new Set(results.map((r) => r.username));
    const passwords = new Set(results.map((r) => r.password));
    expect(usernames.size).toBe(10);
    expect(passwords.size).toBe(10);
  });

  it('disabled policy behaves as absent (404)', async () => {
    await buildModule('disabled');
    let caught: any = null;
    try {
      await controller.create({} as any, { ip: '1.1.1.1', headers: {} } as any);
    } catch (e: any) {
      caught = e;
    }
    expect(caught?.getStatus?.()).toBe(404);
    expect(supabase.client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('unset policy behaves as absent (404)', async () => {
    await buildModule(undefined);
    await expect(
      controller.create({} as any, { ip: '1.1.1.1', headers: {} } as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects any request body property (caller controls nothing)', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform({ role: 'admin' }, { type: 'body', metatype: DemoAccessRequestDto } as any),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ email: 'x@y.z' }, { type: 'body', metatype: DemoAccessRequestDto } as any),
    ).rejects.toThrow();
    const ok = await pipe.transform({}, { type: 'body', metatype: DemoAccessRequestDto } as any);
    expect(ok).toBeInstanceOf(DemoAccessRequestDto);
  });

  it('enrolls the temporary user in exactly the showcase batch (idempotent upsert)', async () => {
    const result = await service.issue('20.0.0.1');

    const batchCalls = supabase.client.from.mock.calls
      .map((c: any[], i: number) => ({ table: c[0], value: supabase.client.from.mock.results[i].value }))
      .filter((c: any) => c.table === 'batch_students');
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].value.upsert).toHaveBeenCalledWith(
      { batch_id: SHOWCASE_BATCH_ID, user_id: `auth-${result.username}` },
      { onConflict: 'batch_id,user_id' },
    );
    expect(batchCalls[0].value.upsert).toHaveBeenCalledTimes(1);
  });

  it('missing showcase config fails closed: no credentials, rollback, slot released', async () => {
    await buildModule('enabled', null);
    mockSuccess();

    let caught: any = null;
    try {
      await service.issue('21.0.0.1');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(caught.message).toBe('Demo access is temporarily unavailable. Please try again later.');
    // Partial identity rolled back: profile delete attempted + Auth user removed.
    expect(supabase.client.auth.admin.deleteUser).toHaveBeenCalled();
    // Slot released: reserved counters return to zero (failures never burn quota).
    expect(redis._store.get('demo_access:ip:21.0.0.1')).toBe('0');
  });

  it('malformed showcase config fails closed without leaking the value', async () => {
    await buildModule('enabled', 'not-a-uuid');
    mockSuccess();

    let caught: any = null;
    try {
      await service.issue('22.0.0.1');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(caught.message).not.toContain('not-a-uuid');
    expect(JSON.stringify(obs.logEvent.mock.calls)).not.toContain('not-a-uuid');
    expect(supabase.client.auth.admin.deleteUser).toHaveBeenCalled();
  });

  it('unknown showcase batch (no row) fails closed', async () => {
    supabase.client.from.mockImplementation((table: string) => {
      if (table === 'batches') return batchLookupMock(null);
      return tableMock(table);
    });

    let caught: any = null;
    try {
      await service.issue('23.0.0.1');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(supabase.client.auth.admin.deleteUser).toHaveBeenCalled();
    // No enrollment upsert attempted when the batch does not exist
    // (the batch_students touch is rollback's best-effort delete only).
    const upsertCalls = supabase.client.from.mock.results
      .map((r: any) => r.value?.upsert)
      .filter(Boolean)
      .flatMap((u: jest.Mock) => u.mock.calls);
    expect(upsertCalls).toHaveLength(0);
  });

  it('enrollment upsert failure rolls back Auth user and profile', async () => {
    supabase.client.from.mockImplementation((table: string) => {
      if (table === 'batch_students')
        return {
          upsert: jest.fn(async () => ({ error: { message: 'fk violation (secret)' } })),
          delete: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
        };
      return tableMock(table);
    });

    let caught: any = null;
    try {
      await service.issue('24.0.0.1');
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect(caught.message).not.toContain('fk violation');
    expect(caught.message).not.toContain('secret');
    expect(supabase.client.auth.admin.deleteUser).toHaveBeenCalled();
    expect(JSON.stringify(obs.logEvent.mock.calls)).not.toContain(SHOWCASE_BATCH_ID);
  });

  it('two temporary students share the showcase batch with independent identities', async () => {
    const a = await service.issue('25.0.0.1');
    const b = await service.issue('25.0.0.2');
    expect(a.username).not.toBe(b.username);
    expect(a.password).not.toBe(b.password);

    const upserts = supabase.client.from.mock.results
      .map((r: any) => r.value?.upsert)
      .filter(Boolean)
      .flatMap((u: jest.Mock) => u.mock.calls.map((c: any[]) => c[0]));
    expect(upserts).toHaveLength(2);
    expect(upserts[0].batch_id).toBe(SHOWCASE_BATCH_ID);
    expect(upserts[1].batch_id).toBe(SHOWCASE_BATCH_ID);
    expect(upserts[0].user_id).not.toBe(upserts[1].user_id);
  });
});
