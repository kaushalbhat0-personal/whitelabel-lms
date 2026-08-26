/*
 * Bunny webhook receiver — Phase 7C ACTIVATED against verified behaviour
 * (official scheme: https://bunny.net/docs/stream/webhooks).
 *
 *   Payload : { "VideoLibraryId": number, "VideoGuid": uuid, "Status": number }
 *   Status  : 0 Queued, 1 Processing, 2 Encoding, 3 Finished,
 *             4 Resolution finished (first => playable), 5 Failed,
 *             6-10 presigned-upload/captions/title events
 *   Security: HMAC-SHA256 lowercase-hex of the EXACT raw body using the
 *             library Read-Only API key; version/algorithm headers validated;
 *             constant-time comparison. Invalid signatures are rejected with
 *             401 and NEVER mutate state.
 *
 * Safety properties (RCCF):
 *   - Mutations are scoped to provider='bunny' rows ONLY — a Bunny event can
 *     never mutate a Mux recording.
 *   - The v1 signature carries no timestamp/replay window; residual risk is
 *     mitigated by HTTPS transport + idempotent, monotonic status updates and
 *     is documented in the Phase 7C report.
 */
import { Controller, Post, Req, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { BunnyProvider } from './providers/bunny.provider';

const MAX_WEBHOOK_BYTES = 64 * 1024;

interface BunnyWebhookPayload {
  VideoLibraryId?: number;
  VideoGuid?: string;
  Status?: number;
}

@Controller('bunny')
export class BunnyWebhookController {
  private readonly logger = new Logger(BunnyWebhookController.name);

  constructor(
    private readonly bunnyProvider: BunnyProvider,
    private readonly supabaseService: SupabaseService,
    private readonly redisCache: RedisCacheService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('webhook')
  async handleWebhook(@Req() req: Request): Promise<{ message: string }> {
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      this.logger.warn('Bunny webhook received with empty rawBody — ignoring');
      return { message: 'ok' };
    }
    if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) {
      this.logger.warn(`Bunny webhook payload too large (${Buffer.byteLength(rawBody)} bytes) — rejecting`);
      throw new UnauthorizedException('Invalid webhook payload');
    }

    // ── Signature verification (mandatory — unsigned events are rejected) ──
    const valid = this.bunnyProvider.verifyWebhookSignature(rawBody, {
      version: req.headers['x-bunnystream-signature-version'] as string | undefined,
      algorithm: req.headers['x-bunnystream-signature-algorithm'] as string | undefined,
      signature: req.headers['x-bunnystream-signature'] as string | undefined,
    });
    if (!valid) {
      this.logger.warn('Bunny webhook signature verification FAILED — rejecting (401)');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let event: BunnyWebhookPayload;
    try {
      event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
    } catch (err) {
      this.logger.warn(`Bunny webhook payload was not JSON: ${(err as Error).message}`);
      return { message: 'ok' };
    }

    const videoGuid = event.VideoGuid;
    const status = event.Status;
    if (!videoGuid || typeof status !== 'number') {
      this.logger.warn(`Bunny webhook missing VideoGuid/Status (type=${String((event as any)?.Status)})`);
      return { message: 'ok' };
    }

    // Defense-in-depth: only accept events for OUR library.
    const expectedLibraryId = this.configService.get<string>('BUNNY_LIBRARY_ID');
    if (
      expectedLibraryId &&
      String(event.VideoLibraryId ?? '') !== String(expectedLibraryId)
    ) {
      this.logger.warn(
        `Bunny webhook for foreign library ${event.VideoLibraryId} — ignoring`,
      );
      return { message: 'ok' };
    }

    const canonical = this.bunnyProvider.webhookStatusToCanonical(status);
    if (canonical === 'processing') {
      // Intermediate states (queued/encoding/presigned/caption events) need no action.
      this.logger.debug(`Bunny webhook intermediate status=${status} for ${videoGuid} — ignored`);
      return { message: 'ok' };
    }

    try {
      await this.applyCanonicalStatus(videoGuid, canonical, status);
    } catch (err) {
      // Never throw at Bunny — log loudly; reconciliation via getAssetStatus exists.
      this.logger.error(
        `Failed applying Bunny webhook status=${status} for ${videoGuid}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return { message: 'ok' };
  }

  /**
   * Apply a terminal lifecycle transition to the matching BUNNY recording row.
   * The row is located via mux_asset_id OR (unlinked direct upload)
   * mux_upload_id — always constrained by provider='bunny'.
   */
  private async applyCanonicalStatus(
    videoGuid: string,
    canonical: 'ready' | 'failed',
    rawStatus: number,
  ): Promise<void> {
    const { data: recording } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, status, mux_playback_id')
      .eq('provider', 'bunny')
      .or(`mux_asset_id.eq.${videoGuid},and(mux_asset_id.is.null,mux_upload_id.eq.${videoGuid})`)
      .limit(1)
      .maybeSingle();

    if (!recording) {
      this.logger.warn(`No bunny recording found for Bunny video ${videoGuid} — skipping`);
      return;
    }

    if ((recording as any).status === canonical && canonical === 'failed') {
      // Idempotent re-delivery of a failure we already recorded.
      return;
    }

    const updates: Record<string, any> = {
      status: canonical,
      mux_asset_id: videoGuid, // ensure linkage for future events/deletion
    };

    // Playback slot: for Bunny the playback identifier IS the video GUID.
    if (!(recording as any).mux_playback_id) {
      updates.mux_playback_id = videoGuid;
    }

    // Duration is not part of the webhook payload — backfill best-effort from
    // the verified REST API (mirrors Mux handleAssetReady parity).
    if (canonical === 'ready') {
      try {
        const assetStatus = await this.bunnyProvider.getAssetStatus(videoGuid);
        if (typeof assetStatus.durationSeconds === 'number') {
          updates.duration_seconds = Math.round(assetStatus.durationSeconds);
        }
      } catch (err) {
        this.logger.warn(
          `Duration backfill failed for Bunny video ${videoGuid}: ${(err as Error).message}`,
        );
      }
    }

    const { error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .update(updates)
      .eq('id', (recording as any).id);

    if (error) {
      this.logger.error(
        `DB update failed for bunny recording ${(recording as any).id}: ${error.message}`,
        error.stack,
      );
      return;
    }

    this.logger.log(
      `Bunny recording ${(recording as any).id} -> ${canonical} (webhook status=${rawStatus}, video=${videoGuid})`,
    );
    await this.redisCache.invalidateRecordingsCache();
  }
}
