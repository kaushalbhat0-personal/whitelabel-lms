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

  beforeEach(async () => {
    supabaseMock = {
      client: {
        auth: { admin: { createUser: jest.fn(), listUsers: jest.fn() } },
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

    // Default from chain for profiles upsert success
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          upsert: jest.fn().mockReturnValue({ error: null }),
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

  it('existing user preserves password, no fabricated email', async () => {
    const user = { name: 'Existing', email: 'exists@mcttest.com', rowNumber: 2 };
    supabaseMock.client.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } as any });
    supabaseMock.client.auth.admin.listUsers.mockResolvedValue({ data: { users: [{ id: 'uid-exists', email: 'exists@mcttest.com' }] } } as any);

    const result: any = await (service as any).processSingleRow(user, {});
    expect(result.status).toBe('success');
    expect(result.warning).toMatch(/already exists.*welcome email not sent/i);
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled();
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
});
