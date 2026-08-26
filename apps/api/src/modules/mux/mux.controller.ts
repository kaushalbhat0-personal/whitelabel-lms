/*
 * Mux controller — webhook endpoint for Mux event notifications
 *
 * Why this controller exists:
 *   - Receives HTTP callbacks from Mux when video events happen (asset ready, upload linked).
 *   - MUST be @Public() because Mux has no way to send a JWT token.
 *   - Verifies the webhook signature against the RAW body (req.rawBody) because
 *     JSON.stringify(req.body) can produce a different string after a parse/stringify
 *     round-trip, breaking the HMAC.
 *   - Always returns 200 — never throw errors to Mux or it will retry.
 *
 * A junior should know:
 *   - main.ts passes rawBody: true to preserve the raw request buffer.
 *   - Three event types are handled: video.upload.asset_created, video.asset.ready,
 *     and video.asset.errored. Unknown events are logged at debug level.
 *   - Every database operation has its own try/catch with full error logging.
 */
import { Controller, Post, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { MuxService } from './mux.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { Public } from '../../common/decorators/public.decorator';

@Controller('mux')
export class MuxController {
  private readonly logger = new Logger(MuxController.name);

  constructor(
    private readonly muxService: MuxService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * POST /mux/webhook
   *
   * Mux calls this when video processing events happen.
   * We verify the signature against the raw body, then process the event.
   */
  @Public()
  @Post('webhook')
  async handleWebhook(@Req() req: Request) {
    const muxSignature = req.headers['mux-signature'] as string;
    if (!muxSignature) {
      this.logger.warn('Missing mux-signature header');
      return { message: 'ok' };
    }

    // Use the raw body preserved by NestJS (rawBody: true in main.ts).
    // This is critical: JSON.stringify(req.body) can produce a different
    // string than the original payload after parse/stringify round-trip,
    // which would break HMAC signature verification.
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      this.logger.error('req.rawBody is empty — did main.ts forget rawBody: true?');
      return { message: 'ok' };
    }

    // Verify signature against the raw body
    try {
      this.muxService.verifyWebhookSignature(rawBody, muxSignature);
      this.logger.log('Mux webhook signature verified');
    } catch (err) {
      this.logger.error(`Mux webhook signature verification failed: ${(err as Error).message}`, (err as Error).stack);
      return { message: 'ok' };
    }

    // Parse the event (rawBody is JSON, parse it)
    let event: { type: string; object?: { id: string }; data?: Record<string, unknown> };
    try {
      event = JSON.parse(rawBody);
    } catch (err) {
      this.logger.error(`Failed to parse webhook body: ${(err as Error).message}`, (err as Error).stack);
      return { message: 'ok' };
    }

    switch (event.type) {
      // ── video.upload.asset_created ─────────────────────────
      // Mux has linked a direct upload to a new asset.
      // We update the video record (which already exists with mux_upload_id)
      // with the asset ID and playback ID.
      case 'video.upload.asset_created': {
        const uploadId = event.object?.id;
        const assetId = (event.data?.asset_id as string) ?? '';
        const playbackId = (event.data?.playback_ids as any)?.[0]?.id ?? '';

        if (!uploadId || !assetId) {
          this.logger.warn(`video.upload.asset_created missing uploadId=${uploadId} assetId=${assetId}`);
          break;
        }

        try {
          const { error } = await this.supabaseService.client
            .from(TABLES.RECORDINGS)
            .update({
              mux_asset_id: assetId,
              mux_playback_id: playbackId,
              status: 'processing',
            })
            .eq('mux_upload_id', uploadId);

          if (error) {
            this.logger.error(`DB update failed for upload ${uploadId}: ${error.message}`, error.stack);
          } else {
            this.logger.log(`Upload ${uploadId} → asset ${assetId} (playback ${playbackId})`);
          }
        } catch (err) {
          this.logger.error(`Unexpected error linking upload ${uploadId}: ${(err as Error).message}`, (err as Error).stack);
        }
        break;
      }

      // ── video.asset.ready ──────────────────────────────────
      // Mux finished processing a video asset — update status to 'ready'
      // and ensure mux_playback_id is set (may not have been in asset_created).
      case 'video.asset.ready': {
        const assetId = event.object?.id;
        // Mux sends duration as a decimal string/float (e.g. "23.285389"),
        // but the DB stores int4.  Force round to integer at the boundary.
        const durationSeconds = Math.round(Number(event.data?.duration ?? 0));
        // playback_ids are guaranteed on asset.ready (may be empty on asset_created)
        const playbackId = (event.data?.playback_ids as any)?.[0]?.id ?? undefined;

        if (!assetId) {
          this.logger.warn('video.asset.ready missing assetId');
          break;
        }

        try {
          await this.muxService.handleAssetReady(assetId, durationSeconds, playbackId);
        } catch (err) {
          this.logger.error(`Failed to handle asset ready ${assetId}: ${(err as Error).message}`, (err as Error).stack);
        }
        break;
      }

      // ── video.asset.errored ────────────────────────────────
      // Mux failed to process the asset — update status to 'failed'.
      // Canonical status mapping (Phase 7B): provider error → 'failed'
      // (the DB CHECK constraint only allows processing|ready|failed; the
      // previous 'error' value silently violated it and left rows stuck
      // in 'processing').
      case 'video.asset.errored': {
        const failedAssetId = event.object?.id;
        if (failedAssetId) {
          try {
            const { error } = await this.supabaseService.client
              .from(TABLES.RECORDINGS)
              .update({ status: 'failed' })
              .eq('mux_asset_id', failedAssetId);

            if (error) {
              this.logger.error(`Failed to mark asset ${failedAssetId} as error: ${error.message}`, error.stack);
            } else {
              this.logger.warn(`Asset ${failedAssetId} reported as errored by Mux`);
            }
          } catch (err) {
            this.logger.error(`Unexpected error handling errored asset ${failedAssetId}: ${(err as Error).message}`, (err as Error).stack);
          }
        }
        break;
      }

      // ── video.asset.deleted ────────────────────────────────
      // An asset was deleted in the Mux dashboard — remove the orphan DB row.
      case 'video.asset.deleted': {
        const deletedAssetId = event.object?.id;
        if (deletedAssetId) {
          try {
            const { error, count } = await this.supabaseService.client
              .from(TABLES.RECORDINGS)
              .delete()
              .eq('mux_asset_id', deletedAssetId);

            if (error) {
              this.logger.error(`Failed to delete DB row for asset ${deletedAssetId}: ${error.message}`, error.stack);
            } else {
              this.logger.log(`Deleted DB row for Mux asset ${deletedAssetId} (${count ?? 0} rows)`);
            }
          } catch (err) {
            this.logger.error(`Unexpected error handling deleted asset ${deletedAssetId}: ${(err as Error).message}`, (err as Error).stack);
          }
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled Mux event type: ${event.type}`);
    }

    return { message: 'ok' };
  }
}
