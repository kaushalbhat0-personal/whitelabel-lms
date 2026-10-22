/*
 * DisabledLiveProvider — LiveProvider for recorded-only deployments.
 *
 * Why this class exists:
 *   - LIVE_PROVIDER=none (or the legacy ZOOM_ENABLED=disabled) means this
 *     deployment serves recorded content only. Live operations must reject
 *     with the existing intentional 503 posture instead of failing with a
 *     generic credential 500 deep inside a provider client.
 *   - Error wording is provider-neutral on purpose: it must not say "Zoom
 *     is disabled" when the deployment simply has no live provider.
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  LiveProvider,
  CreateLiveWebinarDto,
  LiveWebinarResult,
} from './live-provider.types';

@Injectable()
export class DisabledLiveProvider implements LiveProvider {
  readonly name = 'none';

  private disabled(): never {
    throw new ServiceUnavailableException(
      'Live classes are not enabled for this deployment.',
    );
  }

  async createWebinar(_dto: CreateLiveWebinarDto): Promise<LiveWebinarResult> {
    this.disabled();
  }

  async deleteWebinar(_webinarId: string): Promise<void> {
    this.disabled();
  }

  async registerAttendee(
    _webinarId: string,
    _user: { name: string; email: string },
  ): Promise<string> {
    this.disabled();
  }
}
