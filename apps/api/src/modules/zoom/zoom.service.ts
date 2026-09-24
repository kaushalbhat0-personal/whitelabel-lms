/*
 * Zoom service — the ONLY place that talks to the Zoom API
 *
 * Why this service exists:
 *   - All other services call this when they need Zoom data — never import axios and hit
 *     Zoom directly from anywhere else.
 *   - Handles Server-to-Server OAuth (account-level, not user-level) so the backend
 *     can create webinars and manage registrants programmatically.
 *   - Verifies webhook signatures so we know events are genuinely from Zoom.
 *
 * A junior should know:
 *   - getAccessToken() fetches a fresh token each time (1-hour expiry). You could cache
 *     it in Redis with a 55-minute TTL to reduce API calls.
 *   - Every Zoom API call goes through zoomRequest() which handles auth and errors.
 *   - verifyWebhookSignature() is called before processing ANY Zoom webhook event to
 *     prevent fake events from malicious actors.
 */
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { DEFAULT_TIMEZONE } from '../../common/config/defaults';

export interface CreateWebinarDto {
  /** Display title of the webinar */
  topic: string;
  /** Optional description shown in Zoom's UI */
  agenda?: string;
  /** ISO-8601 start datetime */
  startTime: string;
  /** Duration in minutes (15–480) */
  durationMinutes: number;
}

export interface ZoomWebinarResult {
  /** Zoom's numeric webinar ID */
  webinarId: string;
  /** Public join URL for attendees */
  joinUrl: string;
  /** Host's start URL (only the teacher can use this) */
  startUrl: string;
}

@Injectable()
export class ZoomService {
  private readonly logger = new Logger(ZoomService.name);
  private readonly baseUrl = 'https://api.zoom.us/v2';
  private readonly authUrl = 'https://zoom.us/oauth/token';

  constructor(private readonly configService: ConfigService) {}

  // ──────────────────────────────────────────────────────────────
  //  getAccessToken (private)
  // ──────────────────────────────────────────────────────────────

