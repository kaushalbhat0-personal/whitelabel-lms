import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { SupabaseService } from '../../common/services/supabase.service';
import { RecordingProviderResolver } from '../video-provider/recording-provider.resolver';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';

const SEEK_THRESHOLD = 15;
const URL_GEN_THRESHOLD = 8;
const EVENT_THRESHOLD = 60;
const WINDOW_SECONDS = 60;

export interface PlaybackTarget {
  /**
   * Provider playback identifier (storage slot historically named
   * mux_playback_id; interpretation keyed by `provider`).
   */
  playbackId: string;
  /** Owning provider — null/undefined/'mux' = Mux (pre-migration rows). */
  provider?: string | null;
}

export interface PlaybackTokenPayload {
  userId: string;
  recordingId: string;
  deviceId: string | null;
  sessionId: string;
  authSessionId: string | null;
  ip: string;
}

@Injectable()
export class PlaybackGuardService {
  private readonly logger = new Logger(PlaybackGuardService.name);
  private readonly redis: Redis;

  constructor(
    redisService: RedisService,
    private readonly supabaseService: SupabaseService,
    private readonly providerResolver: RecordingProviderResolver,
  ) {
    this.redis = redisService.getOrThrow();
  }

  async authorize(
    userId: string,
    recordingId: string,
    authSessionId?: string | null,
    deviceId?: string,
    ip?: string,
  ): Promise<{ playbackToken: string; sessionId: string; expiresInSeconds: number }> {
    const sessionId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const payload: PlaybackTokenPayload = {
      userId,
      recordingId,
      deviceId: deviceId ?? null,
      sessionId,
      authSessionId: authSessionId ?? null,
      ip: ip ?? 'unknown',
    };

    await this.redis.setex(
      REDIS_KEYS.playbackToken(token),
      REDIS_TTL.PLAYBACK_TOKEN,
      JSON.stringify(payload),
    );

    return {
      playbackToken: token,
      sessionId,
      expiresInSeconds: REDIS_TTL.PLAYBACK_TOKEN,
    };
  }

  async getSignedUrl(
    token: string,
    target: PlaybackTarget,
    expectedUserId: string,
    expectedRecordingId: string,
    deviceId?: string,
    ip?: string,
  ): Promise<{ url: string; thumbnail: string; sessionId: string; expiresAt: string }> {
    const revoked = await this.redis.get(REDIS_KEYS.playbackRevoked(expectedUserId));
    if (revoked) {
      await this.logViolation(expectedUserId, expectedRecordingId, 'revoked_token_use', { reason: 'user_revoked' }, ip);
      throw new ForbiddenException('Playback has been revoked for your account.');
    }

    const raw = await this.redis.get(REDIS_KEYS.playbackToken(token));
    if (!raw) {
      await this.logViolation(expectedUserId, expectedRecordingId, 'revoked_token_use', { reason: 'token_expired_or_missing' }, ip);
      throw new UnauthorizedException('Playback token is invalid or expired.');
    }

    let payload: PlaybackTokenPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new UnauthorizedException('Invalid playback token.');
    }

    if (payload.userId !== expectedUserId) {
      await this.logViolation(expectedUserId, expectedRecordingId, 'unauthorized_access', { reason: 'userId_mismatch', tokenUserId: payload.userId }, ip);
      throw new ForbiddenException('Playback token does not match your account.');
    }

    if (payload.recordingId !== expectedRecordingId) {
      await this.logViolation(expectedUserId, expectedRecordingId, 'unauthorized_access', { reason: 'recordingId_mismatch', tokenRecordingId: payload.recordingId }, ip);
      throw new ForbiddenException('Playback token does not match this recording.');
    }

    if (deviceId && payload.deviceId && payload.deviceId !== deviceId) {
      await this.logViolation(expectedUserId, expectedRecordingId, 'device_mismatch', { tokenDeviceId: payload.deviceId, requestDeviceId: deviceId }, ip);
      throw new ForbiddenException('Playback token is bound to a different device.');
    }

    // ── Phase 28.2 session-bound playback enforcement ─────────────────────
    // Legacy tokens without authSessionId are allowed until natural 600s expiry (safe rollout).
    // All newly minted tokens contain authSessionId; mismatched or missing user_session is rejected.
    if (payload.authSessionId !== null && payload.authSessionId !== undefined) {
      const currentAuthSession = await this.redis.get(REDIS_KEYS.userSession(expectedUserId));
      if (!currentAuthSession) {
        await this.logViolation(expectedUserId, expectedRecordingId, 'session_replaced_token_use', { reason: 'no_active_session', tokenAuthSessionId: payload.authSessionId }, ip);
        throw new UnauthorizedException('Session expired or signed in on another device');
      }
      if (payload.authSessionId !== currentAuthSession) {
        await this.logViolation(expectedUserId, expectedRecordingId, 'session_replaced_token_use', { reason: 'authSessionId_mismatch', tokenAuthSessionId: payload.authSessionId, currentAuthSessionId: currentAuthSession }, ip);
        throw new UnauthorizedException('Session expired or signed in on another device');
      }
    }

