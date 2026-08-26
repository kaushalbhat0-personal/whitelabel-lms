/*
 * BunnyProvider — Bunny Stream implementation of VideoProvider.
 *
 * PHASE 7C STATUS: OPERATIONAL — implemented strictly against verified,
 * official bunny.net documentation and Bunny's own reference signer:
 *   - Stream API base URL + AccessKey auth ......... docs/stream/api-reference
 *   - Create video:  POST /library/{libraryId}/videos {title} -> VideoModel.guid
 *   - Fetch (pull):  POST /library/{libraryId}/videos/fetch {url,title}
 *   - Get status:    GET  /library/{libraryId}/videos/{videoId}
 *       VideoModelStatus enum: 0 Created, 1 Uploaded, 2 Processing,
 *       3 Transcoding, 4 Finished, 5 Error, 6 UploadFailed,
 *       7 JitSegmenting, 8 JitPlaylistsCreated (official OpenAPI v1.5.23)
 *   - Delete video:  DELETE /library/{libraryId}/videos/{videoId} (404 tolerated)
 *   - Direct browser upload: the raw PUT endpoint authenticates with the secret
 *       AccessKey header, so it can NEVER be handed to a browser. The verified
 *       presigned mechanism is TUS (https://video.bunnycdn.com/tusupload) with
 *       server-generated SHA256(library_id+api_key+expire+video_id) credentials.
 *       This provider returns those credentials; the web TUS uploader is a
 *       documented Phase 7D follow-up.
 *   - Playback URLs: https://{cdnHostname}/{videoGuid}/playlist.m3u8 with CDN
 *       token authentication (HMAC-SHA256). HLS requires PATH-BASED directory
 *       tokens (/bcdn_token=...&expires=...&token_path=/%2Fguid%2F/...) so
 *       segment requests inherit authorization without player changes
 *       (docs/cdn/security/token-authentication/advanced + docs/stream/security).
 *       Signing algorithm mirrors BunnyWay/BunnyCDN.TokenAuthentication nodejs
 *       reference exactly: HMAC message = signaturePath + expires + ipBytes +
 *       sorted signingData; token = 'HS256-' + base64url(digest).
 *
 * Failure is ALWAYS observable — the resolver never silently falls back to Mux
 * for a recording whose provider is 'bunny'.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  CanonicalRecordingStatus,
  CreateAssetFromSourceOptions,
  DirectUploadHandle,
  PlaybackUrlContext,
  ProviderAssetStatus,
  ProviderPlaybackUrls,
  VideoProvider,
  VideoProviderName,
} from '../video-provider.types';

/** Default Bunny CDN token lifetime: 4 hours. Covers long viewing sessions;
 *  LMS Redis playback tokens remain short-lived/sliding (unchanged layer). */
const DEFAULT_CDN_TOKEN_TTL_SECONDS = 4 * 60 * 60;

/** TUS presigned upload credential lifetime (official examples use 24h;
 *  official minimum recommendation is >= 3600s). */
const DEFAULT_UPLOAD_SIGNATURE_TTL_SECONDS = 24 * 60 * 60;

const BUNNY_API_BASE = 'https://video.bunnycdn.com';

@Injectable()
export class BunnyProvider implements VideoProvider {
  readonly name: VideoProviderName = 'bunny';
  private readonly logger = new Logger(BunnyProvider.name);
  private _http: AxiosInstance | null = null;

  constructor(private readonly configService: ConfigService) {}

  /** True only when Bunny has been explicitly enabled AND fully configured. */
  get isConfigured(): boolean {
    if (!this.enabled) return false;
    return (
      !!this.libraryId &&
      !!this.apiKey &&
      !!this.cdnHostname
    );
  }

  /** Explicit opt-in switch — Bunny never activates implicitly. */
  get enabled(): boolean {
    const raw = this.configService.get<string | undefined>('BUNNY_ENABLED');
    return String(raw).toLowerCase() === 'true';
  }

