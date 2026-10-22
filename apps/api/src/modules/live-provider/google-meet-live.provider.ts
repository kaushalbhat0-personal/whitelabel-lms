/*
 * GoogleMeetLiveProvider — LiveProvider implemented via Google Calendar + Meet.
 *
 * Why this class exists:
 *   - Second concrete LiveProvider (after Zoom). Same interface, same
 *     LiveSessionsService orchestration, same provider-neutral persistence
 *     (provider/provider_session_id/provider_join_url/provider_start_url).
 *   - Creation primitive is a Google Calendar event with a Meet conference
 *     (conferenceDataVersion=1, hangoutsMeet): the LMS already schedules by
 *     start_time + duration_minutes, and Calendar is the natural scheduling
 *     model — a bare Meet space has no schedule/time at all. One resource to
 *     create, one id to store, one resource to delete.
 *   - Auth is Pattern A (Workspace service account + domain-wide delegation,
 *     see google-auth.ts). No refresh tokens, no token persistence, no
 *     central account — the client's own Cloud project + organizer account.
 *
 * Boundaries (do NOT cross):
 *   - No Drive scopes, no recording/transcript APIs (Phase 2 / GMEET-07).
 *   - No per-student Google invites: attendees are never added to the event,
 *     so Google never emails students. The LMS join-token gate stays the
 *     access-control layer; students never receive Google credentials.
 *   - Meet has no Zoom-style per-registrant URL and no separate host URL:
 *     registerAttendee returns the shared meeting URL; startUrl == joinUrl
 *     (the organizer joins the same link signed in as themselves).
 *   - Never log tokens/keys/JSON; never return credentials to callers.
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
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { DEFAULT_TIMEZONE } from '../../common/config/defaults';
import { TABLES } from '../../common/constants/tables.constant';
import { SupabaseService } from '../../common/services/supabase.service';
import type {
  LiveProvider,
  CreateLiveWebinarDto,
  LiveWebinarResult,
} from './live-provider.types';
import {
  GOOGLE_CALENDAR_SCOPE,
  ServiceAccountAuth,
  validateGoogleMeetConfig,
  type GoogleAuthProvider,
  type GoogleMeetEnv,
  type ValidatedGoogleMeetConfig,
} from './google-auth';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const POLL_ATTEMPTS = 5;
const POLL_DELAY_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal structural config source (ConfigService satisfies this). */
export function googleMeetEnvFrom(config: {
  get<T = string>(key: string): T | undefined;
}): GoogleMeetEnv {
  return {
    serviceAccountJson: config.get<string>('GOOGLE_MEET_SERVICE_ACCOUNT_JSON'),
    organizerEmail: config.get<string>('GOOGLE_MEET_ORGANIZER_EMAIL'),
    calendarId: config.get<string>('GOOGLE_MEET_CALENDAR_ID'),
  };
}

