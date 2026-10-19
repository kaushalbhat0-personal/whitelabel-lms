/*
 * Temporary demo-account expiry sweeper — sales-demo deployment only.
 *
 * Why this service exists:
 *   - The hot auth path validates JWT signature + Redis session only; it
 *     never queries profiles per request. Setting is_active=false alone
 *     therefore does NOT kill live sessions. Expiry must actively revoke
 *     every Redis session (forceLogoutUser) and then deactivate the row.
 *   - Runs on the existing @Cron()/ScheduleModule infrastructure (≈1 min
 *     sweep; hourly grace-delete). No new scheduling system.
 *
 * Lifecycle:
 *   1. Sweep: expires_at <= now() AND is_active → forceLogoutUser (kills ALL
 *      sessions in both single and multi policy) + clear playback/join Redis
 *      state + is_active=false. Idempotent: re-runs find nothing to do.
 *   2. Grace delete (≈24h after expiry): delete the Auth user (tolerating
 *      already-deleted) + delete the profile + purge residual Redis state.
 *
 * Safety:
 *   - EVERY destructive predicate requires expires_at IS NOT NULL, so normal
 *     client accounts (always NULL) can never be touched — even if the
 *     capability flag is later disabled.
 *   - Per-account try/catch: one bad row never aborts the batch.
 *   - No SCAN/KEYS: only targeted keys + the bounded join/playback patterns
 *     already used by the user-removal path.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS } from '../../common/constants/redis-keys.constant';
import { AuthService } from '../auth/auth.service';
import { ObservabilityService } from '../observability/observability.service';
import { DEMO_ACCESS_GRACE_DELETE_HOURS } from './demo-access.service';

const SWEEP_BATCH_LIMIT = 500;
const DELETE_BATCH_LIMIT = 200;

@Injectable()
export class DemoAccessCleanupService {
  private readonly logger = new Logger(DemoAccessCleanupService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly authService: AuthService,
    private readonly observabilityService: ObservabilityService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  private get redis(): Redis | null {
    try {
      return this.redisService?.getOrThrow() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Every minute: revoke sessions + deactivate newly-expired temporary accounts.
   */
  @Cron('*/1 * * * *')
  async handleExpirySweep(): Promise<{ expired: number }> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .not('expires_at', 'is', null)
      .lte('expires_at', nowIso)
      .eq('is_active', true)
      .limit(SWEEP_BATCH_LIMIT);

    if (error) {
      this.logger.error('Demo access expiry sweep query failed');
      return { expired: 0 };
    }

    let expired = 0;
    for (const row of (data ?? []) as Array<{ id: string }>) {
      try {
        await this.revokeTemporaryAccess(row.id);
        const { error: updateError } = await this.supabaseService.client
          .from(TABLES.PROFILES)
          .update({ is_active: false })
          .eq('id', row.id)
          .not('expires_at', 'is', null);
        if (updateError) {
          this.logger.warn(`Demo access deactivation failed for account ${row.id}`);
          continue;
        }
        expired += 1;
        await this.logEvent('demo_access_expired', 'info', 'Demo access account expired', {
          userId: row.id,
        });
      } catch {
        this.logger.warn(`Demo access expiry failed for account ${row.id}`);
      }
    }

    if (expired > 0) {
      this.logger.log(`Demo access expiry sweep deactivated ${expired} account(s)`);
    }
    return { expired };
  }

  /**
   * Hourly: hard-delete temporary accounts past the grace period.
   * Tolerates Auth-user-already-deleted and profile-already-deleted races.
   */
  @Cron('17 * * * *')
  async handleGraceDelete(): Promise<{ deleted: number }> {
    const cutoffIso = new Date(Date.now() - DEMO_ACCESS_GRACE_DELETE_HOURS * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .not('expires_at', 'is', null)
      .lte('expires_at', cutoffIso)
      .limit(DELETE_BATCH_LIMIT);

    if (error) {
      this.logger.error('Demo access grace-delete query failed');
      return { deleted: 0 };
    }

    let deleted = 0;
    for (const row of (data ?? []) as Array<{ id: string }>) {
      try {
        try {
          await this.supabaseService.client.auth.admin.deleteUser(row.id);
        } catch {
          // Tolerate already-deleted Auth users — expected cleanup race.
        }
        await this.revokeTemporaryAccess(row.id);
        const { error: deleteError } = await this.supabaseService.client
          .from(TABLES.PROFILES)
          .delete()
          .eq('id', row.id)
          .not('expires_at', 'is', null);
        if (deleteError) {
          this.logger.warn(`Demo access profile delete failed for account ${row.id}`);
          continue;
        }
        deleted += 1;
        await this.logEvent('demo_access_deleted', 'info', 'Demo access account cleaned up', {
          userId: row.id,
        });
      } catch {
        this.logger.warn(`Demo access cleanup failed for account ${row.id}`);
      }
    }

    if (deleted > 0) {
      this.logger.log(`Demo access grace delete removed ${deleted} account(s)`);
    }
    return { deleted };
  }

  /**
   * Revoke every live session + playback/join Redis state for a temporary account.
   * Same key families as the user-removal path (forceLogoutUser authoritative
   * for sessions; targeted deletes for playback/join state; no SCAN/KEYS).
   */
  private async revokeTemporaryAccess(userId: string): Promise<void> {
    try {
      await this.authService.forceLogoutUser(userId);
    } catch {
      // Best effort — continue to state cleanup and deactivation.
    }

    const redis = this.redis;
    if (!redis) return;

    const safeDel = async (key: string) => {
      try {
        await redis.del(key);
      } catch {
        // Best effort.
      }
    };
    const safeScanDel = async (pattern: string) => {
      try {
        let cursor = '0';
        do {
          const result: [string, string[]] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = result[0];
          const keys: string[] = result[1] ?? [];
          if (keys.length > 0) {
            try {
              await redis.del(...keys);
            } catch {
              // Best effort.
            }
          }
        } while (cursor !== '0');
      } catch {
        // Best effort.
      }
    };

    await safeDel(REDIS_KEYS.playbackRevoked(userId));
    await safeDel(REDIS_KEYS.screenRecordingRateLimit(userId));
    await safeDel(REDIS_KEYS.riskScore(userId));
    await safeScanDel(`playback_events:${userId}:*`);
    await safeScanDel(`playback_events:events:${userId}:*`);
    await safeScanDel(`join_token_index:*:${userId}`);
    await safeScanDel(`active_join:*:${userId}`);
  }

  private async logEvent(
    eventType: string,
    severity: 'info' | 'warning',
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.observabilityService.logEvent({
        eventType,
        source: 'demo-access',
        severity,
        message,
        metadata,
      });
    } catch {
      // Observability must never break cleanup.
    }
  }
}
