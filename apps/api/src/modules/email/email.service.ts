import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailLogsService } from '../email-logs/email-logs.service';
import { AuditService } from '../audit/audit.service';
import { ObservabilityService } from '../observability/observability.service';
import { EmailWebhookService } from './email-webhook.service';
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

  async onModuleInit(): Promise<void> {
    if (this.isStub || !this.resend) return;
    try {
      await this.resend.emails.send({
        from: this.fromAddress,
        to: this.fromAddress,
        subject: 'MCT Learn — SMTP migration test',
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
      this.logger.warn(`[STUB] Would send email to=${to} subject="${subject}" body(length)=${html.length}`);
      if (logId) {
        await this.emailLogsService.markSent(logId, 'stub').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, to, subject, effectiveTemplate, 'stub').catch(() => {});
        await this.logObservabilityEvent('EMAIL_SENT', `Stub email sent to ${to}`, effectiveTemplate, to).catch(() => {});
      }
      return true;
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
      subject: 'Your MCT Learn account is ready',
      templateName: EMAIL_TEMPLATES.WELCOME,
      metadata: { studentName },
    }).catch(() => undefined);

    if (this.isStub || !this.resend) {
      this.logger.log(`[STUB EMAIL] To: ${toEmail} | Name: ${studentName} | welcome email stub`);
      if (logId) {
        await this.emailLogsService.markSent(logId, 'stub').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'Your MCT Learn account is ready', EMAIL_TEMPLATES.WELCOME, 'stub').catch(() => {});
        await this.logObservabilityEvent('EMAIL_SENT', `Welcome email stub sent to ${toEmail}`, EMAIL_TEMPLATES.WELCOME, toEmail).catch(() => {});
      }
      return true;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: toEmail,
        subject: 'Your MCT Learn account is ready',
        html: this.buildWelcomeEmailHtml(studentName, toEmail, tempPassword, this.frontendUrl),
        ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      });

      if (error) {
        this.logger.error(`Failed to send welcome email to ${toEmail}: ${(error as any).message}`);
        if (logId) {
          await this.emailLogsService.markFailed(logId, (error as any).message).catch(() => {});
          await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'Your MCT Learn account is ready', EMAIL_TEMPLATES.WELCOME, 'resend', (error as any).message).catch(() => {});
        }
        return false;
      }

      this.logger.log(`Welcome email sent to ${toEmail} (id: ${data?.id})`);
      if (logId) {
        await this.emailLogsService.markSent(logId, data?.id ?? 'unknown').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'Your MCT Learn account is ready', EMAIL_TEMPLATES.WELCOME, data?.id ?? 'unknown').catch(() => {});
        await this.logObservabilityEvent('EMAIL_SENT', `Welcome email sent to ${toEmail}`, EMAIL_TEMPLATES.WELCOME, toEmail).catch(() => {});
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Exception sending welcome email to ${toEmail}: ${err.message}`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, err.message).catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'Your MCT Learn account is ready', EMAIL_TEMPLATES.WELCOME, 'resend', err.message).catch(() => {});
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
      subject: 'New login to your MCT Learn account',
      templateName: EMAIL_TEMPLATES.LOGIN_ALERT,
      metadata: { browser, os, ipAddress },
    }).catch(() => undefined);

    if (this.isStub || !this.resend) {
      this.logger.log(`[STUB LOGIN ALERT] To: ${toEmail} | User: ${userName} | Device: ${browser} on ${os} | IP: ${ipAddress}`);
      if (logId) {
        await this.emailLogsService.markSent(logId, 'stub').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'New login to your MCT Learn account', EMAIL_TEMPLATES.LOGIN_ALERT, 'stub').catch(() => {});
      }
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: toEmail,
        subject: 'New login to your MCT Learn account',
        html: this.buildLoginAlertHtml(userName, browser, os, ipAddress, frontendUrl),
        ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      });

      if (error) {
        this.logger.error(`Failed to send login alert to ${toEmail}: ${(error as any).message}`);
        if (logId) {
          await this.emailLogsService.markFailed(logId, (error as any).message).catch(() => {});
          await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'New login to your MCT Learn account', EMAIL_TEMPLATES.LOGIN_ALERT, 'resend', (error as any).message).catch(() => {});
        }
        return;
      }

      this.logger.log(`Login alert sent to ${toEmail} (id: ${data?.id})`);
      if (logId) {
        await this.emailLogsService.markSent(logId, data?.id ?? 'unknown').catch(() => {});
        await this.logEmailAudit('EMAIL_SENT', logId, toEmail, 'New login to your MCT Learn account', EMAIL_TEMPLATES.LOGIN_ALERT, data?.id ?? 'unknown').catch(() => {});
      }
    } catch (err: any) {
      this.logger.error(`Exception sending login alert to ${toEmail}: ${err.message}`);
      if (logId) {
        await this.emailLogsService.markFailed(logId, err.message).catch(() => {});
        await this.logEmailAudit('EMAIL_FAILED', logId, toEmail, 'New login to your MCT Learn account', EMAIL_TEMPLATES.LOGIN_ALERT, 'resend', err.message).catch(() => {});
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
  ): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;"><div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0;"><h1 style="color:white;margin:0;font-size:24px;">MCT Learn</h1></div><div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;"><h2 style="color:#1e3a5f;margin-top:0;">Welcome, ${name}!</h2><p>Your student account has been created. Here are your login details:</p><div style="background:white;border:1px solid #ddd;border-radius:6px;padding:20px;margin:20px 0;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px 0;color:#666;width:140px;"><strong>Login URL</strong></td><td style="padding:8px 0;"><a href="${loginUrl}/login" style="color:#1e3a5f;">${loginUrl}/login</a></td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>Email (User ID)</strong></td><td style="padding:8px 0;font-family:monospace;">${email}</td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>Temporary Password</strong></td><td style="padding:8px 0;font-family:monospace;font-size:16px;letter-spacing:1px;"><strong>${password}</strong></td></tr></table></div><div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin:16px 0;"><strong>Please change your password after first login</strong></div><p style="margin-top:24px;"><a href="${loginUrl}/login" style="background:#1e3a5f;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Login to MCT Learn &rarr;</a></p><p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">If you did not expect this email, please ignore it or contact your administrator.<br>MCT Learn &mdash; Money Craft Trader</p></div></body></html>`;
  }

  private buildLoginAlertHtml(
    userName: string,
    browser: string,
    os: string,
    ipAddress: string,
    frontendUrl: string,
  ): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;"><div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0;"><h1 style="color:white;margin:0;font-size:24px;">MCT Learn</h1></div><div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;"><h2 style="color:#1e3a5f;margin-top:0;">New sign-in detected</h2><p>Hi ${userName},</p><p>A new device just signed in to your MCT Learn account:</p><div style="background:white;border:1px solid #ddd;border-radius:6px;padding:20px;margin:20px 0;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px 0;color:#666;width:100px;"><strong>Browser</strong></td><td style="padding:8px 0;">${browser}</td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>OS</strong></td><td style="padding:8px 0;">${os}</td></tr><tr style="border-top:1px solid #eee;"><td style="padding:8px 0;color:#666;"><strong>IP Address</strong></td><td style="padding:8px 0;font-family:monospace;">${ipAddress}</td></tr></table></div><p>If this was you, you can ignore this email.</p><p style="margin-top:24px;"><a href="${frontendUrl}/login" style="background:#1e3a5f;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Review Account &rarr;</a></p><p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">If you did not sign in, please change your password immediately and contact support.<br>MCT Learn &mdash; Money Craft Trader</p></div></body></html>`;
  }
}