  /**
   * Verify a Bunny Stream webhook signature (official scheme, docs/stream/webhooks):
   *   signature = lowercase_hex(HMAC-SHA256(rawBody, secret))
   *   secret    = library Read-Only API key (BUNNY_WEBHOOK_SECRET)
   *   headers   = X-BunnyStream-Signature-Version: v1
   *               X-BunnyStream-Signature-Algorithm: hmac-sha256
   *               X-BunnyStream-Signature: <64 hex chars>
   */
  verifyWebhookSignature(
    rawBody: string | Buffer,
    headers: {
      version?: string | undefined;
      algorithm?: string | undefined;
      signature?: string | undefined;
    },
  ): boolean {
    if (headers.version !== 'v1' || headers.algorithm !== 'hmac-sha256') {
      return false;
    }
    const provided = headers.signature ?? '';
    if (!/^[0-9a-f]{64}$/.test(provided)) {
      return false;
    }
    const secret = this.configService.get<string>('BUNNY_WEBHOOK_SECRET');
    if (!secret) {
      // No secret configured -> nothing may ever be trusted.
      this.logger.error('BUNNY_WEBHOOK_SECRET is not configured — rejecting webhook');
      return false;
    }
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const expectedHex = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(provided, 'utf8'));
  }

  /**
   * Map a webhook Status code (docs/stream/webhooks catalogue — NOTE: a
   * different scale than the REST VideoModelStatus enum):
   *   0 Queued, 1 Processing, 2 Encoding, 3 Finished,
   *   4 Resolution finished (first one => playable), 5 Failed,
   *   6-10 presigned-upload / captions / title events.
   */
  webhookStatusToCanonical(status: number): CanonicalRecordingStatus {
    if (status === 3 || status === 4) return 'ready';
    if (status === 5) return 'failed';
    return 'processing';
  }

  async createDirectUpload(opts: { title: string }): Promise<DirectUploadHandle> {
    this.assertOperational('createDirectUpload');

    // Step 1 (verified): create the video object to obtain its GUID.
    const created = await this.http.post<{ guid: string }>(
      `/library/${this.libraryId}/videos`,
      { title: opts.title },
    );
    const videoGuid: string = created.data?.guid;
    if (!videoGuid) {
      throw new ServiceUnavailableException('Bunny create-video returned no guid');
    }

    // Step 2 (verified): presigned TUS credentials generated server-side so the
    // library API key never reaches the browser.
    const expiresAt = Math.floor(Date.now() / 1000) + this.uploadSignatureTtlSeconds;
    const signature = crypto
      .createHash('sha256')
      .update(`${this.libraryId}${this.apiKey}${expiresAt}${videoGuid}`)
      .digest('hex');

    return {
      uploadUrl: `${BUNNY_API_BASE}/tusupload`,
      uploadId: videoGuid,
      uploadKind: 'tus',
      uploadHeaders: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiresAt),
        LibraryId: String(this.libraryId),
        VideoId: videoGuid,
      },
    };
  }

  async createAssetFromSource(
    opts: CreateAssetFromSourceOptions,
  ): Promise<{ assetId: string }> {
    this.assertOperational('createAssetFromSource');

    const title = String(opts.passthrough?.title ?? 'Recording');
    // Verified fetch endpoint pulls the source server-side (single request —
    // credential-in-query URLs like Zoom downloads are supported).
    //
    // LIVE VERIFICATION NOTE (Phase 7E): unlike Create Video (VideoModel.guid),
    // the Fetch endpoint answers with a generic ApiResult whose payload field
    // is `id` ({ "id": "<newVideoGuid>", "success": true, ... }). Accept both
    // shapes defensively — reading only `guid` silently breaks the Zoom
    // auto-pipeline under Bunny.
    const response = await this.http.post<{ guid?: string; id?: string }>(
      `/library/${this.libraryId}/videos/fetch`,
      { url: opts.sourceUrl, title },
    );
    const guid = response.data?.guid ?? response.data?.id;
    if (!guid) {
      throw new ServiceUnavailableException('Bunny fetch returned no guid');
    }
    return { assetId: guid };
  }

  async getAssetStatus(assetId: string): Promise<ProviderAssetStatus> {
    this.assertOperational('getAssetStatus');

    const response = await this.http.get<BunnyVideoModel>(
      `/library/${this.libraryId}/videos/${assetId}`,
    );
    const video = response.data;
    return {
      status: BunnyProvider.apiStatusToCanonical(video?.status),
      durationSeconds:
        typeof video?.length === 'number' && video.length > 0 ? video.length : undefined,
      playbackId: video?.guid ?? assetId,
    };
  }

  async getPlaybackUrls(
    playbackId: string,
    ctx: PlaybackUrlContext,
  ): Promise<ProviderPlaybackUrls> {
    this.assertOperational('getPlaybackUrls');

    const securityKey = this.configService.get<string>('BUNNY_TOKEN_SIGNING_KEY');
    if (!securityKey) {
      throw new ServiceUnavailableException(
        'BUNNY_TOKEN_SIGNING_KEY is not configured — cannot sign Bunny CDN playback URLs',
      );
    }

    const ttlSeconds = this.cdnTokenTtlSeconds;
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

    // Manifest: path-based DIRECTORY token scoped to /{videoGuid}/ so every
    // relative segment URL inherits authorization (verified requirement for HLS).
    const manifestPath = `/${playbackId}/playlist.m3u8`;
    const url = this.signCdnUrl(securityKey, manifestPath, {
      expiresAt,
      directory: true,
      tokenPath: `/${playbackId}/`,
    });

    // Thumbnail: exact-path query-string token (images need no inheritance).
    const thumbnailUrl = this.signCdnUrl(
      securityKey,
      `/${playbackId}/thumbnail.jpg`,
      { expiresAt, directory: false },
    );

    void ctx.sessionId; // audit trail lives in LMS video_access_logs (CDN tokens carry no free-form claims)
    return {
      url,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      thumbnailUrl,
    };
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.assertOperational('deleteAsset');

    try {
      await this.http.delete(`/library/${this.libraryId}/videos/${assetId}`);
      this.logger.log(`Deleted Bunny video ${assetId}`);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        this.logger.warn(`Bunny video ${assetId} already deleted (404)`);
        return;
      }
      this.logger.error(`Failed to delete Bunny video ${assetId}: ${err?.message}`);
      throw err;
    }
  }

  // ── internals ───────────────────────────────────────────────

  private get libraryId(): string {
    return this.configService.get<string>('BUNNY_LIBRARY_ID') ?? '';
  }

  private get apiKey(): string {
    return this.configService.get<string>('BUNNY_API_KEY') ?? '';
  }

  private get cdnHostname(): string {
    return this.configService.get<string>('BUNNY_CDN_HOSTNAME') ?? '';
  }

  private get cdnTokenTtlSeconds(): number {
    const raw = Number(this.configService.get<string>('BUNNY_CDN_TOKEN_TTL_SECONDS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CDN_TOKEN_TTL_SECONDS;
  }

  private get uploadSignatureTtlSeconds(): number {
    const raw = Number(this.configService.get<string>('BUNNY_UPLOAD_SIGNATURE_TTL_SECONDS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_SIGNATURE_TTL_SECONDS;
  }

  private get http(): AxiosInstance {
    if (!this._http) {
      this._http = axios.create({
        baseURL: BUNNY_API_BASE,
        headers: {
          AccessKey: this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      });
    }
    return this._http;
  }

  /**
   * Map the REST VideoModelStatus enum (official OpenAPI bunnynet-video-api
   * v1.5.23) onto the canonical vocabulary. Unknown values stay 'processing'
   * (conservative — never invent readiness).
   */
  static apiStatusToCanonical(status: number | undefined): CanonicalRecordingStatus {
    if (status === 4) return 'ready'; // Finished
    if (status === 5 || status === 6) return 'failed'; // Error, UploadFailed
    return 'processing'; // Created/Uploaded/Processing/Transcoding/JIT states/unknown
  }

  /**
   * Exact port of the signing algorithm in BunnyWay/BunnyCDN.TokenAuthentication
   * (nodejs/token.js) restricted to the no-IP, optional-directory case used here:
   *   hmacMessage  = signaturePath + expires + <no ip bytes> + signingData
   *   signingData  = alphabetically sorted key=value pairs joined by '&'
   *   token        = 'HS256-' + base64url(hmacDigest) (+/- swap, '=' stripped)
   *   directory    -> {origin}/bcdn_token={token}&{urlData}&expires={e}{path}
   *   query-string -> {origin}{path}?token={token}&{urlData}&expires={e}
   */
  private signCdnUrl(
    securityKey: string,
    pathname: string,
    opts: { expiresAt: number; directory: boolean; tokenPath?: string },
  ): string {
    const parameters: Record<string, string> = {};
    if (opts.tokenPath) {
      parameters['token_path'] = opts.tokenPath;
    }

    const sortedEntries = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b));
    const signaturePath = opts.tokenPath || pathname;
    const signingData = sortedEntries.map(([k, v]) => `${k}=${v}`).join('&');
    const urlData = sortedEntries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const expires = String(opts.expiresAt);

    const hmac = crypto.createHmac('sha256', securityKey);
    hmac.update(signaturePath);
    hmac.update(expires);
    hmac.update(signingData);
    const digest = hmac.digest();

    const token =
      'HS256-' +
      digest
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const origin = `https://${this.cdnHostname}`;
    const tail = urlData ? `&${urlData}` : '';
    if (opts.directory) {
      return `${origin}/bcdn_token=${token}${tail}&expires=${expires}${pathname}`;
    }
    return `${origin}${pathname}?token=${token}${tail}&expires=${expires}`;
  }

  private assertOperational(operation: string): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        `Bunny video provider is not enabled/configured (${operation}). ` +
          `Set BUNNY_ENABLED=true plus BUNNY_LIBRARY_ID/BUNNY_API_KEY/BUNNY_CDN_HOSTNAME.`,
      );
    }
  }
}

interface BunnyVideoModel {
  videoLibraryId?: number;
  guid?: string;
  title?: string;
  length?: number;
  status?: number;
  thumbnailFileName?: string;
}
