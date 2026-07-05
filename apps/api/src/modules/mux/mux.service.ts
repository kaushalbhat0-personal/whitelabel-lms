/*
 * Mux service — the ONLY place that talks to the Mux API
 *
 * Why this service exists:
 *   - All video operations (upload URL creation, asset import, signed playback URLs)
 *     go through this service — never import @mux/mux-node directly elsewhere.
 *   - Key security rule: signed playback URLs are generated per-user per-request.
 *     No student ever gets a raw Mux URL — all playback goes through
 *     getSignedPlaybackUrl() which returns a time-limited JWT.
 *   - Webhook signature verification ensures only genuine Mux events are processed.
 *
 * A junior should know:
 *   - Mux client is lazy-initialised so missing credentials don't crash startup in dev.
 *   - Signed URLs expire in 4 hours (default) — short enough that sharing a link
 *     outside the platform is impractical.
 *   - The private key in env vars often has literal \n characters that need replacing
 *     with actual newlines (standard .env limitation).
 */
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mux from '@mux/mux-node';
import { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';

@Injectable()
export class MuxService {
  private readonly logger = new Logger(MuxService.name);
  private _muxClient: Mux | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly redisCache: RedisCacheService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  muxClient (private lazy getter)
  // ──────────────────────────────────────────────────────────────

  /**
   * Lazy-initialise the Mux client so we don't fail on startup if Mux credentials
   * are missing in development.
   */
  private get muxClient(): Mux {
    if (!this._muxClient) {
      const tokenId = this.configService.get<string>('MUX_TOKEN_ID');
      const tokenSecret = this.configService.get<string>('MUX_TOKEN_SECRET');

      if (!tokenId || !tokenSecret) {
        throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set in environment variables');
      }

      this._muxClient = new Mux({ tokenId, tokenSecret });
    }
    return this._muxClient;
  }

  // ──────────────────────────────────────────────────────────────
  //  createUploadUrl
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a direct upload URL for the frontend to upload a video file directly
   * to Mux (the video never touches our server).
   *
   * Steps:
   *   1. Call Mux API to create a direct upload with signed playback policy
   *   2. Return the upload URL and upload ID to the frontend
   */
  async createUploadUrl(
    title: string,
    topicId: string,
  ): Promise<{ uploadUrl: string; uploadId: string }> {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

    const upload = await this.muxClient.video.uploads.create({
      cors_origin: frontendUrl,
      new_asset_settings: {
        playback_policy: ['signed'],
        passthrough: JSON.stringify({ title, topicId }),
      },
    });

    return {
      uploadUrl: upload.url,
      uploadId: upload.id,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  createDirectUploadUrl
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a direct upload URL for the frontend to PUT a video file
   * directly to Mux. Unlike createUploadUrl (used in the admin create flow),
   * this method accepts minimal metadata and is designed for the manual
   * upload flow initiated from the Recordings page.
   *
   * Steps:
   *   1. Call Mux API Video.Uploads.create with cors_origin set to '*'
   *      so the browser can PUT from any origin in development.
   *   2. Return the upload URL and upload ID.
   */
  async createDirectUploadUrl(
    title: string,
  ): Promise<{ uploadUrl: string; uploadId: string }> {
    const upload = await this.muxClient.video.uploads.create({
      cors_origin: '*',
      new_asset_settings: {
        playback_policy: ['signed'],
        passthrough: JSON.stringify({ title }),
      },
    });

    return {
      uploadUrl: upload.url,
      uploadId: upload.id,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  uploadFromUrl
  // ──────────────────────────────────────────────────────────────

  /**
   * Import a video from a URL (used by the recording upload cron job to pull
   * Zoom cloud recordings into Mux).
   *
   * Steps:
   *   1. Tell Mux to fetch the video from the provided download URL
   *   2. Insert a record into TABLES.RECORDINGS with status 'processing'
   *   3. Return the Mux asset ID
   */
  async uploadFromUrl(
    sessionId: string,
    downloadUrl: string,
    title: string,
  ): Promise<string> {
    const asset = await this.muxClient.video.assets.create({
      input: [{ url: downloadUrl }],
      playback_policy: ['signed'],
      passthrough: JSON.stringify({ sessionId, title }),
    });

    return asset.id;
  }

  // ──────────────────────────────────────────────────────────────
  //  handleAssetReady
  // ──────────────────────────────────────────────────────────────

  /**
   * Update DB records when Mux confirms a video has finished processing.
   *
   * Steps:
   *   1. Update TABLES.RECORDINGS with status 'ready' and duration
   */
  async handleAssetReady(muxAssetId: string, durationSeconds: number, playbackId?: string): Promise<void> {
    const { data: recording } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, mux_playback_id')
      .eq('mux_asset_id', muxAssetId)
      .maybeSingle();

    if (!recording) {
      this.logger.warn(`No recording found for Mux asset ${muxAssetId} — skipping`);
      return;
    }

    const updates: Record<string, any> = {
      status: 'ready',
      duration_seconds: durationSeconds,
    };

    if (playbackId && !recording.mux_playback_id) {
      updates.mux_playback_id = playbackId;
    } else if (!recording.mux_playback_id) {
      try {
        const asset = await this.muxClient.video.assets.retrieve(muxAssetId);
        const pbId = (asset.playback_ids as any[])?.[0]?.id;
        if (pbId) {
          updates.mux_playback_id = pbId;
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch asset ${muxAssetId} from Mux API: ${(err as Error).message}`);
      }
    }

    const { error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .update(updates)
      .eq('id', recording.id);

    if (error) {
      this.logger.error(`Failed to update RECORDINGS for recording ${recording.id}: ${error.message}`, error.stack);
    } else {
      this.logger.log(`Recording ${recording.id} is ready (${durationSeconds}s, playbackId=${updates.mux_playback_id ?? recording.mux_playback_id ?? 'none'})`);
      await this.redisCache.invalidateRecordingsCache();
      this.logger.log(`Recording ${recording.id}: cache invalidated after asset_ready`);
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  getSignedPlaybackUrl
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate a 60-second signed playback URL with a unique session UUID
   * embedded in the JWT for per-request audit traceability.
   *
   * Security guarantees:
   *   - URL expires in 60s — cannot be bookmarked, shared, or reused.
   *   - Every request gets its own UUID session identifier.
   *   - Mux CDN verifies RS256 signature + expiry before serving segments.
   *   - All assets use playback_policy: 'signed' — raw playback IDs are rejected.
   *
   * Call ONCE per playback request. Never cache the returned URL.
   */
  async getSignedPlaybackUrl(
    playbackId: string,
    sessionId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const token = await this.signMuxJwt(playbackId, sessionId, 'v', expiresAt);
    return {
      url: `https://stream.mux.com/${playbackId}.m3u8?token=${token}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  getSignedThumbnailUrl
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate a signed thumbnail URL with 5-minute expiry.
   * Less sensitive than playback, but still signed to prevent hotlinking.
   */
  async getSignedThumbnailUrl(
    playbackId: string,
    sessionId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const token = await this.signMuxJwt(playbackId, sessionId, 't', expiresAt);
    return {
      url: `https://image.mux.com/${playbackId}/thumbnail.jpg?token=${token}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  signMuxJwt (private)
  // ──────────────────────────────────────────────────────────────

  private async signMuxJwt(
    playbackId: string,
    sessionId: string,
    audience: string,
    expiresAt: number,
  ): Promise<string> {
    const keyId = this.configService.get<string>('MUX_SIGNING_KEY_ID');
    let privateKey = this.configService.get<string>('MUX_SIGNING_PRIVATE_KEY');

    if (!keyId || !privateKey) {
      throw new Error(
        'MUX_SIGNING_KEY_ID and MUX_SIGNING_PRIVATE_KEY must be set in environment variables',
      );
    }

    privateKey = privateKey.replace(/\\n/g, '\n');

    const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
    const payload: Record<string, unknown> = {
      sub: playbackId,
      aud: audience,
      exp: expiresAt,
    };

    // Embed the unique session UUID so every signed URL is traceable.
    // Mux ignores unknown claims — this is for our own audit logging.
    payload.session_uuid = sessionId;

    return this.signJwt(header, payload, privateKey);
  }

  // ──────────────────────────────────────────────────────────────
  //  signJwt (private helper)
  // ──────────────────────────────────────────────────────────────

  /**
   * Manually sign a JWT with RS256 using a private key.
   *
   * We use Node's built-in crypto module instead of jsonwebtoken to avoid
   * an extra dependency for this specific use case.
   */
  private signJwt(
    header: Record<string, string>,
    payload: Record<string, any>,
    privateKey: string,
  ): string {
    const b64Encode = (obj: any) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const headerEncoded = b64Encode(header);
    const payloadEncoded = b64Encode(payload);
    const message = `${headerEncoded}.${payloadEncoded}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(message);
    const signature = signer
      .sign(privateKey, 'base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${message}.${signature}`;
  }

  // ──────────────────────────────────────────────────────────────
  //  deleteAsset
  // ──────────────────────────────────────────────────────────────

  /**
   * Delete a video asset from Mux by its asset ID.
   * Called when an admin deletes a video from the LMS.
   * 404s from Mux are silently ignored (asset may have been deleted manually).
   */
  async deleteAsset(muxAssetId: string): Promise<void> {
    try {
      await this.muxClient.video.assets.delete(muxAssetId);
      this.logger.log(`Deleted Mux asset ${muxAssetId}`);
    } catch (err: any) {
      if (err?.status === 404) {
        this.logger.warn(`Mux asset ${muxAssetId} already deleted (404)`);
        return;
      }
      this.logger.error(`Failed to delete Mux asset ${muxAssetId}: ${err.message}`, err.stack);
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  verifyWebhookSignature
  // ──────────────────────────────────────────────────────────────

  /**
   * Verify that a webhook notification actually came from Mux.
   *
   * Mux sends signatures in the format: `t=timestamp,v1=hash`
   * We recompute the hash and compare.
   *
   * Steps:
   *   1. Parse the Mux signature header to extract timestamp and hash
   *   2. Compute HMAC-SHA256 of `${timestamp}.${rawBody}`
   *   3. Compare with constant-time comparison
   */
  verifyWebhookSignature(rawBody: string, muxSignature: string): void {
    const webhookSecret = this.configService.get<string>('MUX_WEBHOOK_SECRET');

    if (!webhookSecret) {
      throw new Error('MUX_WEBHOOK_SECRET must be set in environment variables');
    }

    // Parse header: t=timestamp,v1=hash
    const parts = muxSignature.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.split('=')[1] ?? '';
    const hash = parts.find((p) => p.startsWith('v1='))?.split('=')[1] ?? '';

    if (!timestamp || !hash) {
      throw new BadRequestException('Invalid Mux webhook signature format');
    }

    const message = `${timestamp}.${rawBody}`;
    const expectedHash = crypto
      .createHmac('sha256', webhookSecret)
      .update(message)
      .digest('hex');

    // Constant-time comparison
    if (expectedHash.length !== hash.length) {
      throw new BadRequestException('Invalid Mux webhook signature');
    }

    const valid = crypto.timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(hash),
    );

    if (!valid) {
      throw new BadRequestException('Invalid Mux webhook signature');
    }
  }
}