  /**
   * Fetch a fresh OAuth access token from Zoom.
   *
   * Zoom Server-to-Server OAuth flow:
   *   - POST to /oauth/token with grant_type=account_credentials
   *   - Basic auth header = base64(clientId:clientSecret)
   *   - Token expires in 1 hour
   *
   * For now we fetch a fresh token for every request. If this becomes a performance
   * bottleneck, cache the token in Redis with a 55-minute TTL.
   */
  private async getAccessToken(): Promise<string> {
    const accountId = this.configService.get<string>('ZOOM_ACCOUNT_ID');
    const clientId = this.configService.get<string>('ZOOM_CLIENT_ID');
    const clientSecret = this.configService.get<string>('ZOOM_CLIENT_SECRET');

    if (!accountId || !clientId || !clientSecret) {
      throw new Error(
        'ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET must be set in environment variables',
      );
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const { data } = await axios.post(
      `${this.authUrl}?grant_type=account_credentials&account_id=${accountId}`,
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

  // ──────────────────────────────────────────────────────────────
  //  zoomRequest (private)
  // ──────────────────────────────────────────────────────────────

  /**
   * Centralised Zoom HTTP client — every Zoom API call goes through here.
   *
   * Steps:
   *   1. Get a fresh access token
   *   2. Make the HTTP request to Zoom
   *   3. If Zoom returns an error, throw BadRequestException with Zoom's message
   *   4. Return the response data
   */
  private async zoomRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const token = await this.getAccessToken();

    try {
      const { data } = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        data: body,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return data;
    } catch (error: any) {
      const status = error.response?.status;
      const zoomMessage =
        error.response?.data?.message || error.message || 'Unknown Zoom error';
      this.logger.error(`Zoom API error [${method} ${path}]: ${status} ${zoomMessage}`);

      switch (status) {
        case 401:
          throw new UnauthorizedException(`Zoom API: ${zoomMessage}`);
        case 403:
          throw new ForbiddenException(`Zoom API: ${zoomMessage}`);
        case 404:
          throw new NotFoundException(`Zoom API: ${zoomMessage}`);
        case 429:
          throw new HttpException(`Zoom API rate limited: ${zoomMessage}`, 429);
        default:
          if (status && status >= 500) {
            throw new ServiceUnavailableException(`Zoom API: ${zoomMessage}`);
          }
          throw new InternalServerErrorException(`Zoom API: ${zoomMessage}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  createWebinar
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a Zoom Webinar via the Zoom API.
   *
   * Uses the account-level endpoint (/users/me/webinars) so the webinar lives
   * under the LMS Zoom account, not an individual teacher. This gives us full
   * control over security settings (practice session, recording, registration).
   *
   * Timezone handling:
   *   - The frontend sends start_time as a UTC ISO-8601 string (e.g. "2026-07-15T04:30:00.000Z").
   *   - We keep the value as-is — Zoom receives UTC and converts to Asia/Kolkata
   *     for its UI, so there is no double-offset drift.
   *
   * Key settings:
   *   - type: 5 = scheduled webinar
   *   - auto_recording: 'cloud' = recording starts automatically
   *   - practice_session: true = host can test before going live
   *   - allow_multiple_devices: false = restrict to one device per attendee
   *
   * Steps:
   *   1. POST /users/me/webinars with webinar settings
   *   2. Return the webinar ID, join URL, and host start URL
   */
  async createWebinar(dto: CreateWebinarDto): Promise<ZoomWebinarResult> {
    // ── Timezone conversion ──────────────────────────────────────
    // The frontend sends startTime as a UTC ISO-8601 string
    // (e.g. "2026-07-15T14:30:00.000Z" which is 8:00 PM IST).
    //
    // Zoom bug: when timezone='Asia/Kolkata' is set, Zoom interprets
    // the local-time portion as IST instead of UTC — so 14:30 would
    // become 2:30 PM IST instead of 8:00 PM IST.
    //
    // Fix: strip the UTC offset, add 330 min (IST offset), and
    // format as YYYY-MM-DDTHH:mm:ss (no timezone suffix).  Zoom
    // then treats the value as Asia/Kolkata local time.
    const utcDate = new Date(dto.startTime);
    const istDate = new Date(utcDate.getTime() + 330 * 60_000);
    const yyyy = istDate.getUTCFullYear();
    const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(istDate.getUTCDate()).padStart(2, '0');
    const hh = String(istDate.getUTCHours()).padStart(2, '0');
    const min = String(istDate.getUTCMinutes()).padStart(2, '0');
    const ss = String(istDate.getUTCSeconds()).padStart(2, '0');
    const startTime = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;

    const data = await this.zoomRequest('POST', '/users/me/webinars', {
      topic: dto.topic,
      type: 5,
      start_time: startTime,
      duration: dto.durationMinutes,
      timezone: DEFAULT_TIMEZONE,
      settings: {
        hd_video: false, // Explicit OFF to avoid inheriting account default ON for screen-share HD
        practice_session: false,
        audio: 'voip',
        auto_recording: 'cloud',
        host_video: true,
        panelists_video: true,
        allow_multiple_devices: false,
        approval_type: 2, // No registration required — hassle-free direct join via generic join_url
        registrants_email_notification: false,
        registrants_confirmation_email: false,
        allow_attendee_to_record: false,
        question_and_answer: {
          enable: false,
          allow_anonymous_questions: false,
        },
        contact_name: 'LMS Admin',
        show_share_button: false,
        allow_attendees_to_chat: 'host_and_panelists',
      },
    });

    return {
      webinarId: data.id.toString(),
      joinUrl: data.join_url,
      startUrl: data.start_url,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  deleteWebinar
  // ──────────────────────────────────────────────────────────────

  /**
   * Cancel/delete a Zoom webinar.
   *
   * Calls DELETE /webinars/{webinarId} using the server-to-server OAuth token.
   * Zoom will cancel the webinar and prevent anyone from joining.
   */
  async deleteWebinar(webinarId: string): Promise<void> {
    await this.zoomRequest('DELETE', `/webinars/${webinarId}`);
    this.logger.log(`Zoom webinar ${webinarId} deleted`);
  }

  // ──────────────────────────────────────────────────────────────
  //  registerAttendee
  // ──────────────────────────────────────────────────────────────

  /**
   * Register a single attendee (student) for a Zoom Webinar.
   *
   * Each student gets a UNIQUE join URL. This is how Zoom knows who is who
   * when they join — the URL is tied to their email address.
   *
   * Steps:
   *   1. POST /webinars/{webinarId}/registrants with the student's name and email
   *   2. Return the unique join_url from the response
   */
  async registerAttendee(
    webinarId: string,
    user: { name: string; email: string },
  ): Promise<string> {
    // Split name into first and last for Zoom's required fields
    const nameParts = user.name.split(' ');
    const firstName = nameParts[0] || user.name;
    const lastName = nameParts.slice(1).join(' ') || ' ';

    const data = await this.zoomRequest(
      'POST',
      `/webinars/${webinarId}/registrants`,
      {
        first_name: firstName,
        last_name: lastName,
        email: user.email,
      },
    );

    return data.join_url;
  }

  // ──────────────────────────────────────────────────────────────
  //  generateSignature
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate a JWT signature for the Zoom Meeting SDK.
   *
   * The Zoom Web SDK requires a time-limited HMAC signature to join a meeting.
   * This is generated server-side so the SDK secret is never exposed to the client.
   *
   * Steps:
   *   1. Get ZOOM_SDK_KEY and ZOOM_SDK_SECRET from environment
   *   2. Create a message: sdkKey + meetingNumber + timestamp + role
   *   3. HMAC-SHA256 sign with the SDK secret
   *   4. Base64 encode: sdkKey.meetingNumber.timestamp.role.hash
   *   5. Return the signature + sdkKey for the frontend
   *
   * Reference: https://developers.zoom.us/docs/meeting-sdk/web/auth/
   */
  generateSignature(
    meetingNumber: string,
    role: number,
  ): { signature: string; sdkKey: string } {
    const sdkKey = this.configService.get<string>('ZOOM_SDK_KEY');
    const sdkSecret = this.configService.get<string>('ZOOM_SDK_SECRET');

    if (!sdkKey || !sdkSecret) {
      throw new Error(
        'ZOOM_SDK_KEY and ZOOM_SDK_SECRET must be set in environment variables',
      );
    }

    const timestamp = new Date().getTime() - 30000;
    const message = `${sdkKey}${meetingNumber}${timestamp}${role}`;
    const hash = crypto
      .createHmac('sha256', sdkSecret)
      .update(message)
      .digest('base64');

    const signature = Buffer.from(
      `${sdkKey}.${meetingNumber}.${timestamp}.${role}.${hash}`,
    ).toString('base64');

    return { signature, sdkKey };
  }

  // ──────────────────────────────────────────────────────────────
  //  verifyWebhookSignature
  // ──────────────────────────────────────────────────────────────

  /**
   * Verify that a webhook notification actually came from Zoom.
   *
   * Never process a Zoom webhook without verifying its signature first.
   * Malicious actors could fake attendance or trigger recording uploads.
   *
   * Steps:
   *   1. Extract timestamp and compare with current time (replay protection)
   *   2. Compute HMAC-SHA256 of `v0:${timestamp}:${rawBody}`
   *   3. Compare computed signature with the one in the header
   *   4. Throw if they don't match
   */
  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    timestamp: string,
  ): void {
    const webhookSecret = this.configService.get<string>('ZOOM_WEBHOOK_SECRET');

    if (!webhookSecret) {
      throw new Error('ZOOM_WEBHOOK_SECRET must be set in environment variables');
    }

    // Replay protection: reject events older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(timestamp, 10);
    if (Math.abs(now - eventTime) > 300) {
      throw new BadRequestException('Webhook expired');
    }

    // Compute expected signature
    const message = `v0:${timestamp}:${rawBody}`;
    const expectedSignature =
      'v0=' +
      crypto.createHmac('sha256', webhookSecret).update(message).digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (expectedSignature.length !== signature.length) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const valid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature),
    );

    if (!valid) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  validateWebhookChallenge(plainToken: string) {
    const secret = this.configService.get<string>('ZOOM_WEBHOOK_SECRET');
    if (!secret) {
      console.error('CRITICAL: ZOOM_WEBHOOK_SECRET is missing from environment variables');
      throw new InternalServerErrorException('Webhook secret missing');
    }

    const hash = crypto
      .createHmac('sha256', secret)
      .update(plainToken)
      .digest('hex');

    return {
      plainToken: plainToken,
      encryptedToken: hash,
    };
  }
}
