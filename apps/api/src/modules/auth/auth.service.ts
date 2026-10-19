/*
 * Auth service — handles login, logout, session validation, and forced logout
 *
 * Why this service exists:
 *   - All authentication business logic lives here, NOT in the controller.
 *   - Single-device enforcement (one user = one active session) is implemented here
 *     via Redis key management.
 *   - Rate limiting prevents brute-force password guessing.
 *
 * A junior should know:
 *   - Never log passwords or tokens — security risk.
 *   - The `forceLogoutUser` method is exported so UsersModule can call it when
 *     suspending an account.
 *   - Every method is async — Redis and Supabase calls are non-blocking.
 */
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { LoginDto } from './dto/login.dto';
import { SupabaseService } from '../../common/services/supabase.service';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';
import { resolveSessionPolicy, SessionPolicy } from '../../common/constants/session-policy.constant';
import { TABLES } from '../../common/constants/tables.constant';
import { DeviceService } from '../devices/device.service';
import { EmailService } from '../email/email.service';
import { PlaybackGuardService } from '../playback/playback-guard.service';
import { ObservabilityService } from '../observability/observability.service';

/** Maximum failed login attempts before rate-lock kicks in */
const MAX_LOGIN_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly deviceService: DeviceService,
    private readonly emailService: EmailService,
    private readonly playbackGuard: PlaybackGuardService,
    private readonly observabilityService: ObservabilityService,
    redisService: RedisService,
  ) {
    this.redis = redisService.getOrThrow();
    // Fail fast at startup on an invalid SESSION_POLICY. Unset → 'single'.
    this.sessionPolicy = resolveSessionPolicy(
      configService.get<string>('SESSION_POLICY'),
    );
  }

  private readonly redis: Redis;
  private readonly sessionPolicy: SessionPolicy;

  // ────────────────────────────────────────────────────────────────
  //  login
  // ────────────────────────────────────────────────────────────────

  /**
   * Authenticate a user with email + password.
   *
   * Steps:
   *   1. Check Redis rate-limit for this IP address
   *   2. Verify credentials against Supabase Auth
   *   3. Fetch user profile from the `users` table
   *   4. Reject if the account is suspended
   *   5. Invalidate any existing session (single-device enforcement)
   *   6. Generate a new session ID and sign a JWT
   *   7. Store the session in Redis
   *   8. Store the user → session mapping in Redis
   *   9. Clear the rate-limit counter on success
   *  10. Return token + user info
   */
  async login(dto: LoginDto, ip: string, userAgent: string) {
    // ── Step 1: Rate limit check ──────────────────────────────
    // Count failed attempts for this IP; block at 5 within 15 minutes
    const rateLimitKey = REDIS_KEYS.loginRateLimit(ip);
    const attempts = await this.redis.get(rateLimitKey);
    const attemptCount = attempts ? parseInt(attempts, 10) : 0;

    if (attemptCount >= MAX_LOGIN_ATTEMPTS) {
      this.logger.warn(`Rate-limit hit for IP ${ip}`);
      throw new ForbiddenException(
        'Too many login attempts. Please wait 15 minutes.',
      );
    }

    // ── Step 2: Verify credentials with Supabase Auth ─────────
    // Use the anon-key client — auth.signInWithPassword() requires the
    // public anon key, not the service-role key.
    const { data: authData, error: authError } =
      await this.supabaseService.authClient.auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      });

    if (authError || !authData.user) {
      // Increment the failed-attempt counter (will create key if it doesn't exist)
      await this.redis.incr(rateLimitKey);
      await this.redis.expire(rateLimitKey, REDIS_TTL.RATE_LIMIT);

      this.logger.warn(`Failed login attempt for ${dto.email} from IP ${ip}`);
      await this.observabilityService.logEvent({
        eventType: 'LOGIN_FAILED',
        source: 'auth',
        severity: 'warning',
        message: `Failed login attempt for ${dto.email} from IP ${ip}`,
        metadata: { email: dto.email, ip },
      }).catch(() => {});
      throw new UnauthorizedException('Invalid email or password');
    }

    const userId = authData.user.id;

    // ── Step 3: Fetch user profile from the database ──────────
    // Use the service-role client to bypass RLS — the profile may not
    // be visible to the user's own anon-key JWT at this point.
    const { data: profile, error: profileError } = await this.supabaseService
      .client
      .from(TABLES.PROFILES)
      .select('id, name, email, role, is_active, must_change_password')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      this.logger.error(`User ${userId} authenticated but no profile found`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // ── Step 4: Check if account is active ────────────────────
    if (!profile.is_active) {
      this.logger.warn(`Suspended user ${userId} attempted login`);
      throw new ForbiddenException(
        'Your account has been suspended. Contact admin.',
      );
    }

    // ── Step 5: Single-session enforcement (graceful) ─────────────
    // SESSION_POLICY=single only. Under 'multi' this block is skipped
    // entirely: concurrent logins each receive an independent session.
    // If the user already has a session somewhere, revoke it and
    // require the current login to be retried. This prevents two
    // active devices and gives the user a clear message instead of
    // a raw client-side exception.
    if (this.sessionPolicy === 'single') {
      const existingSessionId = await this.redis.get(
        REDIS_KEYS.userSession(userId),
      );
      if (existingSessionId) {
        await this.redis.del(REDIS_KEYS.session(existingSessionId));
        await this.redis.del(REDIS_KEYS.userSession(userId));
        this.logger.log(
          `Invalidated old session ${existingSessionId} for user ${userId} — session replacement, requiring re-login`,
        );
        // Do NOT create a new session yet. Tell the client to show
        // the graceful session-replaced message and retry.
        // Wording is intentionally neutral — the existing user_session may be
        // stale (browser closed, network drop, cookie cleared) rather than
        // proof of a second physical device.
        throw new ConflictException({
          code: 'SESSION_REPLACED',
          message:
            'An active session was found for this account. For security, the previous session has been signed out. Please log in again.',
        });
      }
    }

    // ── Step 6: Generate new session and sign JWT ─────────────
    const sessionId = crypto.randomUUID();
    const token = await this.jwtService.signAsync({
      sub: userId,
      sessionId,
      role: profile.role,
    });

    // ── Step 7: Store session metadata in Redis ───────────────
    await this.redis.setex(
      REDIS_KEYS.session(sessionId),
      REDIS_TTL.SESSION,
      JSON.stringify({
        userId,
        role: profile.role,
        ip,
        userAgent,
        createdAt: Date.now(),
      }),
    );

    // ── Step 8: Store user → session mapping in Redis ─────────
    await this.redis.setex(
      REDIS_KEYS.userSession(userId),
      REDIS_TTL.SESSION,
      sessionId,
    );

    // ── Step 8b: Track the session in the per-user session set ───
    // Maintained in BOTH modes so revoke-all (suspend/deactivate/delete)
    // is correct regardless of policy. Set membership alone never proves
    // validity — session:{sessionId} is authoritative. Stale member IDs
    // (expired keys) are tolerated and cleaned on logout/revoke.
    await this.redis.sadd(REDIS_KEYS.userSessions(userId), sessionId);
    await this.redis.expire(REDIS_KEYS.userSessions(userId), REDIS_TTL.SESSION);

    // ── Step 9: Clear rate-limit on success ───────────────────
    await this.redis.del(rateLimitKey);

    // ── Step 10: Device registration (fire-and-forget-ish) ────
    // Register the device fingerprint for security audit logging.
    // Login alert table entries are visible in Admin → Security → Device Activity.
    // Email alerts have been removed per business decision.
    if (dto.device) {
      const { device, isNew } = await this.deviceService.registerDevice(
        userId,
        ip,
        userAgent,
        dto.device,
      );

      if (isNew && device) {
        this.logger.log(`New device detected for user ${userId}: ${dto.device.browser} on ${dto.device.os}`);

        await this.supabaseService.client
          .from(TABLES.LOGIN_ALERTS)
          .insert({
            user_id: userId,
            device_id: device.id,
            alert_type: 'new_device',
            ip_address: ip,
            user_agent: userAgent,
            details: { browser: dto.device.browser, os: dto.device.os },
            is_suspicious: true,
          });
      }
    }

    // ── Step 11: Log login event and return token + user info ──
    await this.observabilityService.logEvent({
      eventType: 'LOGIN_SUCCESS',
      source: 'auth',
      severity: 'info',
      message: `User ${profile.email} logged in as ${profile.role}`,
      metadata: { userId: profile.id, role: profile.role },
    }).catch(() => {});

    return {
      token,
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        mustChangePassword: profile.must_change_password ?? false,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  logout
  // ────────────────────────────────────────────────────────────────

  /**
   * End the current session.
   *
   * SESSION_POLICY=single: removes the session metadata key and the
   *   single-session pointer (existing behavior, unchanged).
   * SESSION_POLICY=multi: removes ONLY the current session metadata key
   *   and its set membership — other concurrent sessions are untouched.
   * Both modes are idempotent.
   */
  async logout(userId: string, sessionId: string) {
    if (this.sessionPolicy === 'single') {
      await Promise.all([
        this.redis.del(REDIS_KEYS.session(sessionId)),
        this.redis.del(REDIS_KEYS.userSession(userId)),
      ]);
    } else {
      await Promise.all([
        this.redis.del(REDIS_KEYS.session(sessionId)),
        this.redis.srem(REDIS_KEYS.userSessions(userId), sessionId),
      ]);
    }

    this.logger.log(`User ${userId} logged out (session ${sessionId})`);

    return { message: 'Logged out successfully' };
  }

  // ────────────────────────────────────────────────────────────────
  //  validateSession
  // ────────────────────────────────────────────────────────────────

  /**
   * Check whether a session is still valid (used by JwtAuthGuard).
   *
   * SESSION_POLICY=single: the session is valid iff the single-session
   *   pointer equals the token's sessionId (existing behavior, unchanged).
   * SESSION_POLICY=multi: the pointer is ignored; the per-session key
   *   session:{sessionId} is authoritative and must exist and belong to
   *   the token's user. Set membership alone never proves validity.
   */
  async validateSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    if (this.sessionPolicy === 'single') {
      const storedSessionId = await this.redis.get(
        REDIS_KEYS.userSession(userId),
      );

      if (!storedSessionId || storedSessionId !== sessionId) {
        return false;
      }

      // Refresh TTL on both keys — the user made a valid request
      await Promise.all([
        this.redis.expire(REDIS_KEYS.session(sessionId), REDIS_TTL.SESSION),
        this.redis.expire(REDIS_KEYS.userSession(userId), REDIS_TTL.SESSION),
      ]);

      return true;
    }

    const raw = await this.redis.get(REDIS_KEYS.session(sessionId));
    if (!raw) {
      return false;
    }

    let storedUserId: unknown;
    try {
      storedUserId = (JSON.parse(raw) as { userId?: unknown }).userId;
    } catch {
      return false;
    }

    if (storedUserId !== userId) {
      return false;
    }

    // Refresh TTL on the session key and the index — the user made a valid request
    await Promise.all([
      this.redis.expire(REDIS_KEYS.session(sessionId), REDIS_TTL.SESSION),
      this.redis.expire(REDIS_KEYS.userSessions(userId), REDIS_TTL.SESSION),
    ]);

    return true;
  }

  // ────────────────────────────────────────────────────────────────
  //  changePassword
  // ────────────────────────────────────────────────────────────────

  /**
   * Update a user's password in Supabase Auth and clear must_change_password flag.
   * Called from the /change-password page after first login with temp password.
   */
  async changePassword(
    userId: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const { error } = await this.supabaseService.client.auth.admin.updateUserById(
      userId,
      { password: newPassword },
    );

    if (error) {
      throw new BadRequestException(`Failed to update password: ${error.message}`);
    }

    await this.supabaseService.client
      .from(TABLES.PROFILES)
      .update({ must_change_password: false })
      .eq('id', userId);

    return { message: 'Password updated successfully. Please log in again.' };
  }

  // ────────────────────────────────────────────────────────────────
  //  forgotPassword
  // ────────────────────────────────────────────────────────────────

  /**
   * Send a Supabase password reset email to the user.
   * Always returns 200 — never reveals if the email exists.
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );

    const { error } =
      await this.supabaseService.authClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${frontendUrl}/reset-password`,
      });

    if (error) {
      this.logger.warn(
        `Password reset requested for unknown/error email: ${email} — ${error.message}`,
      );
    }

    return {
      message:
        'If an account exists with this email, a password reset link has been sent.',
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  forceLogoutUser
  // ────────────────────────────────────────────────────────────────

  /**
   * Force-invalidate a user's session(s) (admin action).
   *
   * Use case: when an admin suspends a user, call this to kick them out immediately.
   * Revokes ALL sessions: the single-session pointer, every per-session key
   * listed in the user_sessions:{userId} set, and the set itself. Correct in
   * both policies because login maintains the set in both modes.
   */
  async forceLogoutUser(userId: string) {
    const [pointerSessionId, memberSessionIds] = await Promise.all([
      this.redis.get(REDIS_KEYS.userSession(userId)),
      this.redis.smembers(REDIS_KEYS.userSessions(userId)),
    ]);

    const sessionIds = new Set<string>();
    if (pointerSessionId) sessionIds.add(pointerSessionId);
    for (const id of memberSessionIds ?? []) {
      if (id) sessionIds.add(id);
    }

    const keys = [
      ...[...sessionIds].map((id) => REDIS_KEYS.session(id)),
      REDIS_KEYS.userSession(userId),
      REDIS_KEYS.userSessions(userId),
    ];

    await this.redis.del(...keys);

    this.logger.log(`User ${userId} force-logged out (admin action)`);
  }
}
