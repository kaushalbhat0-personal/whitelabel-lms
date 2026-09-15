import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SupabaseService } from '../common/services/supabase.service';
import { RecordingsService } from '../modules/recordings/recordings.service';
import { RecordingProviderResolver } from '../modules/video-provider/recording-provider.resolver';
import { TABLES } from '../common/constants/tables.constant';

/**
 * Zoom -> Bunny recording ingestion worker (Phase 8 hardening).
 *
 * Design constraints (RCCF Phase 8):
 *   - ASYNC BY CONSTRUCTION: the Zoom webhook only enqueues a row here; this
 *     cron performs the (provider-side) transfer OUTSIDE any HTTP request.
 *     Bunny's fetch/pull endpoint downloads the media server-to-server, so the
 *     LMS never loads video bytes into memory.
 *   - IDEMPOTENT: the webhook de-duplicates by Zoom file id, and THIS worker
 *     additionally persists the returned provider asset id BEFORE creating the
 *     recording row — a crash/restart mid-job resumes instead of duplicating
 *     the Bunny import (asset id is reused, never fetched twice).
 *   - RETRYABLE: transient failures mark the job 'failed' with attempt count;
 *     later ticks re-claim it with simple backoff up to MAX_ATTEMPTS. Expired
 *     source URLs are parked as 'expired' instead of being rescanned forever.
 *   - BATCH INHERITANCE IS CANONICAL: student access rows are written through
 *     RecordingsService.assignToBatches() ONLY — the same transactional path
 *     the manual upload route uses (recording_batches + curriculum entries +
 *     Redis cache invalidation). Batch ids are derived server-side from
 *     session_batches; nothing client-supplied is ever trusted here.
 *
 * A junior should know:
 *   - statuses used: pending -> processing -> done | failed (retryable) | expired
 *     (recordings themselves use the canonical processing|ready|failed vocabulary,
 *      flipped to ready ONLY by the verified Bunny webhook).
 */
@Injectable()
export class RecordingUploadJob {
  private readonly logger = new Logger(RecordingUploadJob.name);
  private isRunning = false;

