import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '@lms/shared-types';

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
          },
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
        { provide: AuthService, useValue: { forceLogoutUser: jest.fn() } },
        { provide: EmailService, useValue: emailMock },
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
    expect(calledPassword).toMatch(/.{10}Aa1!/); // 10 hex + Aa1!
    expect(result.must_change_password).toBe(true);
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledWith('new@mcttest.com', 'New Student', expect.stringContaining('Aa1!'));
    // password not in response
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
    // still created
  });
});
