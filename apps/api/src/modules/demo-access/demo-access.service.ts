/*
 * Temporary demo-account issuance — sales-demo deployment only.
 *
 * Why this service exists:
 *   - Replaces manually-shared permanent demo credentials with per-prospect
 *     temporary student accounts that expire automatically (≈30 minutes).
 *   - The ONLY writer of profiles with expires_at set. Client deployments
 *     never expose the endpoint (TEMP_DEMO_ACCESS defaults to disabled and
 *     the controller answers 404), so permanent accounts are untouched.
 *
 * Security contract (enforced here, not in the controller):
 *   - Role is hardcoded to STUDENT — the request cannot supply it.
 *   - No email is ever sent (no welcome / reset / notification path).
 *   - The password is CSPRNG, returned once over HTTPS, never logged,
 *     never persisted in plaintext, never placed in URLs/storage.
 *   - Issuance is atomic from the prospect's view: profile-insert failure
 *     rolls back the Auth user; response-preparation failure still leaves
 *     a safely temporary account (expires_at guarantees sweeper cleanup).
 *   - Rate limits count SUCCESSFUL creations only; a failed attempt
 *     releases its reserved slot so failures cannot burn quota — while the
 *     reserve-before-create order still bounds concurrent bursts.
 *   - On TEMP_DEMO_ACCESS=enabled deployments this service promises a
 *     POPULATED demo: every issued account is enrolled in the showcase batch
 *     (DEMO_SHOWCASE_BATCH_ID, deployment-scoped, demo-only). If the showcase
 *     batch is missing/invalid or enrollment fails, issuance fails closed —
 *     the partial identity is rolled back and a neutral 503 is returned.
 *     Empty accounts are never issued on purpose.
 *
 * A junior should know:
 *   - Never add password/token/credentials to logger or observability calls.
 *   - Supabase errors may echo the email; log static messages only.
 *   - Never log or return the showcase batch ID — it is deployment config,
 *     not client-facing data.
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { UserRole } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';
import { ObservabilityService } from '../observability/observability.service';

/** Temporary account lifetime in minutes (server-side, authoritative). */
export const DEMO_ACCESS_TTL_MINUTES = 30;
/** Successful issuances allowed per IP per hour. */
export const DEMO_ACCESS_MAX_PER_IP_PER_HOUR = 3;
/** Successful issuances allowed globally per UTC day. */
export const DEMO_ACCESS_MAX_GLOBAL_PER_DAY = 500;
/** Grace period before an expired temporary account is hard-deleted. */
export const DEMO_ACCESS_GRACE_DELETE_HOURS = 24;
/**
 * Deployment-scoped showcase batch for populated temporary demo accounts.
 * Demo Render deployment sets this manually to an existing populated batch.
 * Never committed, never emitted by the factory, never in migrations.
 * Client deployments leave it unset (TEMP_DEMO_ACCESS gate keeps them out).
 */
export const DEMO_SHOWCASE_BATCH_ENV = 'DEMO_SHOWCASE_BATCH_ID';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict UUID check so a typo'd env value fails closed instead of issuing empty accounts. */
export function isValidShowcaseBatchId(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw.trim());
}

export interface DemoAccessCredentials {
  loginUrl: string;
  username: string;
  password: string;
  expiresAt: string;
}

