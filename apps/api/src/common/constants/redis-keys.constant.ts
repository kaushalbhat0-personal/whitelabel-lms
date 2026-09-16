/*
 * All Redis key patterns in one place — change keys here, everything updates
 *
 * Why this file exists:
 *   - Prevents scattered string concatenation across services.
 *   - Every key follows a predictable `namespace:identifier` pattern for Redis CLI debugging.
 *
 * A junior should know:
 *   - Call a function like `REDIS_KEYS.userSession(userId)` to get the full key string.
 *   - TTL values are in seconds (Redis convention).
 */
export const REDIS_KEYS = {
  /** Stores the active session for a logged-in user → used to force-logout on multi-device */
  userSession: (userId: string) => `user_session:${userId}`,
  /** Caches live-session metadata so we don't hit Supabase on every Zoom webhook */
  session: (sessionId: string) => `session:${sessionId}`,
  /** Rate-limit key per IP address for the login endpoint */
  loginRateLimit: (ip: string) => `ratelimit:login:${ip}`,
  /** Tracks active playback sessions for video access audit */
  playbackSession: (sessionId: string) => `playback_session:${sessionId}`,
  /** Single-use join token bound to userId + sessionId */
  joinToken: (token: string) => `join_token:${token}`,
  /** Index: current outstanding token for a user+session → avoids SCAN */
  joinTokenIndex: (sessionId: string, userId: string) => `join_token_index:${sessionId}:${userId}`,
  /** Active join session for duplicate detection */
  activeJoin: (sessionId: string, userId: string) => `active_join:${sessionId}:${userId}`,
  /** Playback authorization token bound to userId + recordingId + deviceId */
  playbackToken: (token: string) => `playback_token:${token}`,
  /** Revocation marker — checked before every playback URL generation */
  playbackRevoked: (userId: string) => `playback_revoked:${userId}`,
  /** Sliding window event counter for suspicious detection */
  playbackEventWindow: (userId: string, recordingId: string) => `playback_events:${userId}:${recordingId}`,
  /** Auto-save checkpoint for test attempts */
  attemptCheckpoint: (attemptId: string) => `attempt_checkpoint:${attemptId}`,
  /** Active attempt timer tracking */
  attemptTimer: (attemptId: string) => `attempt_timer:${attemptId}`,
  /** Rate-limiter for screen recording violation reports (per user) */
  screenRecordingRateLimit: (userId: string) => `screen_recording_rate:${userId}`,
  /** Per-user risk score cache */
  riskScore: (userId: string) => `risk_score:${userId}`,
} as const;

export const REDIS_TTL = {
  /** 24 hours in seconds — matches JWT expiry */
  SESSION: 60 * 60 * 24,
  /** 15 minutes in seconds — lockout window for login attempts */
  RATE_LIMIT: 60 * 15,
  /** 2 minutes — playback session key TTL (double the 60s URL expiry for safety margin) */
  PLAYBACK_SESSION: 120,
  /** 15 minutes — join token lifetime before it auto-expires */
  JOIN_TOKEN: 60 * 15,
  /** 6 hours — active join marker TTL (longer than any real session) */
  ACTIVE_JOIN: 60 * 60 * 6,
  /** 10 minutes — playback token lifetime, refreshed on each URL request */
  PLAYBACK_TOKEN: 60 * 10,
  /** 24 hours — revocation marker lifetime */
  PLAYBACK_REVOKED: 60 * 60 * 24,
  /** 30 seconds — throttle between screen recording violation reports */
  SCREEN_RECORDING_RATE: 30,
  /** 5 minutes — cached risk score TTL */
  RISK_SCORE_CACHE: 60 * 5,
  /** 24 hours — attempt checkpoint (auto-save) TTL */
  ATTEMPT_CHECKPOINT: 60 * 60 * 24,
  /** 3 hours — attempt timer key TTL (max test duration) */
  ATTEMPT_TIMER: 60 * 60 * 3,
} as const;
