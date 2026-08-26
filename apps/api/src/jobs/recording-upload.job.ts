import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SupabaseService } from '../common/services/supabase.service';
import { RecordingProviderResolver } from '../modules/video-provider/recording-provider.resolver';
import { TABLES } from '../common/constants/tables.constant';

@Injectable()
export class RecordingUploadJob {
  private readonly logger = new Logger(RecordingUploadJob.name);
  private isRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
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
      await this.processQueue();
    } finally {
      this.isRunning = false;
    }
  }

  private async processQueue() {
    const now = new Date().toISOString();

    const { data: pendingJobs, error } = await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .select('*')
      .eq('status', 'pending')
      .gt('zoom_url_expires_at', now)
      .order('created_at', { ascending: true })
      .limit(3);

    if (error) {
      this.logger.error(`Failed to fetch pending uploads: ${error.message}`);
      return;
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return;
    }

    this.logger.log(`Processing ${pendingJobs.length} pending upload(s)`);

    let zoomToken: string | null = null;
    try {
      zoomToken = await this.getZoomAccessToken();
    } catch (err: any) {
      this.logger.error(`Failed to get Zoom access token: ${err.message}`);
      return;
    }

    for (const job of pendingJobs) {
      try {
        await this.processJob(job, zoomToken);
      } catch (err: any) {
        await this.markJobFailed(job.id, err.message);
        this.logger.error(`Failed to process upload ${job.id}: ${err.message}`);
      }
    }
  }

  private async processJob(job: any, zoomToken: string) {
    await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({ status: 'processing' })
      .eq('id', job.id);

    const downloadUrl = `${job.zoom_download_url}?access_token=${zoomToken}`;

    // Provider routing is decided by the session's target batches
    // (Batch policy lives in RecordingProviderResolver — never inline here).
    const { data: sessionBatches } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('batch_id')
      .eq('session_id', job.session_id);

    const batchIds = (sessionBatches ?? []).map((sb: any) => sb.batch_id);
    const providerName = this.providerResolver.resolveUploadProvider(batchIds);
    const provider = this.providerResolver.resolve(providerName);

    const { assetId } = await provider.createAssetFromSource({
      sourceUrl: downloadUrl,
      passthrough: { sessionId: job.session_id || '', title: 'Recording' },
    });

    const { data: recording, error: recordingError } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .insert({
        session_id: job.session_id || null,
        title: 'Recording',
        provider: providerName,
        mux_asset_id: assetId, // provider-identifier storage slot (keyed by `provider`)
        status: 'processing',
      })
      .select()
      .single();

    if (recordingError) {
      throw new Error(`Failed to create recording: ${recordingError.message}`);
    }

    if (sessionBatches && sessionBatches.length > 0) {
      const batchRecords = sessionBatches.map((sb: any) => ({
        recording_id: recording.id,
        batch_id: sb.batch_id,
      }));

      const { error: linkError } = await this.supabaseService.client
        .from(TABLES.RECORDING_BATCHES)
        .insert(batchRecords);

      if (linkError) {
        this.logger.warn(`Failed to link recording to batches: ${linkError.message}`);
      }
    }

    await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({
        status: 'done',
        mux_asset_id: assetId,
      })
      .eq('id', job.id);

    this.logger.log(
      `Upload ${job.id} → Recording ${recording.id} (${providerName} asset ${assetId})`,
    );
  }

  private async markJobFailed(jobId: string, errorMessage: string) {
    await this.supabaseService.client
      .from(TABLES.UPLOAD_QUEUE)
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', jobId);
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