    await this.redis.setex(
      REDIS_KEYS.playbackToken(token),
      REDIS_TTL.PLAYBACK_TOKEN,
      JSON.stringify(payload),
    );

    // Provider selection happens here — strictly BELOW the authorization
    // checks above. The provider only mints URLs; it never grants access.
    // A Bunny row whose provider is unavailable fails observably (503).
    const urls = await this.providerResolver
      .providerFor(target)
      .getPlaybackUrls(target.playbackId, { sessionId: payload.sessionId });

    await this.redis.setex(
      REDIS_KEYS.playbackSession(payload.sessionId),
      REDIS_TTL.PLAYBACK_SESSION,
      JSON.stringify({ userId: expectedUserId, recordingId: expectedRecordingId, ip, issuedAt: new Date().toISOString() }),
    );

    const urlCount = await this.redis.incr(REDIS_KEYS.playbackEventWindow(`${expectedUserId}:urls`, expectedRecordingId));
    if (urlCount === 1) {
      await this.redis.expire(REDIS_KEYS.playbackEventWindow(`${expectedUserId}:urls`, expectedRecordingId), WINDOW_SECONDS);
    }
    if (urlCount > URL_GEN_THRESHOLD) {
      await this.logViolation(expectedUserId, expectedRecordingId, 'excessive_url_generation', { count: urlCount, windowSeconds: WINDOW_SECONDS }, ip);
    }

    await Promise.all([
      this.supabaseService.client
        .from(TABLES.VIDEO_VIEWS)
        .insert({ video_id: expectedRecordingId, user_id: expectedUserId, viewed_at: new Date().toISOString(), ip_address: ip ?? null }),
      this.supabaseService.client
        .from(TABLES.VIDEO_ACCESS_LOGS)
        .insert({
          user_id: expectedUserId,
          recording_id: expectedRecordingId,
          session_id: payload.sessionId,
          ip_address: ip ?? null,
          url_expires_at: urls.expiresAt,
        }),
    ]).catch((err) => {
      this.logger.error(`Failed to log video access: ${err.message}`);
    });

    return { url: urls.url, thumbnail: urls.thumbnailUrl, sessionId: payload.sessionId, expiresAt: urls.expiresAt };
  }

  async revokeUserTokens(userId: string): Promise<void> {
    await this.redis.setex(REDIS_KEYS.playbackRevoked(userId), REDIS_TTL.PLAYBACK_REVOKED, JSON.stringify({ revokedAt: new Date().toISOString() }));
  }

  async reportEvent(
    userId: string,
    recordingId: string,
    eventType: string,
    positionSeconds?: number,
    playbackSessionId?: string,
    ip?: string,
  ): Promise<void> {
    await this.supabaseService.client
      .from(TABLES.PLAYBACK_EVENTS)
      .insert({
        user_id: userId,
        recording_id: recordingId,
        event_type: eventType,
        position_seconds: positionSeconds ?? null,
        playback_session_id: playbackSessionId ?? null,
        ip_address: ip ?? null,
      });

    if (eventType === 'seek') {
      const seekCount = await this.redis.incr(REDIS_KEYS.playbackEventWindow(userId, recordingId));
      if (seekCount === 1) {
        await this.redis.expire(REDIS_KEYS.playbackEventWindow(userId, recordingId), WINDOW_SECONDS);
      }
      if (seekCount > SEEK_THRESHOLD) {
        await this.logViolation(userId, recordingId, 'excessive_seeking', { count: seekCount, windowSeconds: WINDOW_SECONDS }, ip);
      }
    }

    const eventKey = `${userId}:events:${recordingId}`;
    const eventCount = await this.redis.incr(REDIS_KEYS.playbackEventWindow(`events`, eventKey));
    if (eventCount === 1) {
      await this.redis.expire(REDIS_KEYS.playbackEventWindow(`events`, eventKey), WINDOW_SECONDS);
    }
    if (eventCount > EVENT_THRESHOLD) {
      await this.logViolation(userId, recordingId, 'excessive_events', { count: eventCount, windowSeconds: WINDOW_SECONDS }, ip);
    }
  }

  async getViolations(userId?: string): Promise<any[]> {
    let query = this.supabaseService.client
      .from(TABLES.PLAYBACK_VIOLATIONS)
      .select('*, profiles!inner(id, name, email)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data } = await query;
    return data ?? [];
  }

  async getEvents(recordingId?: string, userId?: string): Promise<any[]> {
    let query = this.supabaseService.client
      .from(TABLES.PLAYBACK_EVENTS)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (recordingId) query = query.eq('recording_id', recordingId);
    if (userId) query = query.eq('user_id', userId);

    const { data } = await query;
    return data ?? [];
  }

  private async logViolation(
    userId: string,
    recordingId: string | null,
    violationType: string,
    details: Record<string, any>,
    ip?: string,
  ): Promise<void> {
    await this.supabaseService.client
      .from(TABLES.PLAYBACK_VIOLATIONS)
      .insert({
        user_id: userId,
        recording_id: recordingId,
        violation_type: violationType,
        details,
        ip_address: ip ?? null,
      });
  }
}
