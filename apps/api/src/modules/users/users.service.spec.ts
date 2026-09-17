import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '@lms/shared-types';

// Helper to create a chainable mock builder that resolves to value
function chainMock(resolveValue: any) {
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resolveValue),
    single: jest.fn().mockResolvedValue(resolveValue),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolveValue).then(onFulfilled, onRejected),
    catch: (onRejected: any) => Promise.resolve(resolveValue).catch(onRejected),
  };
  // Make builder thenable so await works
  return builder;
}

describe('UsersService - manual onboarding', () => {
  let service: UsersService;
  let supabaseMock: any;
  let emailMock: any;

  beforeEach(async () => {
    supabaseMock = {
      client: {
        auth: {
          admin: {
            createUser: jest.fn(),
            deleteUser: jest.fn(),
            getUserById: jest.fn(),
          },
        },
        storage: {
          from: jest.fn().mockReturnValue({ remove: jest.fn().mockResolvedValue({ error: null }) }),
        },
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        single: jest.fn(),
        eq: jest.fn().mockReturnThis(),
      },
    };
    emailMock = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: AuthService, useValue: { forceLogoutUser: jest.fn().mockResolvedValue(undefined) } },
        { provide: EmailService, useValue: emailMock },
        { provide: RedisService, useValue: { getOrThrow: () => ({ del: jest.fn().mockResolvedValue(1), scan: jest.fn().mockResolvedValue(['0', []]), get: jest.fn().mockResolvedValue(null) }) } },
        { provide: RedisCacheService, useValue: { invalidateRecordingsCacheForUser: jest.fn().mockResolvedValue(undefined), invalidateCoursesCacheForUser: jest.fn().mockResolvedValue(undefined), invalidateSessionsCacheForUser: jest.fn().mockResolvedValue(undefined), invalidatePaymentsCacheForUser: jest.fn().mockResolvedValue(undefined), invalidateResultsCacheForUser: jest.fn().mockResolvedValue(undefined), invalidateTestsCacheForUser: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('creates new student with server-generated password, must_change_password true, email sent once, password not in response', async () => {
    const authUser = { id: 'uid-1', email: 'new@mcttest.com' };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseMock.client.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'uid-1', name: 'New Student', email: 'new@mcttest.com', role: 'student', must_change_password: true }, error: null }),
        }),
      }),
    } as any);

    const result: any = await service.create({ name: 'New Student', email: 'new@mcttest.com', role: UserRole.STUDENT } as any);

    expect(supabaseMock.client.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@mcttest.com', email_confirm: true }));
    const calledPassword = supabaseMock.client.auth.admin.createUser.mock.calls[0][0].password;
    expect(calledPassword).toMatch(/.{10}Aa1!/);
    expect(result.must_change_password).toBe(true);
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledWith('new@mcttest.com', 'New Student', expect.stringContaining('Aa1!'));
    expect(result.password).toBeUndefined();
  });

  it('does not expose password when client provides password explicitly', async () => {
    const authUser = { id: 'uid-2', email: 'withpwd@mcttest.com' };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseMock.client.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'uid-2', email: 'withpwd@mcttest.com' }, error: null }),
        }),
      }),
    } as any);

    const result: any = await service.create({ name: 'With Pwd', email: 'withpwd@mcttest.com', role: UserRole.STUDENT, password: 'MyPass123Aa1!' } as any);
    expect(supabaseMock.client.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ password: 'MyPass123Aa1!' }));
    expect(result.password).toBeUndefined();
  });

  it('student creation succeeds even if email fails', async () => {
    const authUser = { id: 'uid-3', email: 'nofail@mcttest.com' };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseMock.client.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'uid-3', email: 'nofail@mcttest.com' }, error: null }),
        }),
      }),
    } as any);
    emailMock.sendWelcomeEmail.mockRejectedValue(new Error('resend down'));

    const result: any = await service.create({ name: 'No Fail', email: 'nofail@mcttest.com', role: UserRole.STUDENT } as any);
    expect(result.id).toBe('uid-3');
  });
});

