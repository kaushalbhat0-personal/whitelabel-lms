import { Injectable, Logger, OnModuleInit, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailLogsService } from '../email-logs/email-logs.service';
import { AuditService } from '../audit/audit.service';
import { ObservabilityService } from '../observability/observability.service';
import { EmailWebhookService } from './email-webhook.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import {
  DEFAULT_BUSINESS_NAME,
  DEFAULT_THEME_PRIMARY,
  DEFAULT_THEME_SIDEBAR_BG,
  DEFAULT_THEME_ACCENT,
} from '../../common/config/defaults';
import { EMAIL_TEMPLATES } from '../../common/constants/email-templates.constant';

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private fromAddress: string;
  private replyToAddress?: string;
  private isStub: boolean;
  private frontendUrl: string;

  constructor(
    private config: ConfigService,
    @Inject(forwardRef(() => EmailLogsService))
    private emailLogsService: EmailLogsService,
    private auditService: AuditService,
    private observabilityService: ObservabilityService,
    private emailWebhookService: EmailWebhookService,
    @Optional() private supabaseService?: SupabaseService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromAddress =
      this.config.get<string>('EMAIL_FROM') ?? 'onboarding@resend.dev';
    this.replyToAddress = this.config.get<string>('EMAIL_REPLY_TO') || undefined;
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

    if (!apiKey || apiKey === 're_xxxxxxxxxxxx') {
      this.isStub = true;
      this.logger.warn('EmailService running in STUB MODE — emails will be logged, not sent.');
      this.logger.warn('Set RESEND_API_KEY in .env to enable real email sending.');
    } else {
      this.isStub = false;
      this.resend = new Resend(apiKey);
      this.logger.log(
        `EmailService ready — sending from: ${this.fromAddress}` +
          (this.replyToAddress ? ` replyTo: ${this.replyToAddress}` : ''),
      );
    }
  }

  private async getBusinessName(): Promise<string> {
    try {
      if (!this.supabaseService) return DEFAULT_BUSINESS_NAME;
      const { data } = await this.supabaseService.client
        .from(TABLES.BUSINESS_CONFIG)
        .select('business_name')
        .limit(1)
        .maybeSingle();
      const name = (data as any)?.business_name;
      if (name && typeof name === 'string' && name.trim()) return name.trim();
    } catch {}
    return DEFAULT_BUSINESS_NAME;
  }

  private isValidHex6(v: unknown): boolean {
    return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v as string);
  }

  private resolveTheme(raw: unknown): { primary: string; sidebarBg: string; accent: string } {
    const fallback = {
      primary: DEFAULT_THEME_PRIMARY,
      sidebarBg: DEFAULT_THEME_SIDEBAR_BG,
      accent: DEFAULT_THEME_ACCENT,
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
    const r = raw as Record<string, unknown>;
    return {
      primary: this.isValidHex6(r.primary) ? (r.primary as string) : fallback.primary,
      sidebarBg: this.isValidHex6(r.sidebarBg) ? (r.sidebarBg as string) : fallback.sidebarBg,
      accent: this.isValidHex6(r.accent) ? (r.accent as string) : fallback.accent,
    };
  }

  private async getEmailBranding(): Promise<{
    businessName: string;
    theme: { primary: string; sidebarBg: string; accent: string };
  }> {
    try {
      if (!this.supabaseService) {
        return {
          businessName: DEFAULT_BUSINESS_NAME,
          theme: this.resolveTheme(null),
        };
      }
      const { data } = await this.supabaseService.client
        .from(TABLES.BUSINESS_CONFIG)
        .select('business_name, theme_json')
        .limit(1)
        .maybeSingle();
      const raw = data as any;
      const name = raw?.business_name;
      const businessName = name && typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_BUSINESS_NAME;
      const theme = this.resolveTheme(raw?.theme_json);
      return { businessName, theme };
    } catch {
      return { businessName: DEFAULT_BUSINESS_NAME, theme: this.resolveTheme(null) };
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.isStub || !this.resend) return;
    try {
      const bizName = await this.getBusinessName();
      await this.resend.emails.send({
        from: this.fromAddress,
        to: this.fromAddress,
        subject: `${bizName} — SMTP migration test`,
        html: '<p>Resend API key is working.</p>',
      });
      this.logger.log('Resend API key verified — email sending is operational.');
    } catch (err: any) {
      this.logger.error(`Resend API key verification FAILED: ${err.message}`);
      this.logger.error('Check RESEND_API_KEY in environment variables.');
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: EmailAttachment[],
    templateName?: string,
  ): Promise<boolean> {
    const effectiveTemplate = templateName ?? EMAIL_TEMPLATES.NOTIFICATION;

    // Check suppression list before sending
    const suppressed = await this.emailWebhookService.isSuppressed(to);
    if (suppressed) {
      this.logger.warn(`Skipping send to suppressed email: ${to}`);
      await this.logEmailAudit('EMAIL_SUPPRESSED', 'system', to, subject, effectiveTemplate);
      return false;
    }

    const logId = await this.emailLogsService.createLog({
      recipientEmail: to,
      subject,
      templateName: effectiveTemplate,
      metadata: { hasAttachments: !!(attachments?.length) },
    }).catch(() => undefined);

    if (this.isStub || !this.resend) {
      this.logger.warn(`[STUB] Would send email to=${to} subject="${subject}" body(length)=${html.length} — stub mode, marking as failed`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, 'stub - no provider configured').catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, to, subject, effectiveTemplate, 'stub', 'no provider configured').catch(() => {});
        await this.logObservabilityEvent('EMAIL_FAILED', `Stub email not sent to ${to} — no provider`, effectiveTemplate, to, 'warning').catch(() => {});
      }
      return false;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to,
        subject,
        html,
        ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
        attachments: attachments?.map((a) => ({
          filename: a.filename,
          content: a.content instanceof Buffer ? a.content.toString('base64') : a.content,
        })),
      });

      if (error) {
        this.logger.error(`Failed to send email to ${to}: ${error.message}`);
        if (logId) {
          await this.emailLogsService.markFailed(logId, (error as any).message).catch(() => {});
          await this.logEmailAudit('EMAIL_FAILED', logId, to, subject, effectiveTemplate, 'resend', (error as any).message).catch(() => {});
          await this.logObservabilityEvent('EMAIL_FAILED', `Email to ${to} failed: ${(error as any).message}`, effectiveTemplate, to, 'error').catch(() => {});
        }
        return false;
      }

      this.logger.log(`Email sent to ${to} — subject="${subject}" (id=${data?.id})`);
      if (logId) {
        await this.emailLogsService.markSent(logId, data?.id ?? 'unknown').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, to, subject, effectiveTemplate, data?.id ?? 'unknown').catch(() => {});
        await this.logObservabilityEvent('EMAIL_SENT', `Email sent to ${to}`, effectiveTemplate, to).catch(() => {});
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Exception sending email to ${to}: ${err.message}`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, err.message).catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, to, subject, effectiveTemplate, 'resend', err.message).catch(() => {});
        await this.logObservabilityEvent('EMAIL_FAILED', `Exception sending to ${to}: ${err.message}`, effectiveTemplate, to, 'error').catch(() => {});
      }
      return false;
    }
  }

  async sendWelcomeEmail(toEmail: string, studentName: string, tempPassword: string): Promise<boolean> {
    const suppressed = await this.emailWebhookService.isSuppressed(toEmail);
    if (suppressed) {
      this.logger.warn(`Skipping welcome email to suppressed: ${toEmail}`);
      return false;
    }

    const logId = await this.emailLogsService.createLog({
      recipientEmail: toEmail,
      subject: 'Your LMS account is ready',
      templateName: EMAIL_TEMPLATES.WELCOME,
      metadata: { studentName },
    }).catch(() => undefined);

    if (this.isStub || !this.resend) {
      this.logger.warn(`[STUB EMAIL] To: ${toEmail} | Name: ${studentName} | welcome email stub — marking as failed`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, 'stub - no provider configured').catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'Your LMS account is ready', EMAIL_TEMPLATES.WELCOME, 'stub', 'no provider configured').catch(() => {});
        await this.logObservabilityEvent('EMAIL_FAILED', `Welcome email stub not sent to ${toEmail} — no provider`, EMAIL_TEMPLATES.WELCOME, toEmail, 'warning').catch(() => {});
      }
      return false;
    }

    try {
      const { businessName, theme } = await this.getEmailBranding();
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: toEmail,
        subject: 'Your LMS account is ready',
        html: this.buildWelcomeEmailHtml(studentName, toEmail, tempPassword, this.frontendUrl, businessName, theme),
        ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      });

      if (error) {
        this.logger.error(`Failed to send welcome email to ${toEmail}: ${(error as any).message}`);
        if (logId) {
          await this.emailLogsService.markFailed(logId, (error as any).message).catch(() => {});
          await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'Your LMS account is ready', EMAIL_TEMPLATES.WELCOME, 'resend', (error as any).message).catch(() => {});
        }
        return false;
      }

      this.logger.log(`Welcome email sent to ${toEmail} (id: ${data?.id})`);
      if (logId) {
        await this.emailLogsService.markSent(logId, data?.id ?? 'unknown').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'Your LMS account is ready', EMAIL_TEMPLATES.WELCOME, data?.id ?? 'unknown').catch(() => {});
        await this.logObservabilityEvent('EMAIL_SENT', `Welcome email sent to ${toEmail}`, EMAIL_TEMPLATES.WELCOME, toEmail).catch(() => {});
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Exception sending welcome email to ${toEmail}: ${err.message}`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, err.message).catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'Your LMS account is ready', EMAIL_TEMPLATES.WELCOME, 'resend', err.message).catch(() => {});
      }
      return false;
    }
  }

  async sendLoginAlert(
    toEmail: string,
    userName: string,
    browser: string,
    os: string,
    ipAddress: string,
    frontendUrl: string,
  ): Promise<void> {
    const suppressed = await this.emailWebhookService.isSuppressed(toEmail);
    if (suppressed) {
      this.logger.warn(`Skipping login alert to suppressed: ${toEmail}`);
      return;
    }

    const logId = await this.emailLogsService.createLog({
      recipientEmail: toEmail,
      subject: 'New login to your LMS account',
      templateName: EMAIL_TEMPLATES.LOGIN_ALERT,
      metadata: { browser, os, ipAddress },
    }).catch(() => undefined);

    if (this.isStub || !this.resend) {
      this.logger.log(`[STUB LOGIN ALERT] To: ${toEmail} | User: ${userName} | Device: ${browser} on ${os} | IP: ${ipAddress}`);
      if (logId) {
        await this.emailLogsService.markSent(logId, 'stub').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'New login to your LMS account', EMAIL_TEMPLATES.LOGIN_ALERT, 'stub').catch(() => {});
      }
      return;
    }

    try {
      const { businessName, theme } = await this.getEmailBranding();
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: toEmail,
        subject: 'New login to your LMS account',
        html: this.buildLoginAlertHtml(userName, browser, os, ipAddress, frontendUrl, businessName, theme),
        ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      });

      if (error) {
        this.logger.error(`Failed to send login alert to ${toEmail}: ${(error as any).message}`);
        if (logId) {
          await this.emailLogsService.markFailed(logId, (error as any).message).catch(() => {});
          await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'New login to your LMS account', EMAIL_TEMPLATES.LOGIN_ALERT, 'resend', (error as any).message).catch(() => {});
        }
        return;
      }

      this.logger.log(`Login alert sent to ${toEmail} (id: ${data?.id})`);
      if (logId) {
        await this.emailLogsService.markSent(logId, data?.id ?? 'unknown').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'New login to your LMS account', EMAIL_TEMPLATES.LOGIN_ALERT, data?.id ?? 'unknown').catch(() => {});
      }
    } catch (err: any) {
      this.logger.error(`Exception sending login alert to ${toEmail}: ${err.message}`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, err.message).catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'New login to your LMS account', EMAIL_TEMPLATES.LOGIN_ALERT, 'resend', err.message).catch(() => {});
      }
    }
  }

  private async logEmailAudit(
    action: string,
    logId: string,
    recipient: string,
    subject: string,
    template: string,
    providerMessageId?: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.auditService.log({
      action,
      entityType: 'email_log',
      entityId: logId,
      actorId: 'system',
      actorRole: 'system',
      metadata: {
        recipient,
        subject,
        template,
        providerMessageId,
        errorMessage,
      },
    });
  }

  private async logObservabilityEvent(
    eventType: string,
    message: string,
    template: string,
    recipient: string,
    severity?: string,
  ): Promise<void> {
    await this.observabilityService.logEvent({
      eventType,
      source: 'email',
      severity: severity ?? 'info',
      message,
      metadata: { template, recipient },
    });
  }

  private buildWelcomeEmailHtml(
    name: string,
    email: string,
    password: string,
    loginUrl: string,
    businessName: string = DEFAULT_BUSINESS_NAME,
    theme: { primary: string; sidebarBg: string; accent: string } = {
      primary: DEFAULT_THEME_PRIMARY,
      sidebarBg: DEFAULT_THEME_SIDEBAR_BG,
      accent: DEFAULT_THEME_ACCENT,
    },
  ): string {
    const sidebarBg = this.isValidHex6(theme.sidebarBg) ? theme.sidebarBg : DEFAULT_THEME_SIDEBAR_BG;
    const accent = this.isValidHex6(theme.accent) ? theme.accent : DEFAULT_THEME_ACCENT;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;"><div style="background:${sidebarBg};padding:24px;border-radius:8px 8px 0 0;"><h1 style="color:white;margin:0;font-size:24px;">${businessName}</h1></div><div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;"><h2 style="color:${sidebarBg};margin-top:0;">Welcome, ${name}!</h2><p>Your student account has been created. Here are your login details:</p><div style="background:white;border:1px solid #ddd;border-radius:6px;padding:20px;margin:20px 0;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px 0;color:#666;width:140px;"><strong>Login URL</strong></td><td style="padding:8px 0;"><a href="${loginUrl}/login" style="color:${sidebarBg};">${loginUrl}/login</a></td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>Email (User ID)</strong></td><td style="padding:8px 0;font-family:monospace;">${email}</td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>Temporary Password</strong></td><td style="padding:8px 0;font-family:monospace;font-size:16px;letter-spacing:1px;"><strong>${password}</strong></td></tr></table></div><div style="background:#fff8e1;border-left:4px solid ${accent};padding:12px 16px;border-radius:4px;margin:16px 0;"><strong>Please change your password after first login</strong></div><p style="margin-top:24px;"><a href="${loginUrl}/login" style="background:${sidebarBg};color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Login to ${businessName} &rarr;</a></p><p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">If you did not expect this email, please ignore it or contact your administrator.<br>${businessName} &mdash; ${businessName}</p></div></body></html>`;
  }

  private buildLoginAlertHtml(
    userName: string,
    browser: string,
    os: string,
    ipAddress: string,
    frontendUrl: string,
    businessName: string = DEFAULT_BUSINESS_NAME,
    theme: { primary: string; sidebarBg: string; accent: string } = {
      primary: DEFAULT_THEME_PRIMARY,
      sidebarBg: DEFAULT_THEME_SIDEBAR_BG,
      accent: DEFAULT_THEME_ACCENT,
    },
  ): string {
    const sidebarBg = this.isValidHex6(theme.sidebarBg) ? theme.sidebarBg : DEFAULT_THEME_SIDEBAR_BG;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;"><div style="background:${sidebarBg};padding:24px;border-radius:8px 8px 0 0;"><h1 style="color:white;margin:0;font-size:24px;">${businessName}</h1></div><div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;"><h2 style="color:${sidebarBg};margin-top:0;">New sign-in detected</h2><p>Hi ${userName},</p><p>A new device just signed in to your ${businessName} account:</p><div style="background:white;border:1px solid #ddd;border-radius:6px;padding:20px;margin:20px 0;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px 0;color:#666;width:100px;"><strong>Browser</strong></td><td style="padding:8px 0;">${browser}</td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>OS</strong></td><td style="padding:8px 0;">${os}</td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>IP Address</strong></td><td style="padding:8px 0;font-family:monospace;">${ipAddress}</td></tr></table></div><p>If this was you, you can ignore this email.</p><p style="margin-top:24px;"><a href="${frontendUrl}/login" style="background:${sidebarBg};color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Review Account &rarr;</a></p><p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">If you did not sign in, please change your password immediately and contact support.<br>${businessName} &mdash; ${businessName}</p></div></body></html>`;
  }
}
