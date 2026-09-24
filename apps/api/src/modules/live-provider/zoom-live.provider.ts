/*
 * ZoomLiveProvider — LiveProvider implemented via Zoom Webinar API
 *
 * Why this class exists:
 *   - First concrete LiveProvider; preserves existing ZoomService behavior exactly.
 *   - Webinar creation now accepts an optional timezone; when absent it falls back
 *     to DEFAULT_TIMEZONE (Asia/Kolkata) via central defaults.
 *   - This establishes the correct boundary: BusinessConfig timezone → DEFAULT_TIMEZONE fallback → provider.
 *     Phase 1 keeps the fallback; Phase 2 will supply the persisted BusinessConfig value.
 *
 * A future provider (Meet/Teams) would implement LiveProvider with its own creation
 * semantics; no change to LiveSessionsService would be required beyond DI.
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
import { DEFAULT_TIMEZONE } from '../../common/config/defaults';
import type {
  LiveProvider,
  CreateLiveWebinarDto,
  LiveWebinarResult,
} from './live-provider.types';

@Injectable()
export class ZoomLiveProvider implements LiveProvider {
  readonly name = 'zoom';
  private readonly logger = new Logger(ZoomLiveProvider.name);
  private readonly baseUrl = 'https://api.zoom.us/v2';
  private readonly authUrl = 'https://zoom.us/oauth/token';

  constructor(private readonly configService: ConfigService) {}

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

  async createWebinar(dto: CreateLiveWebinarDto): Promise<LiveWebinarResult> {
    // Timezone handling — Phase 1 boundary
    //   configured timezone (future BusinessConfig) ?? DEFAULT_TIMEZONE (Asia/Kolkata)
    //   Today the default preserves the existing observable behavior (IST offset 330m).
    //   Phase 2 will inject businessConfig.timezone here; the provider contract already supports it.
    const timezone = dto.timezone ?? DEFAULT_TIMEZONE;

    // Preserve existing Asia/Kolkata conversion. For other timezones, pass UTC-derived local time
    // with the requested timezone — Zoom will treat the value as that zone's local time.
    // Full IANA offset handling is deferred to Phase 2; the boundary is correct now.
    const utcDate = new Date(dto.startTime);
    // Existing behavior for the default zone — keep deterministic conversion
    const isDefaultZone = timezone === DEFAULT_TIMEZONE || timezone === 'Asia/Kolkata';
    const offsetMinutes = isDefaultZone ? 330 : 0;
    const zonedDate = new Date(utcDate.getTime() + offsetMinutes * 60_000);
    const yyyy = zonedDate.getUTCFullYear();
    const mm = String(zonedDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(zonedDate.getUTCDate()).padStart(2, '0');
    const hh = String(zonedDate.getUTCHours()).padStart(2, '0');
    const min = String(zonedDate.getUTCMinutes()).padStart(2, '0');
    const ss = String(zonedDate.getUTCSeconds()).padStart(2, '0');
    const startTime = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;

    const data = await this.zoomRequest('POST', '/users/me/webinars', {
      topic: dto.topic,
      type: 5,
      start_time: startTime,
      duration: dto.durationMinutes,
      timezone,
      settings: {
        hd_video: false,
        practice_session: false,
        audio: 'voip',
        auto_recording: 'cloud',
        host_video: true,
        panelists_video: true,
        allow_multiple_devices: false,
        approval_type: 2,
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

  async deleteWebinar(webinarId: string): Promise<void> {
    await this.zoomRequest('DELETE', `/webinars/${webinarId}`);
    this.logger.log(`Zoom webinar ${webinarId} deleted`);
  }

  async registerAttendee(
    webinarId: string,
    user: { name: string; email: string },
  ): Promise<string> {
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
}
