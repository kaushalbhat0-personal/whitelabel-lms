import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseService } from '../../common/services/supabase.service';

describe('AuthController — hardened __Host cookie', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; logout: jest.Mock };

  beforeEach(async () => {
    authService = {
      login: jest.fn(async () => ({ token: 'test-jwt-token', user: { id: 'u1', name: 'Test', email: 't@example.com', role: 'student', mustChangePassword: false } })),
      logout: jest.fn(async () => ({ message: 'Logged out successfully' })),
    };
    const supabaseMock = {
      client: { from: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(async () => ({ data: { id: 'u1', name: 'Test', email: 't@example.com', role: 'student' }, error: null })) },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SupabaseService, useValue: supabaseMock },
      ],
    }).compile();
    controller = module.get(AuthController);
  });

  it('login sets __Host-access_token with hardened attributes', async () => {
    const cookieCalls: Array<{ name: string; value: string; opts: any }> = [];
    const res = {
      cookie: jest.fn((name: string, value: string, opts: any) => { cookieCalls.push({ name, value, opts }); }),
    } as unknown as { cookie: jest.Mock };
    const req: any = { ip: '127.0.0.1', headers: { 'user-agent': 'UA', 'x-forwarded-for': undefined } };

    await controller.login({ email: 't@example.com', password: 'pass' } as any, req, res as any);

    // Must set both cookies - legacy access_token and hardened __Host-access_token
    expect(res.cookie).toHaveBeenCalledTimes(2);
    const hostCall = cookieCalls.find(c => c.name === '__Host-access_token');
    expect(hostCall).toBeDefined();
    // Do not log token value
    expect(hostCall!.value).toBe('test-jwt-token');
    expect(hostCall!.opts.httpOnly).toBe(true);
    expect(hostCall!.opts.secure).toBe(true);
    expect(String(hostCall!.opts.sameSite).toLowerCase()).toBe('lax');
    expect(hostCall!.opts.path).toBe('/');
    // Max-Age 24h in ms (Express) or 86400 sec — controller uses ms 86400000
    expect([86400, 86400 * 1000, 24 * 60 * 60 * 1000]).toContain(hostCall!.opts.maxAge);
    // Domain must be absent (Host prefix requires no Domain)
    expect(hostCall!.opts.domain).toBeUndefined();
    // Legacy cookie still present
    const legacy = cookieCalls.find(c => c.name === 'access_token');
    expect(legacy).toBeDefined();
  });

  it('logout expires __Host-access_token', async () => {
    const cookieCalls: Array<{ name: string; value: string; opts: any }> = [];
    const res = {
      cookie: jest.fn((name: string, value: string, opts: any) => { cookieCalls.push({ name, value, opts }); }),
    } as unknown as { cookie: jest.Mock };
    const user = { id: 'u1', sessionId: 'sess1' } as any;

    await controller.logout(user, res as any);

    const hostCall = cookieCalls.find(c => c.name === '__Host-access_token');
    expect(hostCall).toBeDefined();
    expect(hostCall!.value).toBe('');
    expect(hostCall!.opts.httpOnly).toBe(true);
    expect(hostCall!.opts.secure).toBe(true);
    expect(String(hostCall!.opts.sameSite).toLowerCase()).toBe('lax');
    expect(hostCall!.opts.path).toBe('/');
    expect(hostCall!.opts.maxAge).toBe(0);
    expect(hostCall!.opts.domain).toBeUndefined();
  });
});
