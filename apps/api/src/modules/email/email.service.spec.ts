import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailLogsService } from '../email-logs/email-logs.service';
import { AuditService } from '../audit/audit.service';
import { ObservabilityService } from '../observability/observability.service';
import { EmailWebhookService } from './email-webhook.service';

describe('EmailService - onboarding', () => {
  let service: EmailService;
  let configMock: any;

  beforeEach(async () => {
    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 're_test_123';
        if (key === 'EMAIL_FROM') return 'noreply@mctlearn.com';
        if (key === 'EMAIL_REPLY_TO') return 'moneycrafttrader@gmail.com';
        if (key === 'FRONTEND_URL') return 'https://mctlearn.com';
        return undefined;
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: configMock },
        { provide: EmailLogsService, useValue: { createLog: jest.fn().mockResolvedValue('log1'), markSent: jest.fn().mockResolvedValue(undefined), markFailed: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: EmailWebhookService, useValue: { isSuppressed: jest.fn().mockResolvedValue(false) } },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
    // Force non-stub
    (service as any).isStub = false;
    (service as any).resend = { emails: { send: jest.fn().mockResolvedValue({ data: { id: 'msg1' }, error: null }) } };
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  it('uses EMAIL_FROM and EMAIL_REPLY_TO env', () => {
    expect((service as any).fromAddress).toBe('noreply@mctlearn.com');
    expect((service as any).replyToAddress).toBe('moneycrafttrader@gmail.com');
  });

  it('welcome email html contains name, email, password, loginUrl and change-password banner, no password in logs', async () => {
    const spyLog = jest.spyOn((service as any).logger, 'log');
    await service.sendWelcomeEmail('student@test.com', 'Test Student', 'Secret123Aa1!');

    const resendCall = (service as any).resend.emails.send.mock.calls[0][0];
    expect(resendCall.from).toBe('noreply@mctlearn.com');
    expect(resendCall.replyTo).toBe('moneycrafttrader@gmail.com');
    expect(resendCall.to).toBe('student@test.com');
    expect(resendCall.subject).toBe('Your MCT Learn account is ready');
    expect(resendCall.html).toContain('Test Student');
    expect(resendCall.html).toContain('student@test.com');
    expect(resendCall.html).toContain('Secret123Aa1!');
    expect(resendCall.html).toContain('https://mctlearn.com/login');
    expect(resendCall.html).toContain('Please change your password after first login');

    // Ensure log does not contain password
    const allLogs = spyLog.mock.calls.flat().join(' ');
    expect(allLogs).not.toContain('Secret123Aa1!');
  });

  it('stub mode does not log password', async () => {
    (service as any).isStub = true;
    (service as any).resend = null;
    const spyLog = jest.spyOn((service as any).logger, 'log');
    await service.sendWelcomeEmail('stub@test.com', 'Stub User', 'MyStubPassAa1!');
    const allLogs = spyLog.mock.calls.flat().join(' ') + (service as any).logger.warn.mock.calls.flat().join(' ');
    // Check that no call contains the password
    expect(allLogs).not.toContain('MyStubPassAa1!');
    expect(allLogs).toContain('stub@test.com');
  });

  it('does not use moneycrafttrader.com as FROM domain', () => {
    expect((service as any).fromAddress).not.toContain('moneycrafttrader.com');
    expect((service as any).fromAddress).toBe('noreply@mctlearn.com');
  });

  it('sends replyTo as moneycrafttrader@gmail.com', async () => {
    await service.sendWelcomeEmail('student@test.com', 'Test Student', 'Secret123Aa1!');
    const resendCall = (service as any).resend.emails.send.mock.calls[0][0];
    expect(resendCall.replyTo).toBe('moneycrafttrader@gmail.com');
  });
});