  /** Retry policy: after failure #n wait BACKOFF_MINUTES[n-2] before reclaiming. */
  public static readonly MAX_ATTEMPTS = 3;
  public static readonly BACKOFF_MINUTES = [5, 30];
  /** A 'processing' row older than this is presumed dead (crash/restart) and reclaimed. */
  public static readonly STALE_PROCESSING_MINUTES = 30;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly recordingsService: RecordingsService,
    private readonly providerResolver: RecordingProviderResolver,
    private readonly configService: ConfigService,
  ) {}

  @Cron('*/2 * * * *')
  async processPendingUploads() {
    if (this.isRunning) {
      this.logger.debug('Upload job already running, skipping this tick');
      return;
    }

    this.isRunning = true;
    try {
      await this.reclaimStaleProcessing();
      await this.processQueue();
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Rows stuck in 'processing' (e.g. the API restarted mid-job) go back to
   * 'pending'. Safe because every step below is resumable/idempotent.
   */
  private async reclaimStaleProcessing() {
    const cutoff = new Date(
      Date.now() - RecordingUploadJob.STALE_PROCESSING_MINUTES * 60 * 1000,
    ).toISOString();

    const { error } = await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .lt('updated_at', cutoff);

    if (error) {
      this.logger.error(`Failed to reclaim stale processing rows: ${error.message}`);
    }
  }

  private async processQueue() {
    const now = new Date().toISOString();

    const { data: jobs, error } = await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .select('*')
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      this.logger.error(`Failed to fetch pending uploads: ${error.message}`);
      return;
    }
    if (!jobs || jobs.length === 0) return;

    // Client-side claim filters (kept out of SQL on purpose — PostgREST cannot
    // express the backoff arithmetic without another RPC).
    const claimable = jobs.filter((job: any) => {
      if (job.zoom_url_expires_at && job.zoom_url_expires_at <= now) return false; // parked below
      const attempts = Number(job.attempts) || 0;
      if (job.status === 'failed') {
        if (attempts >= RecordingUploadJob.MAX_ATTEMPTS) return false; // terminal
        const waitMinutes =
          RecordingUploadJob.BACKOFF_MINUTES[
            Math.max(0, Math.min(attempts - 1, RecordingUploadJob.BACKOFF_MINUTES.length - 1))
          ];
        const readyAt =
          new Date(job.updated_at).getTime() + waitMinutes * 60 * 1000;
        if (Date.now() < readyAt) return false; // still backing off
      }
      return true;
    });

    // Park expired source URLs so they stop being scanned every tick.
    const expired = jobs.filter(
      (job: any) =>
        job.status === 'pending' &&
        job.zoom_url_expires_at &&
        job.zoom_url_expires_at <= now,
    );
    for (const job of expired) {
      await this.supabaseService.client
        .from(TABLES.UPLOAD_QUEUE)
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', job.id);
      this.logger.warn(`Upload ${job.id} expired (Zoom download URL past validity window)`);
    }

    if (claimable.length === 0) return;

    this.logger.log(`Processing ${claimable.length} upload job(s)`);

    let zoomToken: string | null = null;
    try {
      zoomToken = await this.getZoomAccessToken();
    } catch (err: any) {
      this.logger.error(`Failed to get Zoom access token: ${err.message}`);
      return;
    }

    for (const job of claimable) {
      try {
        await this.processJob(job, zoomToken as string);
      } catch (err: any) {
        await this.markJobFailed(job, err.message);
        this.logger.error(`Failed to process upload ${job.id}: ${err.message}`);
      }
    }
  }

  private async processJob(job: any, zoomToken: string) {
    const attemptsAfterClaim = (Number(job.attempts) || 0) + 1;

    await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({
        status: 'processing',
        attempts: attemptsAfterClaim,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    const title =
      typeof job.zoom_topic === 'string' && job.zoom_topic.trim()
        ? job.zoom_topic.trim()
        : 'Recording';

    // ── Step 1: derive batches from the canonical live session ──────────────
    // Never trust anything client-supplied: the association lives exclusively
    // in session_batches for the resolved live_session.
    let batchIds: string[] = [];
    if (job.session_id) {
      const { data: sessionBatches } = await this.supabaseService.client
        .from(TABLES.SESSION_BATCHES)
        .select('batch_id')
        .eq('session_id', job.session_id);
      batchIds = (sessionBatches ?? []).map((sb: any) => sb.batch_id);
    }

    // ── Step 2: provider routing (bunny-first production policy, unchanged) ──
    const providerName = this.providerResolver.resolveUploadProvider(batchIds);
    const provider = this.providerResolver.resolve(providerName);

    // ── Step 3: transfer/import — REUSE the asset id across retries ─────────
    // Persist the guid immediately after the fetch call returns so a crash
    // between "Bunny accepted" and "recording inserted" can never cause a
    // second Bunny import of the same media.
    let assetId: string | null = job.mux_asset_id ?? null;
    if (assetId) {
      this.logger.log(
        `Upload ${job.id} resuming with existing ${providerName} asset ${assetId} (no duplicate import)`,
      );
    } else {
      const downloadUrl = this.buildAuthenticatedDownloadUrl(
        job.zoom_download_url,
        zoomToken,
      );
      const imported = await provider.createAssetFromSource({
        sourceUrl: downloadUrl,
        passthrough: { sessionId: job.session_id || '', title },
      });
      assetId = imported.assetId;

      await this.supabaseService.client
        .from(TABLES.UPLOAD_QUEUE)
        .update({ mux_asset_id: assetId, updated_at: new Date().toISOString() })
        .eq('id', job.id);
    }

    // ── Step 4: create-or-reuse the recording row (dedupe by provider slot) ──
    let recordingId: string | null = null;
    const { data: existingRecording } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id')
      .eq('provider', providerName)
      .eq('mux_asset_id', assetId as string)
      .limit(1);

    if (existingRecording && existingRecording.length > 0) {
      recordingId = existingRecording[0].id;
      this.logger.log(
        `Upload ${job.id} reuses recording ${recordingId} (${providerName} asset ${assetId})`,
      );
    } else {
      const { data: recording, error: recordingError } = await this.supabaseService.client
        .from(TABLES.RECORDINGS)
        .insert({
          session_id: job.session_id || null,
          title,
          provider: providerName,
          mux_asset_id: assetId, // provider-identifier storage slot (keyed by `provider`)
          status: 'processing', // flips to ready ONLY via the verified Bunny webhook
        })
        .select('id')
        .single();

      if (recordingError || !recording) {
        throw new Error(`Failed to create recording: ${recordingError?.message}`);
      }
      recordingId = recording.id;
    }

    // ── Step 5: inherit batches through the CANONICAL assignment path ───────
    // Records recording_batches + batch_recording_curriculum transactionally
    // and invalidates the Redis recordings cache (same code as manual upload).
    // With zero batches the recording stays invisible to students until an
    // admin assigns it — never globally public by default.
    if (batchIds.length > 0) {
      await this.recordingsService.assignToBatches(recordingId as string, batchIds);
      this.logger.log(
        `Recording ${recordingId} inherited ${batchIds.length} batch(es) from session ${job.session_id}`,
      );
    } else {
      this.logger.warn(
        `Recording ${recordingId} has NO batch inheritance (session ${job.session_id ?? 'null'} has no session_batches rows) — admin must assign manually`,
      );
    }

    // ── Step 6: close the job ────────────────────────────────────────────────
    await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', job.id);

    this.logger.log(
      `Upload ${job.id} done → recording ${recordingId} (${providerName} asset ${assetId}, attempt ${attemptsAfterClaim})`,
    );
  }

  /**
   * Append the S2S OAuth token to the Zoom download URL without ever logging
   * or persisting the credential-bearing result.
   */
  private buildAuthenticatedDownloadUrl(downloadUrl: string, token: string): string {
    if (!downloadUrl) {
      throw new Error('upload_queue row has no zoom_download_url');
    }
    return `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}access_token=${token}`;
  }

  private async markJobFailed(job: any, rawMessage: string) {
    const message = String(rawMessage ?? 'unknown error')
      .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]')
      .replace(/api[-_]?key=[^&\s]+/gi, 'api_key=[redacted]')
      .slice(0, 500);

    await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  }

  private async getZoomAccessToken(): Promise<string> {
    const accountId = this.configService.get<string>('ZOOM_ACCOUNT_ID');
    const clientId = this.configService.get<string>('ZOOM_CLIENT_ID');
    const clientSecret = this.configService.get<string>('ZOOM_CLIENT_SECRET');

    if (!accountId || !clientId || !clientSecret) {
      throw new Error('Zoom credentials not configured');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const { data } = await axios.post(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      null,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    return data.access_token;
  }
}
