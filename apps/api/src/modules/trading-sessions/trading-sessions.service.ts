import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { LiveSessionsService } from '../live-sessions/live-sessions.service';
import { CreateTradingSessionDto } from './dto/create-trading-session.dto';

/**
 * TradingSessionsService — thin compatibility layer.
 *
 * Phase 6B migration: this service is KEPT for API-contract stability
 * (`/admin/sessions`) but delegates all work to the canonical
 * `LiveSessionsService`. No business logic and no duplicate DB writes live here.
 *
 * The legacy response shape is preserved exactly so the admin frontend is
 * unchanged:
 *   ScheduledSession = { id, zoom_meeting_id, start_time, title, is_live,
 *                        created_at, updated_at, batchNames, joinUrl?, startUrl? }
 */
@Injectable()
export class TradingSessionsService {
  private readonly logger = new Logger(TradingSessionsService.name);

  constructor(private readonly liveSessionsService: LiveSessionsService) {}

  /**
   * Map a canonical live_sessions row to the legacy ScheduledSession shape.
   */
  private mapToLegacyShape(session: any): any {
    return {
      id: session.id,
      // Legacy contract exposes zoom_meeting_id; canonical stores zoom_webinar_id.
      zoom_meeting_id: session.zoom_webinar_id ?? session.zoom_meeting_id ?? '',
      start_time: session.start_time,
      title: session.topic ?? session.title,
      // Legacy boolean -> canonical 4-state status.
      is_live: session.status === 'live',
      status: session.status,
      duration_minutes: session.duration_minutes,
      created_at: session.created_at,
      updated_at: session.updated_at ?? session.created_at,
      batchNames: session.batchNames ?? (session.batch_ids ?? []),
      joinUrl: session.zoom_webinar_join_url ?? null,
      startUrl: session.zoom_start_url ?? null,
    };
  }

  /**
   * POST /admin/sessions — create a session via the canonical service.
   */
  async create(dto: CreateTradingSessionDto) {
    const created = await this.liveSessionsService.create({
      topic: dto.title,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes ?? 180,
      batchIds: dto.batchIds,
      // No teacherId — the host resolver picks a default host automatically.
    });

    const batchNames = (created.batches ?? []).slice();
    return {
      ...this.mapToLegacyShape(created),
      batchNames,
    };
  }

  /**
   * GET /admin/sessions — list sessions via the canonical service.
   */
  async findAll() {
    const result = await this.liveSessionsService.findAll(1, 500);
    return (result.items ?? []).map((s: any) => this.mapToLegacyShape(s));
  }

  /**
   * DELETE /admin/sessions/:id — cancel + delete via the canonical service.
   */
  async remove(id: string): Promise<{ success: boolean; deletedId: string }> {
    await this.liveSessionsService.deleteSession(id);
    return { success: true, deletedId: id };
  }
}