describe('UsersService - permanentDelete', () => {
  let service: UsersService;
  let supabaseMock: any;
  let authMock: any;
  let redisMock: any;
  let redisCacheMock: any;
  let auditMock: any;
  let storageRemoveMock: jest.Mock;

  const actorId = 'admin-actor-id';
  const targetId = 'student-target-id';
  const targetEmail = 'student@example.test';

  // Helper to configure supabaseMock.from behavior per table
  function setupSupabaseForCleanStudent(overrides: any = {}) {
    // Default counts = 0 for blockers
    const blockerCounts: Record<string, number> = {
      payments: 0,
      payment_plans: 0,
      invoices: 0,
      receipts: 0,
      test_results: 0,
      certificates: 0,
      attendance: 0,
      ...overrides.blockerCounts,
    };

    supabaseMock.client.from.mockImplementation((table: string) => {
      // Blocker checks — head:true counts
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) {
        const keyMap: Record<string, string> = { payments: 'payments', payment_plans: 'payment_plans', invoices: 'invoices', receipts: 'receipts', test_results: 'test_results', certificates: 'certificates', attendance: 'attendance' };
        const count = blockerCounts[keyMap[table] ?? table] ?? 0;
        if (overrides.forceFromError?.[table]) {
          return chainMock({ count: null, error: { message: 'db down' } });
        }
        return chainMock({ count, error: null, data: null });
      }
      if (table === 'profiles') {
        if (overrides.profileFetch) {
          // Single fetch for target
          if (overrides.profileFetch.notFound) {
            return chainMock({ data: null, error: { message: 'not found' } });
          }
          if (overrides.profileFetch.deletedVerify) {
            // verify after delete — maybeSingle
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
              delete: jest.fn().mockReturnThis(),
            } as any;
          }
        }
        // Default profile fetch returns student
        const profileData = overrides.profileData ?? { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA Student' };
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: profileData, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: profileData, error: null }),
          delete: jest.fn().mockReturnThis(),
        } as any;
      }
      if (table === 'test_attempts') {
        // Collect attempt IDs or used for blocker counts
        if (overrides.attemptIds) {
          return chainMock({ data: overrides.attemptIds.map((id: string) => ({ id })), error: null });
        }
        if (overrides.attemptIdsEmpty) {
          return chainMock({ data: [], error: null });
        }
        return chainMock({ data: [{ id: 'attempt-1' }], error: null });
      }
      if (table === 'test_answers') {
        if (overrides.storagePaths) {
          return chainMock({ data: overrides.storagePaths.map((p: string) => ({ answer: { storagePath: p } })), error: null });
        }
        return chainMock({ data: [], error: null });
      }
      // Fallback
      return chainMock({ data: [], error: null, count: 0 });
    });

    // Special handling for delete().eq().then — need to mock delete chain
    // We patch from to handle delete case more accurately
    const originalFrom = supabaseMock.client.from.getMockImplementation();
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles' && overrides.deleteError) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: targetId, email: targetEmail, role: 'student', is_active: true }, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: overrides.deleteError }),
          }),
        } as any;
      }
      if (table === 'profiles') {
        // Check if caller uses .delete()
        // We'll return a builder that supports both .select and .delete
        const studentProfile = overrides.profileData ?? { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA Student' };
        const isNotFound = overrides.profileFetch?.notFound;
        return {
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(isNotFound ? { data: null, error: { message: 'not found' } } : { data: studentProfile, error: null }),
          maybeSingle: jest.fn().mockImplementation(() => {
            // For verify step, if overrides.verifyProfileExists true, return data
            if (overrides.verifyProfileExists) return Promise.resolve({ data: { id: targetId }, error: null });
            // Otherwise for blocker checks, handled above
            // For verify after delete, return null
            if (overrides.deleteError) return Promise.resolve({ data: { id: targetId }, error: null });
            // After successful delete, verify should be null
            // Detect call context: if previously called delete, next select should be null
            // Simplify: return null (deleted)
            return Promise.resolve({ data: null, error: null });
          }),
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        } as any;
      }
      // For other tables, use original
      // Reuse blocker logic
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) {
        const count = blockerCounts[table] ?? 0;
        return chainMock({ count, error: null, data: null });
      }
      if (table === 'test_attempts') {
        const ids = overrides.attemptIds ?? [{ id: 'attempt-1' }];
        // If called with select('id') for collection, return ids
        return chainMock({ data: Array.isArray(ids) && typeof ids[0] === 'string' ? ids.map((id: string) => ({ id })) : ids, error: null });
      }
      if (table === 'test_answers') {
        if (overrides.storagePaths) {
          return chainMock({ data: overrides.storagePaths.map((p: string) => ({ answer: { storagePath: p } })), error: null });
        }
        return chainMock({ data: [], error: null });
      }
      return chainMock({ data: [], error: null, count: 0 });
    });
  }

  beforeEach(async () => {
    storageRemoveMock = jest.fn().mockResolvedValue({ error: null });
    supabaseMock = {
      client: {
        auth: {
          admin: {
            getUserById: jest.fn().mockResolvedValue({ data: { user: null }, error: { message: 'not found', status: 404 } }),
            deleteUser: jest.fn().mockResolvedValue({ error: null }),
            createUser: jest.fn(),
          },
        },
        storage: {
          from: jest.fn().mockReturnValue({ remove: storageRemoveMock, upload: jest.fn(), createSignedUrl: jest.fn() }),
        },
        from: jest.fn(),
      },
    };
    authMock = { forceLogoutUser: jest.fn().mockResolvedValue(undefined) };
    redisMock = { del: jest.fn().mockResolvedValue(1), scan: jest.fn().mockResolvedValue(['0', []]), get: jest.fn().mockResolvedValue(null), setex: jest.fn(), expire: jest.fn() };
    redisCacheMock = {
      invalidateRecordingsCacheForUser: jest.fn().mockResolvedValue(undefined),
      invalidateCoursesCacheForUser: jest.fn().mockResolvedValue(undefined),
      invalidateSessionsCacheForUser: jest.fn().mockResolvedValue(undefined),
      invalidatePaymentsCacheForUser: jest.fn().mockResolvedValue(undefined),
      invalidateResultsCacheForUser: jest.fn().mockResolvedValue(undefined),
      invalidateTestsCacheForUser: jest.fn().mockResolvedValue(undefined),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: AuthService, useValue: authMock },
        { provide: EmailService, useValue: { sendWelcomeEmail: jest.fn() } },
        { provide: RedisService, useValue: { getOrThrow: () => redisMock } },
        { provide: RedisCacheService, useValue: redisCacheMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('TEST 1 — Archive unchanged: remove sets is_active=false and does NOT delete auth', async () => {
    // Mock update path for soft delete
    supabaseMock.client.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    } as any);
    const result = await service.remove(targetId);
    expect(result.deleted).toBe(true);
    expect(supabaseMock.client.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(authMock.forceLogoutUser).toHaveBeenCalledWith(targetId);
  });

  it('TEST 2 — Hard delete clean student succeeds', async () => {
    setupSupabaseForCleanStudent({ attemptIds: [], storagePaths: [] });
    // Override from for profiles to handle both fetch and delete correctly
    // Use a more precise mock for this test
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: false, name: 'QA' };
    let deleteCalled = false;
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        if (deleteCalled) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
            delete: jest.fn().mockReturnThis(),
          } as any;
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: profileData, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockImplementation(() => { deleteCalled = true; return Promise.resolve({ error: null }); }),
          }),
        } as any;
      }
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) {
        return chainMock({ count: 0, error: null });
      }
      if (table === 'test_attempts') return chainMock({ data: [], error: null });
      if (table === 'test_answers') return chainMock({ data: [], error: null });
      return chainMock({ data: [], error: null });
    });
    supabaseMock.client.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'not found', status: 404 } as any }).mockResolvedValueOnce({ data: { user: null }, error: { message: 'not found', status: 404 } as any });

    const result = await service.permanentDelete(targetId, actorId);
    expect(result.deleted).toBe(true);
    expect(result.freedEmail).toBe(targetEmail);
    expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'permanent_deleted' }));
    expect(supabaseMock.client.auth.admin.deleteUser).toHaveBeenCalledWith(targetId);
    // Verify caches invalidated
    expect(redisCacheMock.invalidateRecordingsCacheForUser).toHaveBeenCalledWith(targetId);
  });

  it('TEST 4 — Payment blocker returns 409 and does not delete', async () => {
    setupSupabaseForCleanStudent({ blockerCounts: { payments: 1 } });
    // Mock profile fetch
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: profileData, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        } as any;
      }
      if (table === 'payments') return chainMock({ count: 1, error: null });
      if (['payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });

    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
    expect(supabaseMock.client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('TEST 5 — Payment plan blocker returns 409', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: profileData, error: null }),
          delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        } as any;
      }
      if (table === 'payment_plans') return chainMock({ count: 2, error: null });
      if (['payments', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
  });

  it('TEST 6 — Invoice blocker returns 409', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) } as any;
      if (table === 'invoices') return chainMock({ count: 1, error: null });
      if (['payments', 'payment_plans', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
  });

  it('TEST 7 — Receipt blocker returns 409', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) } as any;
      if (table === 'receipts') return chainMock({ count: 1, error: null });
      if (['payments', 'payment_plans', 'invoices', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
  });

  it('TEST 8 — Test result blocker returns 409', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) } as any;
      if (table === 'test_results') return chainMock({ count: 3, error: null });
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
  });

  it('TEST 9 — Certificate blocker returns 409', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) } as any;
      if (table === 'certificates') return chainMock({ count: 1, error: null });
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
  });

  it('TEST 10 — Attendance blocker returns 409', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) } as any;
      if (table === 'attendance') return chainMock({ count: 5, error: null });
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates'].includes(table)) return chainMock({ count: 0, error: null });
      return chainMock({ data: [], error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 409 });
  });

  it('TEST 11 — Teacher/admin protection returns 403', async () => {
    const teacherProfile = { id: targetId, email: targetEmail, role: 'teacher', is_active: true, name: 'Teacher' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: teacherProfile, error: null }), delete: jest.fn().mockReturnThis() } as any;
      return chainMock({ count: 0, error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 403 });

    const adminProfile = { id: targetId, email: targetEmail, role: 'admin', is_active: true, name: 'Admin' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: adminProfile, error: null }), delete: jest.fn().mockReturnThis() } as any;
      return chainMock({ count: 0, error: null });
    });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 403 });
  });

  it('TEST 12 — Self-delete returns 403', async () => {
    const profileData = { id: actorId, email: 'self@test.local', role: 'student', is_active: true, name: 'Self' };
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), delete: jest.fn().mockReturnThis() } as any;
      return chainMock({ count: 0, error: null });
    });
    await expect(service.permanentDelete(actorId, actorId)).rejects.toMatchObject({ status: 403 });
  });

  it('TEST 14 — Double delete is idempotent — profile missing but auth exists completes auth deletion', async () => {
    // First call: profile missing
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }), delete: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) } as any;
      return chainMock({ count: 0, error: null });
    });
    supabaseMock.client.auth.admin.getUserById.mockResolvedValue({ data: { user: { id: targetId, email: targetEmail } }, error: null } as any);
    supabaseMock.client.auth.admin.deleteUser.mockResolvedValue({ error: null } as any);

    const result = await service.permanentDelete(targetId, actorId);
    expect(result.deleted).toBe(true);
    expect(supabaseMock.client.auth.admin.deleteUser).toHaveBeenCalledWith(targetId);
  });

  it('TEST 14b — Double delete both missing returns 404', async () => {
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }), delete: jest.fn().mockReturnThis() } as any;
      return chainMock({ count: 0, error: null });
    });
    supabaseMock.client.auth.admin.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'not found', status: 404 } as any });
    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 404 });
  });

  it('TEST 15 — Auth failure recovery: profile deleted but auth delete fails returns retryable error', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    let deleteCalled = false;
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        if (deleteCalled) {
          return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }), single: jest.fn().mockResolvedValue({ data: null, error: null }), delete: jest.fn().mockReturnThis() } as any;
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: profileData, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          delete: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { deleteCalled = true; return Promise.resolve({ error: null }); }) }),
        } as any;
      }
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      if (table === 'test_attempts') return chainMock({ data: [], error: null });
      if (table === 'test_answers') return chainMock({ data: [], error: null });
      return chainMock({ data: [], error: null });
    });
    supabaseMock.client.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'supabase internal error', status: 500 } } as any);
    supabaseMock.client.auth.admin.getUserById.mockResolvedValue({ data: { user: { id: targetId, email: targetEmail } }, error: null } as any);

    await expect(service.permanentDelete(targetId, actorId)).rejects.toMatchObject({ status: 400 });
  });

  it('TEST 16 — Redis failure does not compromise DB/Auth correctness', async () => {
    // Simulate redis throwing
    const failingRedis = { del: jest.fn().mockRejectedValue(new Error('redis down')), scan: jest.fn().mockRejectedValue(new Error('redis down')), get: jest.fn().mockRejectedValue(new Error('redis down')) };
    // Re-create module with failing redis
    const failSupabaseMock: any = {
      client: {
        auth: { admin: { getUserById: jest.fn().mockResolvedValue({ data: { user: null }, error: { message: 'not found', status: 404 } as any }), deleteUser: jest.fn().mockResolvedValue({ error: null }) } },
        storage: { from: jest.fn().mockReturnValue({ remove: jest.fn().mockResolvedValue({ error: null }) }) },
        from: jest.fn(),
      },
    };
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    let del = false;
    failSupabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        if (del) return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }), single: jest.fn().mockResolvedValue({ data: null, error: null }), delete: jest.fn().mockReturnThis() } as any;
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { del = true; return Promise.resolve({ error: null }); }) }) } as any;
      }
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      if (table === 'test_attempts') return chainMock({ data: [], error: null });
      if (table === 'test_answers') return chainMock({ data: [], error: null });
      return chainMock({ data: [], error: null });
    });

    const failModule: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: failSupabaseMock },
        { provide: AuthService, useValue: { forceLogoutUser: jest.fn().mockRejectedValue(new Error('redis down')) } },
        { provide: EmailService, useValue: { sendWelcomeEmail: jest.fn() } },
        { provide: RedisService, useValue: { getOrThrow: () => failingRedis } },
        { provide: RedisCacheService, useValue: { invalidateRecordingsCacheForUser: jest.fn().mockRejectedValue(new Error('redis down')), invalidateCoursesCacheForUser: jest.fn().mockRejectedValue(new Error('down')), invalidateSessionsCacheForUser: jest.fn().mockRejectedValue(new Error('down')), invalidatePaymentsCacheForUser: jest.fn().mockRejectedValue(new Error('down')), invalidateResultsCacheForUser: jest.fn().mockRejectedValue(new Error('down')), invalidateTestsCacheForUser: jest.fn().mockRejectedValue(new Error('down')) } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    const failService = failModule.get<UsersService>(UsersService);
    const result = await failService.permanentDelete(targetId, actorId);
    expect(result.deleted).toBe(true);
  });

  it('TEST 17 — Storage ownership: only student-owned paths removed', async () => {
    const profileData = { id: targetId, email: targetEmail, role: 'student', is_active: true, name: 'QA' };
    const ownedPath = `question-answers/q-${targetId}-12345.png`;
    const otherPath = `question-answers/q-other-user-99999.png`;
    const adminPath = `question-answers/q-admin-id-11111.png`;

    let del = false;
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        if (del) return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }), single: jest.fn().mockResolvedValue({ data: null, error: null }), delete: jest.fn().mockReturnThis() } as any;
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: profileData, error: null }), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { del = true; return Promise.resolve({ error: null }); }) }) } as any;
      }
      if (['payments', 'payment_plans', 'invoices', 'receipts', 'test_results', 'certificates', 'attendance'].includes(table)) return chainMock({ count: 0, error: null });
      if (table === 'test_attempts') return chainMock({ data: [{ id: 'attempt-1' }], error: null });
      if (table === 'test_answers') return chainMock({ data: [{ answer: { storagePath: ownedPath } }, { answer: { storagePath: otherPath } }, { answer: { storagePath: adminPath } }, { answer: { url: 'no-storage' } }], error: null });
      return chainMock({ data: [], error: null });
    });
    supabaseMock.client.auth.admin.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'not found', status: 404 } as any });
    supabaseMock.client.auth.admin.deleteUser.mockResolvedValue({ error: null } as any);
    supabaseMock.client.storage.from.mockReturnValue({ remove: storageRemoveMock });

    await service.permanentDelete(targetId, actorId);
    expect(storageRemoveMock).toHaveBeenCalledWith([ownedPath]);
    expect(storageRemoveMock).not.toHaveBeenCalledWith(expect.arrayContaining([otherPath]));
    expect(storageRemoveMock).not.toHaveBeenCalledWith(expect.arrayContaining([adminPath]));
  });
});
