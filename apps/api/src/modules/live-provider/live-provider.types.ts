/*
 * LiveProvider contract — the seam between live-session domain and provider APIs
 *
 * Why this exists:
 *   - LiveSessionsService must not be permanently coupled to Zoom.
 *   - Future providers (Meet, Teams) should be pluggable without rewriting service logic.
 *   - Phase 1 exposes only the operations actually required today.
 *
 * Do NOT add hypothetical methods for providers that do not exist.
 */

export const LIVE_PROVIDER = Symbol('LIVE_PROVIDER');

export interface CreateLiveWebinarDto {
  topic: string;
  agenda?: string;
  /** ISO-8601 UTC string from the frontend */
  startTime: string;
  durationMinutes: number;
  /** IANA timezone for Zoom's UI; defaults to DEFAULT_TIMEZONE when not supplied */
  timezone?: string;
}

export interface LiveWebinarResult {
  webinarId: string;
  joinUrl: string;
  startUrl: string;
}

export interface LiveProvider {
  readonly name: string;
  createWebinar(dto: CreateLiveWebinarDto): Promise<LiveWebinarResult>;
  deleteWebinar(webinarId: string): Promise<void>;
  registerAttendee(
    webinarId: string,
    user: { name: string; email: string },
  ): Promise<string>;
}
