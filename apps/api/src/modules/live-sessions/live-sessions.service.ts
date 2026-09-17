/*
 * Live Sessions service — orchestrates Zoom webinar creation and student registration
 *
 * Why this service exists:
 *   - All session business logic lives here, NOT in the controller.
 *   - Coordinates: create Zoom webinar → register all students with unique URLs →
 *     store everything in the database.
 *   - This is the main orchestration method. It coordinates Zoom API + database in
 *     one transaction-like flow.
 *
 * A junior should know:
 *   - The `create` method does a LOT — it calls Zoom API, inserts multiple DB rows,
 *     and registers each student individually.
 *   - Students get their personal join URL from getStudentJoinUrl() — they never see
 *     any other student's URL (this enables attendance tracking).
 *   - getForStudent() returns upcoming and past sessions separately for the dashboard.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionStatus } from '@lms/shared-types';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { SupabaseService } from '../../common/services/supabase.service';
import { BatchesService } from '../batches/batches.service';
import { ZoomService } from '../zoom/zoom.service';
import { ObservabilityService } from '../observability/observability.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';
import { Transaction } from '../../common/utils/transaction.util';
import { logEntityEvent } from '../../common/utils/observability-helper';
import { CreateSessionDto } from './dto/create-session.dto';

type JoinOutcome =
  | 'granted'
  | 'rejected_expired'
  | 'rejected_reused'
  | 'rejected_not_live'
  | 'rejected_not_enrolled'
  | 'rejected_duplicate';

@Injectable()
export class LiveSessionsService {
  private readonly logger = new Logger(LiveSessionsService.name);
  private readonly redis: Redis | null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly batchesService: BatchesService,
    private readonly zoomService: ZoomService,
    private readonly observabilityService: ObservabilityService,
    private readonly configService: ConfigService,
    redisService: RedisService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) {
    try {
      this.redis = redisService.getOrThrow();
    } catch {
      this.logger.warn('Redis unavailable — join token features will degrade gracefully');
      this.redis = null;
    }
  }

  private async safeRedis<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.redis) return fallback;
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Redis operation failed: ${(err as Error).message}`);
      return fallback;
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  create
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a new live session — this is the main orchestration method.
   *
   * Steps:
   *   1. Resolve the host (explicit host or default) with a zoom_user_id
   *   2. Verify all batchIds exist
   *   3. Create the Zoom webinar via ZoomService
   *   4. Insert the session into TABLES.LIVE_SESSIONS
   *   5. Insert batch associations into TABLES.SESSION_BATCHES
   *   6. Fetch all students from all assigned batches (deduplicated)
   *   7. Register each student as a Zoom webinar attendee
   *   8. Save each student's unique join URL to TABLES.SESSION_REGISTRANTS
   *   9. Return the created session with counts
   */
  async create(dto: CreateSessionDto) {
    // ── Step 1: Resolve host (explicit host → default → reject) ─
    const hostUserId = await this.resolveHost(dto.teacherId);

    // ── Step 2: Verify all batchIds exist ──────────────────────
    for (const batchId of dto.batchIds) {
      await this.batchesService.findById(batchId);
    }

    // ── Step 3: Create Zoom webinar ────────────────────────────
    const webinar = await this.zoomService.createWebinar({
      topic: dto.topic,
      agenda: dto.agenda,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
    });

    // ── Step 4: Insert session into database ───────────────────
    const { data: session, error: sessionError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .insert({
        zoom_webinar_id: webinar.webinarId,
        zoom_webinar_join_url: webinar.joinUrl,
        topic: dto.topic,
        agenda: dto.agenda ?? null,
        start_time: dto.startTime,
        duration_minutes: dto.durationMinutes,
        teacher_id: hostUserId,
        status: 'scheduled',
      })
      .select()
      .single();

    if (sessionError) {
      this.logger.error(`Failed to create session: ${sessionError.message}`);
      try {
        await this.zoomService.deleteWebinar(webinar.webinarId);
      } catch (e) {
        this.logger.warn(`Failed to clean up orphan webinar ${webinar.webinarId}: ${(e as Error).message}`);
      }
      throw new BadRequestException('Failed to create session');
    }

    const sessionId = session.id;

    // ── Step 5: Prepare batch associations ─────────────────────
    const batchRecords = dto.batchIds.map((batchId) => ({
      session_id: sessionId,
      batch_id: batchId,
    }));

    // ── Step 6: Fetch all students from assigned batches ───────
    // Use allSettled so one batch failure doesn't crash the entire operation
    const studentResults = await Promise.allSettled(
      dto.batchIds.map((batchId) =>
        this.supabaseService.client
          .from(TABLES.BATCH_STUDENTS)
          .select('user_id, profiles!inner(id, name, email)')
          .eq('batch_id', batchId),
      ),
    );

    // Flatten and deduplicate by user_id
    const studentMap = new Map<string, { id: string; name: string; email: string }>();
    const batchFailures: string[] = [];
    for (let i = 0; i < studentResults.length; i++) {
      const result = studentResults[i];
      if (result.status === 'fulfilled' && result.value.data) {
        for (const item of result.value.data as any[]) {
          const user = item.profiles;
          if (!studentMap.has(user.id)) {
            studentMap.set(user.id, user);
          }
        }
      } else if (result.status === 'rejected') {
        batchFailures.push(dto.batchIds[i]);
        this.logger.warn(`Failed to fetch students for batch ${dto.batchIds[i]}: ${result.reason?.message || 'unknown'}`);
      }
    }

    const students = Array.from(studentMap.values());
    let registrantCount = 0;

    // ── Step 7: Register each student with Zoom ────────────────
    const registrantRecords: any[] = [];
    for (const student of students) {
      try {
        const joinUrl = await this.zoomService.registerAttendee(
          webinar.webinarId,
          { name: student.name, email: student.email },
        );

        registrantRecords.push({
          session_id: sessionId,
          user_id: student.id,
          personal_join_url: joinUrl,
          zoom_registrant_id: null,
        });
        registrantCount++;
      } catch (error: any) {
        this.logger.warn(
          `Failed to register student ${student.id} for session ${sessionId}: ${error.message}`,
        );
        // Continue registering the rest — a single failure shouldn't block everyone
      }
    }

    // ── Step 8: Insert batch links + registrants atomically ───
    // A failure in either insert rolls back the session (cascades to
    // session_batches + session_registrants) so no partial writes remain.
    const tx = new Transaction();
    await tx.run([
      {
        name: 'insert session batch links',
        execute: async () => {
          const { error: batchError } = await this.supabaseService.client
            .from(TABLES.SESSION_BATCHES)
            .insert(batchRecords);
          if (batchError) throw batchError;
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.LIVE_SESSIONS)
            .delete()
            .eq('id', sessionId);
        },
      },
      {
        name: 'insert registrant records',
        execute: async () => {
          if (registrantRecords.length > 0) {
            const { error: regError } = await this.supabaseService.client
              .from(TABLES.SESSION_REGISTRANTS)
              .insert(registrantRecords);
            if (regError) throw regError;
          }
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.LIVE_SESSIONS)
            .delete()
            .eq('id', sessionId);
        },
      },
    ]);

    await this.invalidateSessionsForBatchIds(dto.batchIds).catch(()=>{});
    if (this.redisCache) await this.redisCache.delByPattern('cache:sessions:*').catch(()=>{}).catch(()=>{});
    logEntityEvent(
      this.observabilityService,
      'LIVE_SESSION_CREATED',
      'live_session',
      sessionId,
      hostUserId,
      { topic: dto.topic, batchIds: dto.batchIds, startTime: dto.startTime },
    ).catch(() => {});

    return {
      ...session,
      totalStudents: students.length,
      registrantCount,
      batches: dto.batchIds,
      batchFailures: batchFailures.length > 0 ? batchFailures : undefined,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  findAll
  // ──────────────────────────────────────────────────────────────

  /**
   * List sessions with optional filters and pagination.
   *
   * Steps:
   *   1. Build query with optional batchId or status filter
   *   2. Apply range() for pagination, order by start_time desc
   *   3. Also fetch total count
   *   4. Return PaginatedResponse
   */
  async findAll(
    page = 1,
    limit = 20,
    batchId?: string,
    status?: string,
  ) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('*', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    // If filtering by batch, we need to join through SESSION_BATCHES
    if (batchId) {
      const { data: sessionIds } = await this.supabaseService.client
        .from(TABLES.SESSION_BATCHES)
        .select('session_id')
        .eq('batch_id', batchId);

      const ids = (sessionIds ?? []).map((s: any) => s.session_id);
      if (ids.length > 0) {
        query = query.in('id', ids);
      } else {
        // No sessions for this batch — return empty
        return { items: [], total: 0, page, limit };
      }
    }

    const { data, error, count } = await query
      .order('start_time', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch sessions: ${error.message}`);
      throw new BadRequestException('Could not retrieve sessions');
    }

    const items = data ?? [];
    // Enrich each item with batch names (needed by the admin compatibility layer).
    if (items.length > 0) {
      const ids = items.map((s: any) => s.id);
      const { data: batchLinks } = await this.supabaseService.client
        .from(TABLES.SESSION_BATCHES)
        .select('session_id, batches(name)')
        .in('session_id', ids);

      const batchNamesBySession = new Map<string, string[]>();
      for (const link of batchLinks ?? []) {
        const names = batchNamesBySession.get(link.session_id) ?? [];
        const batch = Array.isArray(link.batches) ? link.batches[0] : link.batches;
        if (batch?.name) names.push(batch.name);
        batchNamesBySession.set(link.session_id, names);
      }
      for (const item of items) {
        (item as any).batchNames = batchNamesBySession.get(item.id) ?? [];
      }
    }

    return {
      items,
      total: count ?? 0,
      page,
      limit,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  findById
  // ──────────────────────────────────────────────────────────────

  /**
   * Get a single session by ID, including its batch list and host teacher info.
   *
   * Steps:
   *   1. Fetch the session
   *   2. Fetch related batch IDs from SESSION_BATCHES
   *   3. Fetch the host teacher's name
   *   4. Return combined result
   */
  async findById(id: string, requester?: { id: string; role: string }) {
    // Fetch session
    const { data: session, error: sessionError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('*')
      .eq('id', id)
      .single();

    if (sessionError || !session) {
      throw new NotFoundException('Session not found');
    }

    // Fetch batch IDs
    const { data: batchLinks } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('batch_id')
      .eq('session_id', id);

    const batchIds = (batchLinks ?? []).map((b: any) => b.batch_id);

    // Student isolation: verify enrollment via batch_students ∩ session_batches
    if (requester?.role === 'student') {
      const { data: userBatches } = await this.supabaseService.client
        .from(TABLES.BATCH_STUDENTS)
        .select('batch_id')
        .eq('user_id', requester.id);
      const userBatchIds = new Set((userBatches ?? []).map((b: any) => b.batch_id));
      const hasAccess = batchIds.some((bid: string) => userBatchIds.has(bid));
      if (!hasAccess) {
        throw new NotFoundException('Session not found');
      }
    }

    // Fetch host teacher info
    const { data: teacher } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id, name, email')
      .eq('id', session.teacher_id)
      .single();

    return {
      ...session,
      batchIds,
      hostTeacher: teacher ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  getStudentJoinUrl  (single-use token gated)
  // ──────────────────────────────────────────────────────────────

  /**
   * Consume a single-use join token and return the Zoom join URL.
   *
   * Security model:
   *   - Token is stored in Redis (15min TTL).
   *   - Token is deleted on read (single-use).
   *   - Token is bound to userId + sessionId — verified on each call.
   *   - Previous tokens for this user+session are revoked on new request.
   *   - Every attempt is logged to join_attempts for audit.
   *
   * Steps:
   *   1. Validate the token exists in Redis
   *   2. Verify it matches the requesting user + session
   *   3. Delete from Redis (single-use consumption)
   *   4. Revoke any previous active join (duplicate prevention)
   *   5. Set new active join marker
   *   6. Mark token as used in DB
   *   7. Log join_attempt (granted)
   *   8. Return the Zoom join URL
   */
  private async redisGet(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try { return await this.redis.get(key); } catch { this.logger.warn(`Redis GET failed: ${key}`); return null; }
  }

  private async redisSetex(key: string, ttl: number, value: string): Promise<void> {
    if (!this.redis) return;
    try { await this.redis.setex(key, ttl, value); } catch { this.logger.warn(`Redis SETEX failed: ${key}`); }
  }

  private async redisDel(key: string): Promise<void> {
    if (!this.redis) return;
    try { await this.redis.del(key); } catch { this.logger.warn(`Redis DEL failed: ${key}`); }
  }

  private async redisScan(pattern: string): Promise<string[]> {
    if (!this.redis) return [];
    try {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');
      return keys;
    } catch { this.logger.warn(`Redis SCAN failed: ${pattern}`); return []; }
  }

  async getStudentJoinUrl(
    sessionId: string,
    userId: string,
    token: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ joinUrl: string; sessionId: string }> {
    // Step 1: Validate the token in Redis
    const tokenDataRaw = await this.redisGet(REDIS_KEYS.joinToken(token));
    if (!tokenDataRaw) {
      // Check if token was already used (DB lookup for audit)
      const { data: existingToken } = await this.supabaseService.client
        .from(TABLES.JOIN_TOKENS)
        .select('used_at, expires_at')
        .eq('token', token)
        .single();

      if (existingToken) {
        if (existingToken.used_at) {
          await this.logJoinAttempt(sessionId, userId, null, ip, userAgent, 'rejected_reused');
          throw new UnauthorizedException('This join link has already been used.');
        }
        await this.logJoinAttempt(sessionId, userId, null, ip, userAgent, 'rejected_expired');
        throw new UnauthorizedException('This join link has expired. Request a new one.');
      }

      await this.logJoinAttempt(sessionId, userId, null, ip, userAgent, 'rejected_expired');
      throw new UnauthorizedException('Invalid or expired join token.');
    }

    let parsed: { userId: string; sessionId: string; expiresAt: string };
    try {
      parsed = JSON.parse(tokenDataRaw);
    } catch {
      throw new UnauthorizedException('Invalid join token.');
    }

    // Step 2: Verify the token is bound to this user + session
    if (parsed.userId !== userId || parsed.sessionId !== sessionId) {
      await this.logJoinAttempt(sessionId, userId, null, ip, userAgent, 'rejected_expired');
      throw new UnauthorizedException('This join token is not valid for your account.');
    }

    // Step 3: Consume the token (delete from Redis — single use) + clear index if it points here
    await this.redisDel(REDIS_KEYS.joinToken(token));
    const idxVal = await this.redisGet(REDIS_KEYS.joinTokenIndex(sessionId, userId));
    if (idxVal === token) {
      await this.redisDel(REDIS_KEYS.joinTokenIndex(sessionId, userId));
    }

    // Step 4: Revoke any previous active join for this user + session
    await this.redisDel(REDIS_KEYS.activeJoin(sessionId, userId));

    // Step 5: Set new active join marker
    await this.redisSetex(
      REDIS_KEYS.activeJoin(sessionId, userId),
      REDIS_TTL.ACTIVE_JOIN,
      JSON.stringify({ joinedAt: new Date().toISOString(), ip }),
    );

    // Step 6: Mark token as used in DB
    await this.supabaseService.client
      .from(TABLES.JOIN_TOKENS)
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    // Step 7: Fetch the join URL — authoritative auth is batch_students∩session_batches (already validated in requestJoinToken).
    // session_registrants is Zoom compatibility (personal_join_url). We do NOT fail LMS join if registrant row is missing/null;
    // fallback to the webinar's generic join URL so entitled students are not blocked by Zoom registration drift.
    const { data: registrant } = await this.supabaseService.client
      .from(TABLES.SESSION_REGISTRANTS)
      .select('personal_join_url')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (registrant?.personal_join_url) {
      await this.logJoinAttempt(sessionId, userId, token, ip, userAgent, 'granted');
      return { joinUrl: registrant.personal_join_url, sessionId };
    }

    // Fallback: generic webinar join URL (still entitled via batch intersection)
    const { data: fallbackSession } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('zoom_webinar_join_url')
      .eq('id', sessionId)
      .single();

    if (fallbackSession?.zoom_webinar_join_url) {
      this.logger.warn(`getStudentJoinUrl fallback to generic join URL for ${userId} session ${sessionId} (no personal_join_url)`);
      await this.logJoinAttempt(sessionId, userId, token, ip, userAgent, 'granted');
      return { joinUrl: fallbackSession.zoom_webinar_join_url, sessionId };
    }

    await this.logJoinAttempt(sessionId, userId, null, ip, userAgent, 'rejected_not_enrolled');
    throw new NotFoundException(
      'You are not registered for this session. Contact your admin.',
    );
  }

  // ──────────────────────────────────────────────────────────────
  //  requestJoinToken
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate a single-use join token bound to a user + session.
   *
   * Steps:
   *   1. Validate the session exists and is joinable (live or within 15min window)
   *   2. Validate the student is enrolled
   *   3. Revoke any previous tokens for this user+session (Redis + DB)
   *   4. Generate new token (UUID)
   *   5. Store in Redis (15min TTL) + DB
   *   6. Return token + expiry
   */
  async requestJoinToken(
    sessionId: string,
    userId: string,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    // Step 1: Validate session exists and is joinable — use end_time (start + duration) not start alone
    const { data: session, error: sessionError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('id, status, start_time, duration_minutes, join_tokens_revoked_since')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new NotFoundException('Session not found.');
    }

    const start = new Date(session.start_time).getTime();
    const end = start + (session.duration_minutes ?? 60) * 60000;
    const now = Date.now();

    if (session.status === 'cancelled' || session.status === 'ended' || now > end) {
      throw new BadRequestException('This session is no longer joinable.');
    }

    const isLive = session.status === 'live' && now <= end;
    const isWithinWindow =
      session.status === 'scheduled' && now >= start - 15 * 60 * 1000 && now <= end;

    if (!isLive && !isWithinWindow) {
      throw new BadRequestException(
        'This session is not available to join. Wait until 15 minutes before start time.',
      );
    }

    // Step 2: Validate student is enrolled — authoritative model is batch_students ∩ session_batches
    // (session_registrants is a snapshot for personal_join_url, not the auth gate; this fixes phantom-session drift
    //  where getForStudent shows a session but requestJoinToken rejected due to missing registrant row)
    const { data: userBatches } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);
    const userBatchIds = new Set((userBatches ?? []).map((b: any) => b.batch_id));
    if (userBatchIds.size === 0) {
      throw new NotFoundException('You are not registered for this session. Contact your admin.');
    }
    const { data: sessionBatches } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('batch_id')
      .eq('session_id', sessionId)
      .in('batch_id', [...userBatchIds]);
    if (!sessionBatches || sessionBatches.length === 0) {
      throw new NotFoundException('You are not registered for this session. Contact your admin.');
    }

    // Ensure registrant row exists for personal_join_url (lazy backfill for post-creation enrollments)
    await this.ensureRegistrant(sessionId, userId);

    // Step 3: Revoke any previous token for this user+session via indexed lookup (no SCAN)
    const indexKey = REDIS_KEYS.joinTokenIndex(sessionId, userId);
    const previousToken = await this.redisGet(indexKey);
    if (previousToken) {
      await this.redisDel(REDIS_KEYS.joinToken(previousToken));
      await this.redisDel(indexKey);
    }

    // Also mark existing DB tokens as used (force-expire)
    await this.supabaseService.client
      .from(TABLES.JOIN_TOKENS)
      .update({ used_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('used_at', null);

    // Step 4: Generate new token
    const token = crypto.randomUUID();
    const expiresInSeconds = REDIS_TTL.JOIN_TOKEN;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Step 5: Store in Redis + index
    await this.redisSetex(
      REDIS_KEYS.joinToken(token),
      expiresInSeconds,
      JSON.stringify({ userId, sessionId, expiresAt }),
    );
    await this.redisSetex(indexKey, expiresInSeconds, token);

    // Also persist in DB for audit trail
    await this.supabaseService.client
      .from(TABLES.JOIN_TOKENS)
      .insert({
        session_id: sessionId,
        user_id: userId,
        token,
        expires_at: expiresAt,
      });

    return { token, expiresInSeconds };
  }

  // ──────────────────────────────────────────────────────────────
  //  leaveSession
  // ──────────────────────────────────────────────────────────────

  /**
    * Mark the user as having left the session.
    * Clears the active join marker in Redis.
    */
  async leaveSession(sessionId: string, userId: string): Promise<void> {
    await this.redisDel(REDIS_KEYS.activeJoin(sessionId, userId));
  }

  // ──────────────────────────────────────────────────────────────
  //  getJoinAudit  (admin)
  // ──────────────────────────────────────────────────────────────

  /**
    * Get the join audit trail for a session (admin only).
    * Shows all join attempts with user info.
    */
  async getJoinAudit(sessionId: string) {
    const { data: attempts } = await this.supabaseService.client
      .from(TABLES.JOIN_ATTEMPTS)
      .select(`
        *,
        profiles!inner(id, name, email)
      `)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(500);

    return { attempts: attempts ?? [] };
  }

  // ──────────────────────────────────────────────────────────────
  //  getActiveJoins  (admin)
  // ──────────────────────────────────────────────────────────────

  /**
    * Get currently active join sessions from Redis (admin only).
    * Used to detect link sharing (same user active from multiple IPs).
    */
  async getActiveJoins(sessionId: string): Promise<{ userId: string; ip: string; joinedAt: string }[]> {
    const active: { userId: string; ip: string; joinedAt: string }[] = [];
    if (!this.redis) return active;

    const keys = await this.redisScan(`active_join:${sessionId}:*`);
    for (const key of keys) {
      const raw = await this.redisGet(key);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          const userId = key.split(':').pop() || '';
          active.push({ userId, ip: data.ip || 'unknown', joinedAt: data.joinedAt || '' });
        } catch { /* skip */ }
      }
    }

    return active;
  }

  // ──────────────────────────────────────────────────────────────
  //  revokeAllTokens  (admin)
  // ──────────────────────────────────────────────────────────────

  /**
    * Revoke all outstanding join tokens for a session (admin only).
    * Sets join_tokens_revoked_since timestamp on the session.
    * All future token validation will fail.
    */
  async revokeAllTokens(sessionId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .update({ join_tokens_revoked_since: now })
      .eq('id', sessionId);

    // Mark all unused tokens as used
    await this.supabaseService.client
      .from(TABLES.JOIN_TOKENS)
      .update({ used_at: now })
      .eq('session_id', sessionId)
      .is('used_at', null);

    // Clear all active joins for this session from Redis
    const active = await this.getActiveJoins(sessionId);
    for (const a of active) {
      await this.redisDel(REDIS_KEYS.activeJoin(sessionId, a.userId));
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Private helpers
  // ──────────────────────────────────────────────────────────────

  /**
   * Resolve the session host user.
   *
   * Resolution order:
   *   1. Explicit host (dto.teacherId) — must exist and have a zoom_user_id.
   *   2. Configured default host (env LIVE_SESSION_DEFAULT_HOST_ID) — must have a zoom_user_id.
   *   3. First user with a zoom_user_id in the system.
   *   4. Reject with a clear validation error.
   *
   * This deliberately does NOT require role === 'teacher', so admins (or any
   * profile with a configured Zoom user) can host until a real teacher module
   * exists. No fake teacher rows are ever created.
   */
  private async resolveHost(explicitHostId?: string): Promise<string> {
    if (explicitHostId) {
      const { data: host, error } = await this.supabaseService.client
        .from(TABLES.PROFILES)
        .select('id, zoom_user_id')
        .eq('id', explicitHostId)
        .single();

      if (error || !host) {
        throw new BadRequestException('Selected host not found');
      }
      if (!host.zoom_user_id) {
        throw new BadRequestException(
          'Selected host does not have a Zoom user ID configured. Update their profile first.',
        );
      }
      return host.id;
    }

    const defaultHostId = this.configService.get<string>('LIVE_SESSION_DEFAULT_HOST_ID');
    if (defaultHostId) {
      const { data: defaultHost } = await this.supabaseService.client
        .from(TABLES.PROFILES)
        .select('id, zoom_user_id')
        .eq('id', defaultHostId)
        .single();

      if (defaultHost?.zoom_user_id) {
        return defaultHost.id;
      }
      this.logger.warn(
        `Configured default host ${defaultHostId} has no zoom_user_id — falling through to first available host`,
      );
    }

    const { data: firstHost } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id, zoom_user_id')
      .not('zoom_user_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (firstHost?.zoom_user_id) {
      return firstHost.id;
    }

    throw new BadRequestException(
      'No user with a Zoom user ID is configured. Set a Zoom user ID on a profile or configure LIVE_SESSION_DEFAULT_HOST_ID.',
    );
  }

  private async ensureRegistrant(sessionId: string, userId: string): Promise<void> {
    const { count } = await this.supabaseService.client
      .from(TABLES.SESSION_REGISTRANTS)
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('user_id', userId);
    if (count && count > 0) return;

    // Backfill: student is batch-enrolled but has no registrant (added after session creation)
    // Create a minimal registrant so getStudentJoinUrl can return a personal_join_url.
    // If Zoom webinar still exists, try to register; otherwise store without URL and let join still proceed via fallback.
    const { data: session } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('zoom_webinar_id')
      .eq('id', sessionId)
      .single();
    let personalJoinUrl: string | null = null;
    if (session?.zoom_webinar_id) {
      try {
        const { data: profile } = await this.supabaseService.client
          .from(TABLES.PROFILES)
          .select('name, email')
          .eq('id', userId)
          .single();
        if (profile?.email) {
          personalJoinUrl = await this.zoomService.registerAttendee(session.zoom_webinar_id, {
            name: profile.name ?? 'Student',
            email: profile.email,
          });
        }
      } catch (e) {
        this.logger.warn(`ensureRegistrant: Zoom register failed for ${userId} session ${sessionId}: ${(e as Error).message}`);
      }
    }
    try {
      await this.supabaseService.client.from(TABLES.SESSION_REGISTRANTS).insert({
        session_id: sessionId,
        user_id: userId,
        personal_join_url: personalJoinUrl,
        zoom_registrant_id: null,
      });
    } catch (e) {
      // Ignore unique violation race
      if ((e as any)?.code !== '23505') this.logger.warn(`ensureRegistrant insert failed: ${(e as Error).message}`);
    }
  }

  private async invalidateSessionsForBatchIds(batchIds: string[]): Promise<void> {
    if (!batchIds.length) return;
    try {
      const { data: rows } = await this.supabaseService.client.from(TABLES.BATCH_STUDENTS).select('user_id').in('batch_id', batchIds);
      const userIds = [...new Set((rows ?? []).map((r: any) => r.user_id))];
      if (userIds.length) if (this.redisCache) if (this.redisCache) await this.redisCache.invalidateSessionsCacheForUsers(userIds).catch(()=>{});
    } catch {}
  }

  private async invalidateSessionsForSessionId(sessionId: string): Promise<void> {
    try {
      const { data: links } = await this.supabaseService.client.from(TABLES.SESSION_BATCHES).select('batch_id').eq('session_id', sessionId);
      const batchIds = (links ?? []).map((l: any)=>l.batch_id);
      await this.invalidateSessionsForBatchIds(batchIds);
    } catch {}
  }

  private async logJoinAttempt(
    sessionId: string,
    userId: string,
    tokenId: string | null,
    ip: string | undefined,
    userAgent: string | undefined,
    outcome: JoinOutcome,
  ): Promise<void> {
    await this.supabaseService.client
      .from(TABLES.JOIN_ATTEMPTS)
      .insert({
        session_id: sessionId,
        user_id: userId,
        token_id: tokenId,
        ip_address: ip ?? null,
        user_agent: userAgent ?? null,
        outcome,
      });
  }

  // ──────────────────────────────────────────────────────────────
  //  getForStudent
  // ──────────────────────────────────────────────────────────────

  /**
   * Get all sessions relevant to a student, split into upcoming and past.
   *
   * Steps:
   *   1. Find all batches the student is enrolled in
   *   2. Find all sessions for those batches
   *   3. Separate into upcoming (scheduled/live) and past (ended)
   *   4. Include attendance status for past sessions
   *   5. Return the separated lists
   */
  async getForStudent(userId: string) {
    if (!this.redisCache) return this.fetchForStudent(userId);
    const cacheKey = this.redisCache.key('sessions', userId);
    return this.redisCache.wrap(cacheKey, 60, async () => {
      return this.fetchForStudent(userId);
    });
  }

  async getDashboardSessionsForStudent(userId: string) {
    if (!this.redisCache) return this.fetchDashboardSessions(userId);
    const cacheKey = this.redisCache.key('sessions', userId, 'dashboard');
    return this.redisCache.wrap(cacheKey, 60, async () => {
      return this.fetchDashboardSessions(userId);
    });
  }

  private async fetchDashboardSessions(userId: string) {
    const { data: batchMemberships } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);
    const batchIds = (batchMemberships ?? []).map((b: any) => b.batch_id);
    if (batchIds.length === 0) return { upcoming: [], past: [] };
    const { data: sessionLinks } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('session_id')
      .in('batch_id', batchIds);
    const sessionIds = [...new Set((sessionLinks ?? []).map((s: any) => s.session_id))];
    if (sessionIds.length === 0) return { upcoming: [], past: [] };
    const { data: sessions } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('id, topic, start_time, duration_minutes, status, created_at')
      .in('id', sessionIds)
      .order('start_time', { ascending: true });
    const nowMs = Date.now();
    const isEndedByTime = (s: any) => new Date(s.start_time).getTime() + (s.duration_minutes ?? 60) * 60000 <= nowMs;
    const upcoming = (sessions ?? []).filter((s: any) => (s.status === 'scheduled' || s.status === 'live') && !isEndedByTime(s)).slice(0, 5);
    // Past intentionally empty for dashboard to avoid attendance cost
    return { upcoming, past: [] };
  }

  private async fetchForStudent(userId: string) {
    // Get student's batches
    const { data: batchMemberships } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);

    const batchIds = (batchMemberships ?? []).map((b: any) => b.batch_id);

    if (batchIds.length === 0) {
      return { upcoming: [], past: [] };
    }

    // Get all session IDs for these batches
    const { data: sessionLinks } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('session_id')
      .in('batch_id', batchIds);

    const sessionIds = [
      ...new Set((sessionLinks ?? []).map((s: any) => s.session_id)),
    ];

    if (sessionIds.length === 0) {
      return { upcoming: [], past: [] };
    }

    // Fetch all sessions
    const { data: sessions } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('*')
      .in('id', sessionIds)
      .order('start_time', { ascending: false });

    // Split into upcoming and past — use end_time (start + duration) so a 60-min session at 16:40 remains upcoming until 17:40
    const nowMs = Date.now();
    const isEndedByTime = (s: any) =>
      new Date(s.start_time).getTime() + (s.duration_minutes ?? 60) * 60000 <= nowMs;
    const upcoming = (sessions ?? []).filter(
      (s: any) => (s.status === 'scheduled' || s.status === 'live') && !isEndedByTime(s),
    );
    const past = (sessions ?? []).filter(
      (s: any) => s.status === 'ended' || s.status === 'cancelled' || isEndedByTime(s),
    );

    // Include attendance status for past sessions
    if (past.length > 0) {
      const pastIds = past.map((s: any) => s.id);
      const { data: attendance } = await this.supabaseService.client
        .from(TABLES.ATTENDANCE)
        .select('session_id, status')
        .in('session_id', pastIds)
        .eq('user_id', userId);

      const attendanceMap = new Map(
        (attendance ?? []).map((a: any) => [a.session_id, a.status]),
      );

      for (const session of past) {
        (session as any).attendanceStatus =
          attendanceMap.get(session.id) || 'absent';
      }
    }

    return { upcoming, past };
  }

  // ──────────────────────────────────────────────────────────────
  //  updateStatus
  // ──────────────────────────────────────────────────────────────

  /**
   * Manually update the status of a session (admin-only).
   *
   * Steps:
   *   1. Update the status in the database
   *   2. Return the updated session
   */
  async updateStatus(id: string, status: SessionStatus) {
    const allowed: SessionStatus[] = [SessionStatus.SCHEDULED, SessionStatus.LIVE, SessionStatus.ENDED, SessionStatus.CANCELLED];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    // If cancelling, delete Zoom webinar best-effort but keep row for audit
    if (status === 'cancelled') {
      const { data: existing } = await this.supabaseService.client
        .from(TABLES.LIVE_SESSIONS)
        .select('zoom_webinar_id')
        .eq('id', id)
        .single();
      if (existing?.zoom_webinar_id) {
        try {
          await this.zoomService.deleteWebinar(existing.zoom_webinar_id);
        } catch (e) {
          this.logger.warn(`Failed to delete Zoom webinar on cancel ${existing.zoom_webinar_id}: ${(e as Error).message}`);
        }
      }
    }

    const { data, error } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update session status ${id}: ${error?.message}`);
      throw new BadRequestException('Failed to update session status');
    }

    await this.invalidateSessionsForSessionId(id).catch(()=>{});
    if (this.redisCache) await this.redisCache.delByPattern('cache:sessions:*').catch(()=>{}).catch(()=>{});
    if (status === 'cancelled') {
      logEntityEvent(
        this.observabilityService,
        'LIVE_SESSION_CANCELLED',
        'live_session',
        id,
        'system',
        { previousStatus: data.status ?? 'unknown', topic: data.topic ?? 'unknown' },
      ).catch(() => {});
    }

    return data;
  }

  // ──────────────────────────────────────────────────────────────
  //  deleteSession
  // ──────────────────────────────────────────────────────────────

  /**
   * Delete a session: cancel the Zoom webinar (best-effort), then remove the
   * session row (cascades to session_batches/session_registrants/attendance).
   *
   * Used by the legacy compatibility layer (DELETE /admin/sessions/:id).
   */
  async deleteSession(id: string): Promise<{ deleted: boolean }> {
    const { data: session, error: fetchError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('zoom_webinar_id')
      .eq('id', id)
      .single();

    if (fetchError || !session) {
      throw new NotFoundException(`Session ${id} not found`);
    }

    // Cancel the Zoom webinar best-effort; proceed with DB cleanup regardless.
    if (session.zoom_webinar_id) {
      try {
        await this.zoomService.deleteWebinar(session.zoom_webinar_id);
      } catch (err) {
        this.logger.warn(
          `Failed to delete Zoom webinar ${session.zoom_webinar_id}: ${(err as Error).message}`,
        );
      }
    }

    const { error: deleteError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .delete()
      .eq('id', id);

    if (deleteError) {
      this.logger.error(`Failed to delete session ${id}: ${deleteError.message}`);
      throw new BadRequestException('Failed to delete session');
    }

    return { deleted: true };
  }
}
