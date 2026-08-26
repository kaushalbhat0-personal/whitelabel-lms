import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../common/services/supabase.service';
import { RecordingProviderResolver } from '../modules/video-provider/recording-provider.resolver';
import { ObservabilityService } from '../modules/observability/observability.service';
import { TABLES } from '../common/constants/tables.constant';
import { logEntityEvent } from '../common/utils/observability-helper';

export interface CleanupSummary {
  processed: number;
  deleted: number;
  retried: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

@Injectable()
export class RecordingCleanupJob {
  private readonly logger = new Logger(RecordingCleanupJob.name);
  private isRunning = false;

  private static readonly MAX_RETRIES = 10;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly providerResolver: RecordingProviderResolver,
    private readonly observabilityService: ObservabilityService,
  ) {}

  /**
   * Cron handler: process recordings with cleanup_pending=true every 15 minutes.
   * - Queries up to 20 recordings (oldest first) where cleanup_pending=true and cleanup_failed=false.
   * - For each recording: deletes the asset through its OWNING provider
   *   (recordings.provider), then deletes the DB row on success/not-found.
   * - On provider error: increments retry_count. After 10 retries: marks cleanup_failed=true.
   * - Returns a CleanupSummary with processed/deleted/retried/failed/skipped/durationMs counters.
   * @returns CleanupSummary — metrics for this run.
   */
  @Cron('0 */15 * * * *')
  async processCleanupQueue(): Promise<CleanupSummary> {
    if (this.isRunning) {
      this.logger.debug('[Cleanup] Job already running, skipping this tick');
      return {
        processed: 0, deleted: 0, retried: 0, failed: 0, skipped: 0, durationMs: 0,
      };
    }

    this.isRunning = true;
    try {
      return await this.run();
    } finally {
      this.isRunning = false;
    }
  }

  private async run(): Promise<CleanupSummary> {
    const startTime = Date.now();
    const summary: CleanupSummary = {
      processed: 0, deleted: 0, retried: 0, failed: 0, skipped: 0, durationMs: 0,
    };

    try {
      const { data: recordings, error } = await this.supabaseService.client
        .from(TABLES.RECORDINGS)
        .select('id, mux_asset_id, provider, title, retry_count')
        .eq('cleanup_pending', true)
        .eq('cleanup_failed', false)
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        this.logger.error(`[Cleanup] Query failed: ${error.message}`);
        summary.durationMs = Date.now() - startTime;
        return summary;
      }

      if (!recordings || recordings.length === 0) {
        this.logger.log('[Cleanup] No recordings pending cleanup');
        summary.durationMs = Date.now() - startTime;
        return summary;
      }

      summary.processed = recordings.length;
      this.logger.log(`[Cleanup] Started | pending=${recordings.length}`);

      for (const recording of recordings) {
        try {
          await this.cleanupRecording(recording, summary);
        } catch (err) {
          summary.failed++;
          this.logger.error(
            `[Cleanup] Unexpected error for recording ${recording.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`[Cleanup] Run failed: ${(err as Error).message}`);
    }

    summary.durationMs = Date.now() - startTime;
    this.logger.log(
      `[Cleanup] Complete | processed=${summary.processed} | deleted=${summary.deleted} | retried=${summary.retried} | failed=${summary.failed} | skipped=${summary.skipped} | durationMs=${summary.durationMs}`,
    );

    return summary;
  }

  private async cleanupRecording(recording: any, summary: CleanupSummary): Promise<void> {
    if (!recording.mux_asset_id) {
      await this.deleteRecordingRow(recording.id);
      summary.deleted++;
      this.logger.warn(`[Cleanup] Recording ${recording.id} had no provider asset id — deleted orphan`);
      return;
    }

    try {
      // Delete through the OWNING provider — Mux rows delete from Mux,
      // Bunny rows from Bunny. Never the other way around.
      await this.providerResolver.providerFor(recording).deleteAsset(recording.mux_asset_id);
      await this.deleteRecordingRow(recording.id);
      summary.deleted++;
      this.logger.log(
        `[Cleanup] Deleted recording ${recording.id} (${recording.provider ?? 'mux'} asset ${recording.mux_asset_id})`,
      );
    } catch (err: any) {
      await this.handleProviderError(recording, err, summary);
      return;
    }

    try {
      await logEntityEvent(
        this.observabilityService,
        'RECORDING_CLEANUP_COMPLETED',
        'recording',
        recording.id,
        'system',
        { title: recording.title, mux_asset_id: recording.mux_asset_id },
      );
    } catch {
      // event logging is best-effort
    }
  }

  private async handleProviderError(recording: any, err: Error, summary: CleanupSummary): Promise<void> {
    const currentRetries = (recording.retry_count ?? 0) + 1;

    if (currentRetries >= RecordingCleanupJob.MAX_RETRIES) {
      const { error: updateError } = await this.supabaseService.client
        .from(TABLES.RECORDINGS)
        .update({ retry_count: currentRetries, cleanup_failed: true })
        .eq('id', recording.id);

      if (updateError) {
        this.logger.error(
          `[Cleanup] Failed to mark recording ${recording.id} as cleanup_failed: ${updateError.message}`,
        );
      }

      summary.failed++;
      this.logger.error(
        `[Cleanup] Retry exhausted for recording ${recording.id} (${recording.provider ?? 'mux'} asset ${recording.mux_asset_id}) after ${currentRetries} attempts. Marked cleanup_failed. Error: ${err.message}`,
      );

      try {
        await logEntityEvent(
          this.observabilityService,
          'RECORDING_CLEANUP_FAILED',
          'recording',
          recording.id,
          'system',
          {
            title: recording.title,
            mux_asset_id: recording.mux_asset_id,
            error: err.message,
            retries: currentRetries,
          },
        );
      } catch {
        // event logging is best-effort
      }
    } else {
      const { error: updateError } = await this.supabaseService.client
        .from(TABLES.RECORDINGS)
        .update({ retry_count: currentRetries })
        .eq('id', recording.id);

      if (updateError) {
        this.logger.error(
          `[Cleanup] Failed to update retry_count for recording ${recording.id}: ${updateError.message}`,
        );
      }

      summary.retried++;
      this.logger.warn(
        `[Cleanup] ${recording.provider ?? 'mux'} delete failed for recording ${recording.id} (asset ${recording.mux_asset_id}), retry ${currentRetries}/${RecordingCleanupJob.MAX_RETRIES}. Error: ${err.message}`,
      );
    }
  }

  private async deleteRecordingRow(id: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete recording row ${id}: ${error.message}`);
    }
  }
}
