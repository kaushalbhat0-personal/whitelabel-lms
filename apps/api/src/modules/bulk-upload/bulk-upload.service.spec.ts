import { Test, TestingModule } from '@nestjs/testing';
import { BulkUploadService } from './bulk-upload.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { BatchesService } from '../batches/batches.service';

describe('BulkUploadService - onboarding', () => {
  let service: BulkUploadService;
  let supabaseMock: any;
  let emailMock: any;
  let batchesMock: any;

  const mockProfileLookup = (found: boolean, id = 'uid-exists', email = 'exists@mcttest.com') => {
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          upsert: jest.fn().mockReturnValue({ error: null }),
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue(found ? { data: { id, email } } : { data: null }),
        } as any;
      }
      if (table === 'batches') {
        return {
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        } as any;
      }
      if (table === 'courses') {
        return {
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        } as any;
      }
      return {
        select: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
  };

  beforeEach(async () => {
    supabaseMock = {
      client: {
        auth: { admin: { createUser: jest.fn(), listUsers: jest.fn(), deleteUser: jest.fn().mockResolvedValue({ error: null }) } },
        from: jest.fn(),
      },
    };
    emailMock = { sendWelcomeEmail: jest.fn().mockResolvedValue(true) };
    batchesMock = { assignStudentToBatch: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkUploadService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: EmailService, useValue: emailMock },
        { provide: BatchesService, useValue: batchesMock },
      ],
    }).compile();
    service = module.get<BulkUploadService>(BulkUploadService);

    // Default from chain for profiles upsert success and lookup not found
    mockProfileLookup(false);
  });

  it('new student gets generated password and welcome email with same password', async () => {
    const user = { name: 'New Bulk', email: 'newbulk@mcttest.com', rowNumber: 1 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-new' } }, error: null });

    const result: any = await (service as any).processSingleRow(user, {});

    expect(supabaseMock.client.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'newbulk@mcttest.com' }));
    const sentPassword = supabaseMock.client.auth.admin.createUser.mock.calls[0][0].password;
    expect(sentPassword).toMatch(/.{10}Aa1!/);
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledWith('newbulk@mcttest.com', 'New Bulk', sentPassword);
    expect(result.status).toBe('success');
    expect(result.warning).toBeUndefined();
  });

  it('existing user preserves password, no fabricated email (profiles lookup)', async () => {
    const user = { name: 'Existing', email: 'exists@mcttest.com', rowNumber: 2 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } as any });
    mockProfileLookup(true, 'uid-exists', 'exists@mcttest.com');
    // upsert still succeeds
    const result: any = await (service as any).processSingleRow(user, {});
    expect(result.status).toBe('success');
    expect(result.warning).toMatch(/already exists.*welcome email not sent/i);
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(supabaseMock.client.auth.admin.listUsers).not.toHaveBeenCalled();
  });

  it('email failure still success with warning, no password in warning', async () => {
    const user = { name: 'Email Fail', email: 'emailfail@mcttest.com', rowNumber: 3 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-3' } }, error: null });
    emailMock.sendWelcomeEmail.mockResolvedValue(false); // suppressed/failed

    const result: any = await (service as any).processSingleRow(user, {});
    expect(result.status).toBe('success');
    expect(result.warning).toMatch(/welcome email failed/i);
    expect(result.warning).not.toMatch(/Aa1!/);
  });

  it('NEW USER + PROFILE FAILURE compensates auth user', async () => {
    const user = { name: 'Fail Profile', email: 'failprofile@mcttest.com', rowNumber: 4 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    // profile upsert fails
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          upsert: jest.fn().mockReturnValue({ error: { message: 'db fail' } }),
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        } as any;
      }
      return {
        select: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
    const result: any = await (service as any).processSingleRow(user, {});
    expect(supabaseMock.client.auth.admin.deleteUser).toHaveBeenCalledWith('u1');
    expect(supabaseMock.client.auth.admin.deleteUser).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failure');
    expect(result.error).toMatch(/Profile insert failed/);
  });

  it('EXISTING USER + PROFILE FAILURE does NOT delete', async () => {
    const user = { name: 'Exists Fail', email: 'existsfail@mcttest.com', rowNumber: 5 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'already registered' } as any });
    // existing profile found
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          upsert: jest.fn().mockReturnValue({ error: { message: 'db fail' } }),
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'uid-exists', email: 'existsfail@mcttest.com' } }),
        } as any;
      }
      return {
        select: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
    const result: any = await (service as any).processSingleRow(user, {});
    expect(supabaseMock.client.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(result.status).toBe('failure');
  });

  it('AUTH EXISTS BUT PROFILE MISSING controlled failure no delete', async () => {
    const user = { name: 'Orphan', email: 'orphan@mcttest.com', rowNumber: 6 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } as any });
    mockProfileLookup(false);
    const result: any = await (service as any).processSingleRow(user, {});
    expect(result.status).toBe('failure');
    expect(result.error).toMatch(/profile not found — contact support/i);
    expect(supabaseMock.client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('DUPLICATE EMAIL SAME CSV deduped case-insensitive', async () => {
    // Simulate processJobInBackground dedupe: call directly via processJobInBackground behavior is tested via integration
    // Here test dedupe logic by calling processJobInBackground with 3 duplicate parsed users
    const parsedUsers = [
      { name: 'A', email: 'a@b.com', rowNumber: 1 },
      { name: 'B', email: 'A@b.com', rowNumber: 2 },
      { name: 'C', email: ' a@b.com ', rowNumber: 3 },
      { name: 'D', email: 'd@b.com', rowNumber: 4 },
    ];
    // Mock bulk_upload_jobs insert/update
    const jobFrom = jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'job1' }, error: null }) }) }),
    });
    const updateMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'bulk_upload_jobs') {
        return {
          insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'job1' }, error: null }) }) }),
          update: updateMock,
        } as any;
      }
      if (table === 'profiles') {
        return {
          upsert: jest.fn().mockReturnValue({ error: null }),
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        } as any;
      }
      return {
        select: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-x' } }, error: null });
    // Call processJobInBackground and inspect results via update call
    await (service as any).processJobInBackground('job1', parsedUsers, {}, 'admin1');
    // createUser should be called only twice (a@b.com once + d@b.com once), duplicates are failures in results
    expect(supabaseMock.client.auth.admin.createUser).toHaveBeenCalledTimes(2);
    const updateArg = updateMock.mock.calls[0][0];
    const failures = updateArg.failures;
    const dupFailures = failures.filter((r: any) => r.error && r.error.includes('Duplicate email in file'));
    expect(dupFailures.length).toBe(2);
    expect(dupFailures[0].email).toBe('A@b.com');
  });

  it('EXISTING USER beyond first 50 found via profiles ilike', async () => {
    const user = { name: 'Far User', email: 'far@mcttest.com', rowNumber: 7 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } as any });
    mockProfileLookup(true, 'uid-far', 'far@mcttest.com');
    const result: any = await (service as any).processSingleRow(user, {});
    expect(result.status).toBe('success');
    expect(supabaseMock.client.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(result.warning).toMatch(/already exists/);
  });

  it('dto.batchId is authoritative — CSV batchName ignored', async () => {
    const user = { name: 'Wrong Batch User', email: 'wrongbatch@mcttest.com', batchName: 'Wrong Batch', courseName: 'Wrong Course', rowNumber: 10 };
    const dto = { batchId: '11111111-1111-4111-a111-111111111111' };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-wrong' } }, error: null });
    // track if batches table is queried (would indicate lookupBatchByName called)
    const fromSpy = jest.fn((table: string) => {
      if (table === 'profiles') {
        return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
      }
      if (table === 'batches' || table === 'courses') {
        throw new Error(`lookupBatchByName should NOT be called when dto.batchId is present (queried ${table})`);
      }
      return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
    });
    // Preserve original from for non-batches but ensure no batches/courses call leaks
    // We intercept via spying on client.from after mockProfileLookup sets it; instead override directly
    supabaseMock.client.from = fromSpy;
    // Still need profiles upsert mock for other table uses in service (but we threw for batches/courses only)
    // Mock implementation that returns valid for profiles
    const originalFrom = fromSpy;
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
      if (table === 'batches' || table === 'courses') throw new Error(`lookupBatchByName should NOT be called — got ${table}`);
      return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
    });

    // Re-mock to simple success for profiles upsert check above: reset to working mock
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
      throw new Error(`Unexpected table ${table} — lookup should not happen`);
    });
    batchesMock.assignStudentToBatch.mockClear();

    const result: any = await (service as any).processSingleRow(user, dto);

    expect(batchesMock.assignStudentToBatch).toHaveBeenCalledWith('11111111-1111-4111-a111-111111111111', 'uid-wrong');
    expect(batchesMock.assignStudentToBatch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.batchAssigned).toBe(true);
    // Should NOT have batch not-found warning because CSV wrong batch is ignored
    expect(result.warning ?? '').not.toMatch(/batch "Wrong Batch" not found/i);
    expect(result.warning ?? '').not.toMatch(/Multiple batches matched/i);
  });

  it('dto.batchId with empty CSV batchName still assigns', async () => {
    const user = { name: 'Empty Batch', email: 'emptybatch@mcttest.com', rowNumber: 11 };
    const dto = { batchId: '22222222-2222-4222-b222-222222222222' };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-empty' } }, error: null });
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
      throw new Error(`Unexpected table ${table}`);
    });
    batchesMock.assignStudentToBatch.mockClear();

    const result: any = await (service as any).processSingleRow(user, dto);
    expect(batchesMock.assignStudentToBatch).toHaveBeenCalledWith('22222222-2222-4222-b222-222222222222', 'uid-empty');
    expect(result.batchAssigned).toBe(true);
  });

  it('dto.batchId overrides different CSV batchName across rows', async () => {
    const dto = { batchId: '33333333-3333-4333-c333-333333333333' };
    const users = [
      { name: 'A', email: 'a-override@mcttest.com', batchName: 'Batch A', rowNumber: 20 },
      { name: 'B', email: 'b-override@mcttest.com', batchName: 'Batch B', rowNumber: 21 },
    ];
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-override' } }, error: null });
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
      throw new Error(`Unexpected table ${table}`);
    });
    batchesMock.assignStudentToBatch.mockClear();
    for (const u of users) {
      supabaseMock.client.auth.admin.createUser.mockResolvedValueOnce({ data: { user: { id: `uid-${u.email}` } }, error: null });
      const r: any = await (service as any).processSingleRow(u, dto);
      expect(r.batchAssigned).toBe(true);
    }
    expect(batchesMock.assignStudentToBatch).toHaveBeenCalledTimes(2);
    expect(batchesMock.assignStudentToBatch).toHaveBeenCalledWith('33333333-3333-4333-c333-333333333333', expect.any(String));
  });

  it('legacy: no dto.batchId falls back to CSV batchName lookup', async () => {
    const user = { name: 'Legacy', email: 'legacy@mcttest.com', batchName: 'Real Batch', courseName: 'Real Course', rowNumber: 30 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'uid-legacy' } }, error: null });
    // Mock lookup to return a batch
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
      }
      if (table === 'courses') {
        return {
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'course-1' } }),
        } as any;
      }
      if (table === 'batches') {
        return {
          select: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [{ id: 'batch-legacy-id' }], error: null }),
        } as any;
      }
      return { upsert: jest.fn().mockReturnValue({ error: null }) } as any;
    });
    batchesMock.assignStudentToBatch.mockClear();

    const result: any = await (service as any).processSingleRow(user, {});
    expect(batchesMock.assignStudentToBatch).toHaveBeenCalledWith('batch-legacy-id', 'uid-legacy');
    expect(result.batchAssigned).toBe(true);
  });
});
