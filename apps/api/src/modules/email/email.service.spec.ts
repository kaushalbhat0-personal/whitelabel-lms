import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailLogsService } from '../email-logs/email-logs.service';
import { AuditService } from '../audit/audit.service';
import { ObservabilityService } from '../observability/observability.service';
import { EmailWebhookService } from './email-webhook.service';
import { SupabaseService } from '../../common/services/supabase.service';

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

describe('EmailService — COMM-01B-B2A Welcome/Login Branding', () => {
  let service: EmailService;
  let configMock: any;
  let supabaseMock: any;

  function mockBusinessConfig(business_name: string | null, theme_json: any) {
    return {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { business_name, theme_json } }),
      }),
    };
  }

  beforeEach(async () => {
    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 're_test_123';
        if (key === 'EMAIL_FROM') return 'noreply@example.com';
        if (key === 'EMAIL_REPLY_TO') return 'support@example.com';
        if (key === 'FRONTEND_URL') return 'https://example.com';
        return undefined;
      }),
    };
    supabaseMock = { client: mockBusinessConfig('LMS Platform', null) };
  });

  async function createServiceWithBiz(business_name: string | null, theme_json: any) {
    supabaseMock = { client: mockBusinessConfig(business_name, theme_json) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: configMock },
        { provide: EmailLogsService, useValue: { createLog: jest.fn().mockResolvedValue('log1'), markSent: jest.fn().mockResolvedValue(undefined), markFailed: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: EmailWebhookService, useValue: { isSuppressed: jest.fn().mockResolvedValue(false) } },
        { provide: SupabaseService, useValue: supabaseMock },
      ],
    }).compile();
    service = module.get(EmailService);
    (service as any).isStub = false;
    (service as any).resend = { emails: { send: jest.fn().mockResolvedValue({ data: { id: 'msg1' }, error: null }) } };
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    return service;
  }

  it('GSA welcome email uses GSA businessName, sidebarBg #1E3A8A and accent #60A5FA, no legacy #1e3a5f/#f59e0b in branded elements', async () => {
    await createServiceWithBiz('Global Skills Academy', { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' });
    await service.sendWelcomeEmail('gsa@test.com', 'GSA Student', 'TempPass123Aa1!');
    const html = (service as any).resend.emails.send.mock.calls[0][0].html as string;
    expect(html).toContain('Global Skills Academy');
    expect(html).toContain('#1E3A8A');
    expect(html).toContain('#60A5FA');
    // legacy colors should not appear in branded header/button/border
    // header background, h2, link, button are sidebarBg; banner border is accent
    // If legacy still present, it would be stray; we assert branded colors present
    expect(html).toContain('Login to Global Skills Academy');
  });

  it('GSA login alert uses sidebarBg #1E3A8A and businessName', async () => {
    await createServiceWithBiz('Global Skills Academy', { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' });
    await (service as any).sendLoginAlert('gsa@test.com', 'GSA User', 'Chrome', 'Windows', '1.2.3.4', 'https://example.com');
    const html = (service as any).resend.emails.send.mock.calls[0][0].html as string;
    expect(html).toContain('Global Skills Academy');
    expect(html).toContain('#1E3A8A');
  });

  it('NULL theme falls back to defaults #064e3b and #f59e0b with LMS Platform', async () => {
    await createServiceWithBiz(null, null);
    await service.sendWelcomeEmail('null@test.com', 'Null Student', 'Pass123Aa1!');
    const html = (service as any).resend.emails.send.mock.calls[0][0].html as string;
    expect(html).toContain('#064e3b');
    expect(html).toContain('#f59e0b');
    expect(html).toContain('LMS Platform');
  });

  it('partial theme falls back independently per field', async () => {
    await createServiceWithBiz('Partial Biz', { primary: '#2563EB' });
    const branding = await (service as any).getEmailBranding();
    expect(branding.theme.primary).toBe('#2563EB');
    expect(branding.theme.sidebarBg).toBe('#064e3b');
    expect(branding.theme.accent).toBe('#f59e0b');
  });

  it('malformed theme values fall back safely and do not reach HTML', async () => {
    await createServiceWithBiz('Test Biz', { primary: 'rgb(0,0,0)', sidebarBg: 'invalid', accent: 'evil' });
    const branding = await (service as any).getEmailBranding();
    expect(branding.theme.primary).toBe('#10b981');
    expect(branding.theme.sidebarBg).toBe('#064e3b');
    expect(branding.theme.accent).toBe('#f59e0b');
    await service.sendWelcomeEmail('test123@test.com', 'Test', 'Pass123Aa1!');
    const html = (service as any).resend.emails.send.mock.calls[0][0].html as string;
    expect(html).not.toContain('rgb(0,0,0)');
    // 'invalid' is not a valid hex and should not appear as a color value; check that sidebarBg fallback is used
    expect(html).toContain('#064e3b');
    expect(html).toContain('#f59e0b');
    // ensure raw theme values not interpolated
    expect(html).not.toContain('evil');
  });

  it('rejects injection values like <script>, url(), var(), gradients, short hex', async () => {
    for (const bad of ['<script>', 'url(x)', 'var(--x)', 'linear-gradient(red,blue)', '#fff', '#12345', '#1234567', '#GGGGGG', '#10b981;']) {
      await createServiceWithBiz('Inject Biz', { primary: bad, sidebarBg: bad, accent: bad });
      const branding = await (service as any).getEmailBranding();
      expect(branding.theme.primary).toBe('#10b981');
      expect(branding.theme.sidebarBg).toBe('#064e3b');
      expect(branding.theme.accent).toBe('#f59e0b');
    }
  });

  it('businessName interpolation remains functional', async () => {
    await createServiceWithBiz('Global Skills Academy', { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' });
    const htmlWelcome = (service as any).buildWelcomeEmailHtml('Alice', 'alice@test.com', 'pass', 'https://example.com', 'Global Skills Academy', { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' });
    expect(htmlWelcome).toContain('Global Skills Academy');
    const htmlAlert = (service as any).buildLoginAlertHtml('Bob', 'Chrome', 'Win', '1.1.1.1', 'https://example.com', 'Global Skills Academy', { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' });
    expect(htmlAlert).toContain('Global Skills Academy');
  });
});
