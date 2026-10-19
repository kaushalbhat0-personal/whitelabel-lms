/*
 * JWT authentication guard — the gatekeeper for every protected route
 *
 * Why this guard exists:
 *   - Applied globally in app.module.ts via APP_GUARD so every route is protected by default.
 *   - Validates the JWT from the Authorization header, checks Redis for session validity,
 *     and refreshes the session TTL on each request (sliding expiry).
 *
 * Steps this guard performs:
 *   1. Check if the route has @Public() → skip everything if true
 *   2. Extract Bearer token from the Authorization header
 *   3. Verify the JWT signature and decode the payload using JwtService
 *   4. SESSION_POLICY=single: look up the single session in Redis (key:
 *      user_session:{userId}) and require equality with token sessionId.
 *      SESSION_POLICY=multi: the per-session key session:{sessionId} is
 *      authoritative — it must exist and belong to the token's user.
 *   5. If Redis session doesn't validate → reject (logged out elsewhere)
 *   6. Attach user info (id, role, sessionId) to request.user
 *   7. Refresh Redis TTL to implement sliding session expiry
 *
 * A junior should know:
 *   - Don't add @UseGuards(JwtAuthGuard) — it's already global.
 *   - Add @Public() to routes that don't need auth (login, webhooks).
 *   - After this guard runs, you can use @CurrentUser() in your controller.
 */
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REDIS_KEYS, REDIS_TTL } from '../constants/redis-keys.constant';
import { resolveSessionPolicy, SessionPolicy } from '../constants/session-policy.constant';
import { ObservabilityService } from '../../modules/observability/observability.service';

@Injectable()
export class JwtAuthGuard {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly sessionPolicy: SessionPolicy;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly observabilityService: ObservabilityService,
    configService: ConfigService,
  ) {
    // Fail fast at startup on an invalid SESSION_POLICY. Unset → 'single'.
    this.sessionPolicy = resolveSessionPolicy(
      configService.get<string>('SESSION_POLICY'),
    );
  }

  private logSessionExpired(request: Request, message: string, userId?: string) {
    try {
      this.observabilityService
        .logEvent({
          eventType: 'SESSION_EXPIRED',
          source: 'auth',
          severity: 'info',
          message,
          metadata: {
            url: (request as any).url ?? request.url,
            method: request.method,
            statusCode: 401,
            errorType: 'UnauthorizedException',
            userAgent: request.headers['user-agent'],
            ip: (request as any).ip ?? (request as any).headers?.['x-forwarded-for'],
            userId,
          },
        })
        .catch(() => {});
    } catch {}
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ── Step 1: Skip auth for @Public() routes ──────────────────────────
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // ── Step 2: Extract Bearer token ────────────────────────────────────
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logSessionExpired(request, 'Missing or malformed Authorization header');
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = authHeader.split(' ')[1];

    // ── Step 3: Verify JWT ──────────────────────────────────────────────
    let payload: { sub: string; role: string; sessionId: string };
    try {
      payload = await this.jwtService.verifyAsync<{
        sub: string;
        role: string;
        sessionId: string;
      }>(token);
    } catch {
      this.logSessionExpired(request, 'Invalid or expired token');
      throw new UnauthorizedException('Invalid or expired token');
    }

    // ── Step 4: Check Redis for active session ──────────────────────────
    const redis = this.redisService.getOrThrow();

    if (this.sessionPolicy === 'single') {
      const storedSessionId = await redis.get(
        REDIS_KEYS.userSession(payload.sub),
      );

      if (!storedSessionId) {
        this.logSessionExpired(request, 'Session expired — please log in again', payload.sub);
        throw new UnauthorizedException('Session expired — please log in again');
      }

      if (storedSessionId !== payload.sessionId) {
        this.logSessionExpired(request, 'Session expired or signed in on another device', payload.sub);
        throw new UnauthorizedException(
          'Session expired or signed in on another device',
        );
      }

      // ── Step 6: Attach user to request ──────────────────────────────────
      (request as any).user = {
        id: payload.sub,
        role: payload.role,
        sessionId: payload.sessionId,
      };

      // ── Step 7: Refresh Redis TTL (sliding expiry) ──────────────────────
      await redis.expire(
        REDIS_KEYS.userSession(payload.sub),
        REDIS_TTL.SESSION,
      );

      return true;
    }

    // Multi-session mode: the per-session key is authoritative. The single
    // pointer is ignored so concurrent sessions for the same user coexist.
    const raw = await redis.get(REDIS_KEYS.session(payload.sessionId));
    if (!raw) {
      this.logSessionExpired(request, 'Session expired — please log in again', payload.sub);
      throw new UnauthorizedException('Session expired — please log in again');
    }

    let storedUserId: unknown;
    try {
      storedUserId = (JSON.parse(raw) as { userId?: unknown }).userId;
    } catch {
      this.logSessionExpired(request, 'Session expired — please log in again', payload.sub);
      throw new UnauthorizedException('Session expired — please log in again');
    }

    if (storedUserId !== payload.sub) {
      this.logSessionExpired(request, 'Session expired or signed in on another device', payload.sub);
      throw new UnauthorizedException(
        'Session expired or signed in on another device',
      );
    }

    // ── Step 6: Attach user to request ──────────────────────────────────
    (request as any).user = {
      id: payload.sub,
      role: payload.role,
      sessionId: payload.sessionId,
    };

    // ── Step 7: Refresh Redis TTL (sliding expiry) ──────────────────────
    // The per-session key is authoritative in multi mode; the index is
    // refreshed alongside so it does not expire while sessions are live.
    await Promise.all([
      redis.expire(REDIS_KEYS.session(payload.sessionId), REDIS_TTL.SESSION),
      redis.expire(REDIS_KEYS.userSessions(payload.sub), REDIS_TTL.SESSION),
    ]);

    return true;
  }
}
