import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { CreateEmailLogDto } from './dto/create-email-log.dto';
import { AuditService } from '../audit/audit.service';
import { ObservabilityService } from '../observability/observability.service';
import { ilikeContains } from '../../common/utils/like-escape.util';

@Injectable()
export class EmailLogsService {
  private readonly logger = new Logger(EmailLogsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly observabilityService: ObservabilityService,
  ) {}

  async createLog(dto: CreateEmailLogDto): Promise<string> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .insert({
        recipient_email: dto.recipientEmail,
        subject: dto.subject,
        template_name: dto.templateName ?? null,
        template_type: dto.templateType ?? null,
        provider: dto.provider ?? 'resend',
        status: 'pending',
        metadata: dto.metadata ?? null,
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error(`Failed to create email log: ${error.message}`);
      throw error;
    }

    return data.id;
  }

  async markSent(logId: string, providerMessageId: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .update({
        status: 'sent',
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId);

    if (error) {
      this.logger.error(`Failed to mark email ${logId} as sent: ${error.message}`);
    }
  }

  async markFailed(logId: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .update({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId);

    if (error) {
      this.logger.error(`Failed to mark email ${logId} as failed: ${error.message}`);
    }
  }

  async markRetrying(logId: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .update({
        status: 'retrying',
        retry_count: (await this.getRetryCount(logId)) + 1,
        last_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId);

    if (error) {
      this.logger.error(`Failed to mark email ${logId} as retrying: ${error.message}`);
    }
  }

  async retryEmail(logId: string, actor?: { id: string; role: string }): Promise<void> {
    const { data: log, error } = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .select('*')
      .eq('id', logId)
      .single();

    if (error || !log) {
      throw new NotFoundException(`Email log ${logId} not found`);
    }

    const entry = log as any;
    if (entry.retry_count >= entry.max_retries) {
      throw new Error(`Max retries (${entry.max_retries}) exceeded for email ${logId}`);
    }

    await this.markRetrying(logId);

    if (actor?.id) {
      await this.auditService.log({
        action: 'EMAIL_RETRIED',
        entityType: 'email_log',
        entityId: logId,
        actorId: actor.id,
        actorRole: actor.role,
        metadata: {
          recipient: entry.recipient_email,
          subject: entry.subject,
          template: entry.template_name,
          retryCount: entry.retry_count + 1,
        },
      }).catch((err) => this.logger.warn(`Failed to create audit log: ${err.message}`));
    }

    try {
      const { Resend } = await import('resend');
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        await this.markFailed(logId, 'No RESEND_API_KEY configured');
        return;
      }

      const resend = new Resend(apiKey);
      const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

      const { data, error: sendError } = await resend.emails.send({
        from,
        to: entry.recipient_email,
        subject: entry.subject,
        html: (entry as any).metadata?.html ?? '<p>Retry email</p>',
      });

      if (sendError) {
        await this.markFailed(logId, (sendError as any).message);
        return;
      }

      await this.markSent(logId, data?.id ?? 'unknown');
      await this.observabilityService.logEvent({
        eventType: 'EMAIL_RETRIED',
        source: 'email',
        severity: 'info',
        message: `Email ${logId} retried successfully to ${entry.recipient_email}`,
        metadata: { emailLogId: logId, recipient: entry.recipient_email, template: entry.template_name },
      }).catch(() => {});
    } catch (err: any) {
      await this.markFailed(logId, err.message);
      await this.observabilityService.logEvent({
        eventType: 'EMAIL_RETRY_FAILED',
        source: 'email',
        severity: 'error',
        message: `Email ${logId} retry failed: ${err.message}`,
        metadata: { emailLogId: logId, recipient: entry.recipient_email, template: entry.template_name },
      }).catch(() => {});
    }
  }

  async listEmails(query: {
    page?: number;
    limit?: number;
    status?: string;
    templateName?: string;
    recipientSearch?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let countQ = this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .select('*', { count: 'exact', head: true });

    let dataQ = this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .select('*');

    if (query.status) {
      countQ = countQ.eq('status', query.status);
      dataQ = dataQ.eq('status', query.status);
    }
    if (query.templateName) {
      countQ = countQ.eq('template_name', query.templateName);
      dataQ = dataQ.eq('template_name', query.templateName);
    }
    if (query.recipientSearch) {
      const pat = ilikeContains(query.recipientSearch);
      countQ = countQ.ilike('recipient_email', pat);
      dataQ = dataQ.ilike('recipient_email', pat);
    }
    if (query.startDate) {
      countQ = countQ.gte('created_at', query.startDate);
      dataQ = dataQ.gte('created_at', query.startDate);
    }
    if (query.endDate) {
      countQ = countQ.lte('created_at', query.endDate);
      dataQ = dataQ.lte('created_at', query.endDate);
    }

    const { count, error: countErr } = await countQ;
    if (countErr) throw countErr;

    const { data, error } = await dataQ
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    return { items: data ?? [], total: count ?? 0, page, limit };
  }

  async getEmailStats() {
    const results = await Promise.allSettled([
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'sent'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'retrying'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);

    const total = results[0].status === 'fulfilled' ? (results[0].value as any).count ?? 0 : 0;
    const sent = results[1].status === 'fulfilled' ? (results[1].value as any).count ?? 0 : 0;
    const failed = results[2].status === 'fulfilled' ? (results[2].value as any).count ?? 0 : 0;
    const retrying = results[3].status === 'fulfilled' ? (results[3].value as any).count ?? 0 : 0;
    const pending = results[4].status === 'fulfilled' ? (results[4].value as any).count ?? 0 : 0;

    const templatesResult = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .select('template_name');

    const templateCountsMap = new Map<string, number>();
    for (const row of (templatesResult.data ?? [])) {
      const name = (row as any).template_name ?? 'unknown';
      templateCountsMap.set(name, (templateCountsMap.get(name) ?? 0) + 1);
    }

    return {
      total: total,
      sent: sent,
      failed: failed,
      retrying: retrying,
      pending: pending,
      templateCounts: Object.fromEntries(templateCountsMap),
    };
  }

  async getAnalytics() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = await Promise.allSettled([
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'sent'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('sent_at').gte('sent_at', sevenDaysAgo).not('sent_at', 'is', null).order('sent_at', { ascending: true }),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('template_name').not('template_name', 'is', null),
    ]);

    const total = results[0].status === 'fulfilled' ? (results[0].value as any).count ?? 0 : 0;
    const sent = results[1].status === 'fulfilled' ? (results[1].value as any).count ?? 0 : 0;
    const failed = results[2].status === 'fulfilled' ? (results[2].value as any).count ?? 0 : 0;
    const dailyResult = results[3].status === 'fulfilled' ? results[3].value : null;
    const templatesResult = results[4].status === 'fulfilled' ? results[4].value : null;

    const dailyMap = new Map<string, number>();
    for (const row of ((dailyResult as any)?.data ?? [])) {
      const date = ((row as any).sent_at as string).slice(0, 10);
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
    }
    const emailsPerDay = Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count }));

    const templateCountsMap = new Map<string, number>();
    for (const row of ((templatesResult as any)?.data ?? [])) {
      const name = (row as any).template_name ?? 'unknown';
      templateCountsMap.set(name, (templateCountsMap.get(name) ?? 0) + 1);
    }
    const mostUsedTemplates = Array.from(templateCountsMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total,
      sent,
      failed,
      deliveryRate: total > 0 ? +((sent / total) * 100).toFixed(1) : 0,
      failureRate: total > 0 ? +((failed / total) * 100).toFixed(1) : 0,
      emailsPerDay,
      mostUsedTemplates,
    };
  }

  async getQueueStats() {
    const results = await Promise.allSettled([
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'retrying'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      this.supabaseService.client.from(TABLES.EMAIL_LOGS).select('id', { count: 'exact', head: true }).in('status', ['pending', 'retrying']),
    ]);

    return {
      total: results[0].status === 'fulfilled' ? (results[0].value as any).count ?? 0 : 0,
      pending: results[1].status === 'fulfilled' ? (results[1].value as any).count ?? 0 : 0,
      retrying: results[2].status === 'fulfilled' ? (results[2].value as any).count ?? 0 : 0,
      failed: results[3].status === 'fulfilled' ? (results[3].value as any).count ?? 0 : 0,
      inQueue: results[4].status === 'fulfilled' ? (results[4].value as any).count ?? 0 : 0,
    };
  }

  private async getRetryCount(logId: string): Promise<number> {
    const { data } = await this.supabaseService.client
      .from(TABLES.EMAIL_LOGS)
      .select('retry_count')
      .eq('id', logId)
      .single();
    return (data as any)?.retry_count ?? 0;
  }
}