@Injectable()
export class GoogleMeetLiveProvider implements LiveProvider {
  readonly name = 'google-meet';
  private readonly logger = new Logger(GoogleMeetLiveProvider.name);
  /** In-memory meeting-URL cache (session ids → join URL). Never credentials. */
  private readonly joinUrlCache = new Map<string, string>();
  private validatedConfig: ValidatedGoogleMeetConfig | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly supabaseService?: SupabaseService | null,
  ) {}

  /** Validated deployment config (memoized). Startup validation in the module
   *  factory guarantees this succeeds when LIVE_PROVIDER=google-meet; the
   *  runtime wrap is defense-in-depth with a provider-neutral 503. */
  private requireConfig(): ValidatedGoogleMeetConfig {
    if (!this.validatedConfig) {
      try {
        this.validatedConfig = validateGoogleMeetConfig(
          googleMeetEnvFrom(this.configService),
        );
      } catch (e) {
        throw new ServiceUnavailableException(
          'Google Meet is not configured for this deployment.',
        );
      }
    }
    return this.validatedConfig;
  }

  private createAuth(cfg: ValidatedGoogleMeetConfig): GoogleAuthProvider {
    return new ServiceAccountAuth(cfg.serviceAccount, cfg.organizerEmail);
  }

  /**
   * Deployment timezone for scheduling: persisted BusinessConfig (authoritative)
   * → caller hint (today always DEFAULT_TIMEZONE) → centralized default.
   * Never a new literal; never hard-coded Asia/Kolkata here.
   */
  private async resolveTimezone(hint?: string): Promise<string> {
    try {
      const client = this.supabaseService?.client as any;
      if (!client) throw new Error('no supabase');
      const { data, error } = await client
        .from(TABLES.BUSINESS_CONFIG)
        .select('timezone')
        .limit(1)
        .single();
      if (!error && data && typeof data.timezone === 'string' && data.timezone !== '') {
        return data.timezone;
      }
    } catch {
      // Fall through to hint/default — scheduling still works, display zone
      // may differ until BusinessConfig is seeded.
    }
    return hint && hint !== '' ? hint : DEFAULT_TIMEZONE;
  }

  private async calendarRequest(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string,
    body?: Record<string, unknown>,
    action = 'calendar request',
  ): Promise<any> {
    try {
      const { data } = await axios.request({
        method,
        url: `${CALENDAR_API_BASE}${path}`,
        data: body,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      const status = error.response?.status;
      const googleMessage =
        error.response?.data?.error?.message || error.message || 'Unknown Google error';
      // Server-side detail only — outward messages below are provider-neutral.
      this.logger.error(`Google Calendar API error [${action}]: ${status} ${googleMessage}`);

      if (status === 401) {
        throw new UnauthorizedException('Live session provider authentication failed.');
      }
      if (status === 403) {
        throw new ForbiddenException('Live session provider refused the request.');
      }
      if (status === 404) {
        throw new NotFoundException('Live session not found in the provider.');
      }
      if (status === 429) {
        throw new HttpException('Live session provider rate limit reached.', 429);
      }
      if (status && status >= 500) {
        throw new ServiceUnavailableException('Live session provider is temporarily unavailable.');
      }
      throw new InternalServerErrorException(`Unable to complete live session request.`);
    }
  }

  private extractJoinUrl(event: any): string | null {
    if (!event || typeof event !== 'object') return null;
    if (typeof event.hangoutLink === 'string' && event.hangoutLink !== '') {
      return event.hangoutLink;
    }
    const entryPoints = event.conferenceData?.entryPoints;
    if (Array.isArray(entryPoints)) {
      const video = entryPoints.find(
        (e: any) => e?.entryPointType === 'video' && typeof e?.uri === 'string' && e.uri !== '',
      );
      if (video) return video.uri as string;
    }
    return null;
  }

  async createWebinar(dto: CreateLiveWebinarDto): Promise<LiveWebinarResult> {
    const cfg = this.requireConfig();
    const timezone = await this.resolveTimezone(dto.timezone);

    const start = new Date(dto.startTime);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid session start time.');
    }
    if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes <= 0) {
      throw new BadRequestException('Invalid session duration.');
    }
    const end = new Date(start.getTime() + dto.durationMinutes * 60_000);

    let token: string;
    try {
      token = await this.createAuth(cfg).getAccessToken([GOOGLE_CALENDAR_SCOPE]);
    } catch (e) {
      this.logger.error(`GoogleMeet auth failed on create: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Unable to create live session.');
    }

    const calendarId = encodeURIComponent(cfg.calendarId);
    let event: any;
    try {
      event = await this.calendarRequest(
        'POST',
        `/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=none`,
        token,
        {
          summary: dto.topic,
          ...(dto.agenda ? { description: dto.agenda } : {}),
          start: { dateTime: start.toISOString(), timeZone: timezone },
          end: { dateTime: end.toISOString(), timeZone: timezone },
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        },
        'events.insert',
      );
    } catch (e) {
      // calendarRequest already mapped to a provider-neutral exception.
      throw e;
    }

    const eventId = typeof event?.id === 'string' ? event.id : null;
    if (!eventId) {
      throw new InternalServerErrorException('Unable to create live session.');
    }

    // Conference generation is async: poll until the Meet URL materializes.
    let joinUrl = this.extractJoinUrl(event);
    for (let attempt = 0; !joinUrl && attempt < POLL_ATTEMPTS; attempt++) {
      await delay(POLL_DELAY_MS);
      try {
        const fresh = await this.calendarRequest(
          'GET',
          `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
          token,
          undefined,
          'events.get (conference poll)',
        );
        joinUrl = this.extractJoinUrl(fresh);
      } catch (e) {
        throw e;
      }
    }

    if (!joinUrl) {
      // Avoid orphaning a URL-less event on the organizer's calendar.
      try {
        await this.calendarRequest(
          'DELETE',
          `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
          token,
          undefined,
          'events.delete (orphan cleanup)',
        );
      } catch {
        // Best-effort: operator can remove the event manually.
      }
      throw new InternalServerErrorException('Unable to create live session.');
    }

    this.joinUrlCache.set(eventId, joinUrl);
    // Meet has no separate host URL — organizer joins the same link.
    return { webinarId: eventId, joinUrl, startUrl: joinUrl };
  }

  async deleteWebinar(webinarId: string): Promise<void> {
    const cfg = this.requireConfig();
    let token: string;
    try {
      token = await this.createAuth(cfg).getAccessToken([GOOGLE_CALENDAR_SCOPE]);
    } catch (e) {
      this.logger.error(`GoogleMeet auth failed on delete: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Unable to delete live session.');
    }
    const calendarId = encodeURIComponent(cfg.calendarId);
    await this.calendarRequest(
      'DELETE',
      `/calendars/${calendarId}/events/${encodeURIComponent(webinarId)}?sendUpdates=none`,
      token,
      undefined,
      'events.delete',
    );
    this.joinUrlCache.delete(webinarId);
    this.logger.log(`Google Meet session ${webinarId} deleted`);
  }

  async registerAttendee(
    webinarId: string,
    _user: { name: string; email: string },
  ): Promise<string> {
    // Meet has no per-registrant URL model: every entitled student joins via
    // the shared meeting URL behind the LMS join-token gate (attendees are
    // deliberately never added to the Calendar event, so Google never emails
    // students and no Google-side access list is needed).
    const cached = this.joinUrlCache.get(webinarId);
    if (cached) return cached;

    const cfg = this.requireConfig();
    let token: string;
    try {
      token = await this.createAuth(cfg).getAccessToken([GOOGLE_CALENDAR_SCOPE]);
    } catch (e) {
      this.logger.error(`GoogleMeet auth failed on register: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Unable to register attendee.');
    }
    const calendarId = encodeURIComponent(cfg.calendarId);
    const event = await this.calendarRequest(
      'GET',
      `/calendars/${calendarId}/events/${encodeURIComponent(webinarId)}`,
      token,
      undefined,
      'events.get (register)',
    );
    const joinUrl = this.extractJoinUrl(event);
    if (!joinUrl) {
      throw new NotFoundException('Live session join link is not available.');
    }
    this.joinUrlCache.set(webinarId, joinUrl);
    return joinUrl;
  }
}
