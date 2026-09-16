import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { QueryAuditDto } from './dto/query-audit.dto';
import { escapeIlikePattern } from '../../common/utils/like-escape.util';

interface LogParams {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorRole: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async log(params: LogParams): Promise<void> {
    const { error } = await this.supabaseService.client
      .from(TABLES.AUDIT_LOGS)
      .insert({
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId,
        actor_id: params.actorId,
        actor_role: params.actorRole,
        changes: params.changes ?? null,
        metadata: params.metadata ?? null,
        ip_address: params.ipAddress ?? null,
      });

    if (error) {
      this.logger.error(`Failed to insert audit log: ${error.message}`);
    }
  }

  async findAll(query: QueryAuditDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let countQuery = this.supabaseService.client
      .from(TABLES.AUDIT_LOGS)
      .select('*', { count: 'exact', head: true });

    let dataQuery = this.supabaseService.client
      .from(TABLES.AUDIT_LOGS)
      .select('*');

    if (query.entityType) {
      countQuery = countQuery.eq('entity_type', query.entityType);
      dataQuery = dataQuery.eq('entity_type', query.entityType);
    }

    if (query.entityId) {
      countQuery = countQuery.eq('entity_id', query.entityId);
      dataQuery = dataQuery.eq('entity_id', query.entityId);
    }

    if (query.action) {
      countQuery = countQuery.eq('action', query.action);
      dataQuery = dataQuery.eq('action', query.action);
    }

    if (query.actorId) {
      countQuery = countQuery.eq('actor_id', query.actorId);
      dataQuery = dataQuery.eq('actor_id', query.actorId);
    }

    if (query.startDate) {
      countQuery = countQuery.gte('created_at', query.startDate);
      dataQuery = dataQuery.gte('created_at', query.startDate);
    }

    if (query.endDate) {
      countQuery = countQuery.lte('created_at', query.endDate);
      dataQuery = dataQuery.lte('created_at', query.endDate);
    }

    if (query.search) {
      const searchTerm = `%${escapeIlikePattern(query.search)}%`;
      countQuery = countQuery.or(
        `metadata->>text.ilike.${searchTerm},action.ilike.${searchTerm},entity_type.ilike.${searchTerm}`,
      );
      dataQuery = dataQuery.or(
        `metadata->>text.ilike.${searchTerm},action.ilike.${searchTerm},entity_type.ilike.${searchTerm}`,
      );
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      this.logger.error(`Failed to count audit logs: ${countError.message}`);
      throw countError;
    }

    const { data, error } = await dataQuery
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch audit logs: ${error.message}`);
      throw error;
    }

    return {
      items: data ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }
}