@Injectable()
export class DemoAccessService {
  private readonly logger = new Logger(DemoAccessService.name);
  private readonly redis: Redis;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    redisService: RedisService,
    private readonly observabilityService: ObservabilityService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  /**
   * Issue one independent temporary student account.
   *
   * Concurrent calls never share state: identity and password are freshly
   * generated per call, and the Redis slot reservation (atomic INCR) bounds
   * bursts before any expensive Supabase Auth work happens.
   */
  async issue(ip: string): Promise<DemoAccessCredentials> {
    const reserved = await this.reserveSlot(ip);
    if (!reserved) {
      await this.logEvent('demo_access_rate_limited', 'warning', 'Demo access issuance rate-limited', { ip });
      // Neutral: reveal nothing about quotas, accounts, or internals.
      throw new ServiceUnavailableException(
        'Demo access is temporarily unavailable. Please try again later.',
      );
    }

    await this.logEvent('demo_access_requested', 'info', 'Demo access requested', { ip });

    const password = this.generatePassword();
    const expiresAt = new Date(Date.now() + DEMO_ACCESS_TTL_MINUTES * 60 * 1000);

    let created: { userId: string; email: string } | null = null;
    try {
      created = await this.createAuthUser(password);
      await this.insertProfile(created.userId, created.email, expiresAt);
      // Populated-demo promise: the account is useless without content, so a
      // showcase failure rolls back everything instead of issuing an empty LMS.
      await this.attachToShowcaseBatch(created.userId);
    } catch {
      // Failed attempts must not consume quota — release the reserved slot.
      await this.releaseSlot(ip);
      if (created) {
        await this.rollbackProvisioning(created.userId);
      }
      // Static message only: Supabase errors may echo identifiers and must
      // never reach logs, responses, or telemetry unsanitized.
      this.logger.error('Demo access issuance failed');
      await this.logEvent('demo_access_creation_failed', 'warning', 'Demo access issuance failed', { ip });
      throw new ServiceUnavailableException(
        'Demo access is temporarily unavailable. Please try again later.',
      );
    }

    const frontendUrl = (this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');

    await this.logEvent('demo_access_created', 'info', 'Demo access account created', {
      ip,
      userId: created.userId,
      expiresAt: expiresAt.toISOString(),
    });

    // The ONLY exposure of the plaintext password: this HTTPS response body.
    // Nothing here is persisted, logged, or tokenized.
    return {
      loginUrl: `${frontendUrl}/login`,
      username: created.email,
      password,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ── Slot reservation (counts successful creations) ────────────

  private dayStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async reserveSlot(ip: string): Promise<boolean> {
    const ipKey = REDIS_KEYS.demoAccessIp(ip);
    const globalKey = REDIS_KEYS.demoAccessGlobal(this.dayStamp());

    const ipCount = await this.redis.incr(ipKey);
    if (ipCount === 1) {
      await this.redis.expire(ipKey, REDIS_TTL.DEMO_ACCESS_IP_WINDOW);
    }
    if (ipCount > DEMO_ACCESS_MAX_PER_IP_PER_HOUR) {
      await this.redis.decr(ipKey);
      return false;
    }

    const globalCount = await this.redis.incr(globalKey);
    if (globalCount === 1) {
      await this.redis.expire(globalKey, REDIS_TTL.DEMO_ACCESS_GLOBAL_WINDOW);
    }
    if (globalCount > DEMO_ACCESS_MAX_GLOBAL_PER_DAY) {
      await this.redis.decr(globalKey);
      await this.redis.decr(ipKey);
      return false;
    }

    return true;
  }

  private async releaseSlot(ip: string): Promise<void> {
    try {
      await this.redis.decr(REDIS_KEYS.demoAccessIp(ip));
      await this.redis.decr(REDIS_KEYS.demoAccessGlobal(this.dayStamp()));
    } catch {
      // Best effort: a leaked slot only under-issues (safe direction).
    }
  }

  // ── Account creation ──────────────────────────────────────────

  /**
   * Unpredictable, non-PII, non-routable login identifier.
   * `.invalid` (RFC 2606) can never receive email — verified against the
   * real Supabase Auth implementation in live verification (09E), never
   * assumed. 16 hex chars from a CSPRNG make collisions infeasible; the
   * create path still retries once on a duplicate-identity error.
   */
  private generateIdentity(): string {
    return `demo-${crypto.randomBytes(8).toString('hex')}@demo.invalid`;
  }

  /**
   * 32-char CSPRNG password (base64url: A–Z a–z 0–9 - _).
   * Never logged, never persisted, never embedded in errors.
   */
  private generatePassword(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private async createAuthUser(password: string): Promise<{ userId: string; email: string }> {
    const attempt = (email: string) =>
      this.supabaseService.client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    const email = this.generateIdentity();
    let result = await attempt(email);
    if (result.error && /already|duplicate|exists/i.test(result.error.message)) {
      // Astronomically unlikely identity collision — retry once with a fresh identity.
      const retryEmail = this.generateIdentity();
      result = await attempt(retryEmail);
      if (result.error || !result.data?.user) throw new Error('auth-create-failed');
      return { userId: result.data.user.id, email: retryEmail };
    }
    if (result.error || !result.data?.user) throw new Error('auth-create-failed');
    return { userId: result.data.user.id, email };
  }

  private async insertProfile(userId: string, email: string, expiresAt: Date): Promise<void> {
    const { error } = await this.supabaseService.client.from(TABLES.PROFILES).insert({
      id: userId,
      name: 'Demo Guest',
      email,
      phone: null,
      role: UserRole.STUDENT,
      zoom_user_id: null,
      is_active: true,
      must_change_password: false,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      // Roll back the orphan Auth user so no permanent account remains.
      await this.deleteAuthUserBestEffort(userId);
      throw new Error('profile-insert-failed');
    }
  }

  private async deleteAuthUserBestEffort(userId: string): Promise<void> {
    try {
      await this.supabaseService.client.auth.admin.deleteUser(userId);
    } catch {
      // Tolerate already-deleted / missing users — expected cleanup race.
    }
  }

  /**
   * Enroll the temporary student in the deployment's showcase batch.
   *
   * Uses the existing batch_students junction with an idempotent upsert on
   * the (batch_id, user_id) primary key — the same relationship and pattern
   * as canonical enrollment. Read-only for shared content: this adds one
   * junction row, never touches batches/courses/recordings/videos/tests.
   *
   * Fails closed: missing/invalid config, unknown batch, or upsert error all
   * throw so issue() rolls back instead of handing out an empty demo.
   * The batch ID never leaves this service (no logs, no telemetry, no errors).
   */
  private async attachToShowcaseBatch(userId: string): Promise<void> {
    const raw = this.configService.get<string>(DEMO_SHOWCASE_BATCH_ENV);
    if (!isValidShowcaseBatchId(raw)) {
      throw new Error('showcase-batch-unavailable');
    }
    const batchId = raw.trim();

    const { data: batch, error: batchError } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id')
      .eq('id', batchId)
      .maybeSingle();

    if (batchError || !batch) {
      throw new Error('showcase-batch-unavailable');
    }

    const { error: enrollError } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .upsert({ batch_id: batchId, user_id: userId }, { onConflict: 'batch_id,user_id' });

    if (enrollError) {
      throw new Error('showcase-enroll-failed');
    }
  }

  /**
   * Best-effort rollback of a failed provisioning attempt: remove the
   * junction row (if the upsert landed), the temporary profile, and the
   * Auth user. Scoped to the new userId only — shared batch/content and
   * other students are untouched. The expiry sweeper remains the final
   * safety net if any step here fails.
   */
  private async rollbackProvisioning(userId: string): Promise<void> {
    try {
      await this.supabaseService.client.from(TABLES.BATCH_STUDENTS).delete().eq('user_id', userId);
    } catch {
      // Best effort — sweeper/grace-delete covers leftovers.
    }
    try {
      await this.supabaseService.client
        .from(TABLES.PROFILES)
        .delete()
        .eq('id', userId)
        .not('expires_at', 'is', null);
    } catch {
      // Best effort — sweeper/grace-delete covers leftovers.
    }
    await this.deleteAuthUserBestEffort(userId);
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
      // Observability must never break issuance.
    }
  }
}
