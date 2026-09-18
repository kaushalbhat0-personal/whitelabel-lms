/*
 * Users service — all user-management business logic
 *
 * Why this service exists:
 *   - Separates database operations and business rules from the HTTP layer.
 *   - When creating a user, it first creates the auth account in Supabase Auth,
 *     then inserts the profile into the public.users table.
 *   - Suspending a user also force-kills their active session.
 *
 * A junior should know:
 *   - This service never returns passwords — Supabase hashes and stores them.
 *   - forceLogoutUser() is called from AuthService when suspending accounts.
 *   - Pagination uses `range()` which is Supabase's equivalent of LIMIT/OFFSET.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
  Optional,
} from '@nestjs/common';
import { UserRole, PaginatedResponse, User as UserType } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS } from '../../common/constants/redis-keys.constant';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { AuditService } from '../audit/audit.service';
import { escapeIlikePattern } from '../../common/utils/like-escape.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { generateTempPassword } from '../../common/utils/password.util';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly redisCacheService?: RedisCacheService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  findAll
  // ──────────────────────────────────────────────────────────────

  /**
   * List users with optional role filter, search, and pagination.
   *
   * Steps:
   *   1. Build query against TABLES.PROFILES with optional role filter
   *   2. If `search` is provided, filter by name/email ILIKE match
   *   3. Apply Supabase range() for pagination, order by created_at desc
   *   4. Also fetch total count for pagination metadata
   *   5. Return PaginatedResponse<User>
   */
  async findAll(
    page = 1,
    limit = 20,
    role?: UserRole,
    includeInactive = false,
    search?: string,
  ): Promise<PaginatedResponse<UserType>> {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const selectFields =
      role === UserRole.STUDENT
        ? '*, batch_students(batches(id, name))'
        : '*';

    let query = this.supabaseService.client
      .from(TABLES.PROFILES)
      .select(selectFields, { count: 'exact' });

    if (role) {
      query = query.eq('role', role);
    }

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    if (search?.trim()) {
      const escaped = escapeIlikePattern(search.trim());
      const term = `%${escaped}%`;
      query = query.or(`name.ilike.${term},email.ilike.${term}`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch users: ${error.message}`);
      throw new BadRequestException('Could not retrieve users');
    }

    const items = (data ?? []).map((entry: any) => {
      if (role === UserRole.STUDENT) {
        const { batch_students, ...profile } = entry;
        return {
          ...profile,
          batches: (batch_students ?? [])
            .map((bs: any) => bs.batches)
            .filter(Boolean),
        };
      }
      return entry;
    });

    return {
      items: (items as unknown as UserType[]) ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  findById
  // ──────────────────────────────────────────────────────────────

  /**
   * Get a single user by their UUID.
   *
   * Steps:
   *   1. Query TABLES.PROFILES where id = provided id
   *   2. Throw NotFoundException if no user found
   *   3. Return the user object
   */
  async findById(id: string): Promise<UserType> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    return data as unknown as UserType;
  }

  // ──────────────────────────────────────────────────────────────
  //  create
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a new user (auth account + profile).
   *
   * Steps:
   *   1. Create the auth user via Supabase Admin API (email_confirm: true so they
   *      don't need to verify email before first login)
   *   2. If auth creation fails, throw BadRequestException with Supabase's error message
   *   3. Insert the profile into TABLES.PROFILES using the returned auth user ID
   *   4. Return the created profile (never expose the password)
   */
  async create(dto: CreateUserDto): Promise<UserType> {
    // Server-side generation if client did not provide password (manual onboarding)
    const effectivePassword = dto.password ?? generateTempPassword();
    // Step 1: Create auth user
    const { data: authData, error: authError } =
      await this.supabaseService.client.auth.admin.createUser({
        email: dto.email,
        password: effectivePassword,
        email_confirm: true,
      });

    if (authError) {
      this.logger.error(`Failed to create auth user: ${authError.message}`);
      throw new BadRequestException(authError.message);
    }

    const userId = authData.user.id;

    // Step 2: Insert profile
    const mustChangePassword = dto.role === UserRole.STUDENT;
    const { data: profile, error: profileError } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .insert({
        id: userId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        role: dto.role,
        zoom_user_id: dto.zoomUserId ?? null,
        is_active: true,
        must_change_password: mustChangePassword,
      })
      .select()
      .single();

    if (profileError) {
      // Rollback: delete the auth user if profile insert fails
      await this.supabaseService.client.auth.admin.deleteUser(userId);
      this.logger.error(`Failed to create user profile: ${profileError.message}`);
      throw new BadRequestException('Failed to create user profile');
    }

    // Await welcome email safely — failure must NOT block user creation,
    // but result must be observable via email_logs (and not hang admin UI)
    // Use the actual password that was persisted (effectivePassword)
    try {
      const emailSent = await this.emailService.sendWelcomeEmail(dto.email, dto.name, effectivePassword);
      if (!emailSent) {
        this.logger.warn(`Welcome email not delivered for ${dto.email} — check email_logs/suppression`);
      }
    } catch (emailErr: any) {
      this.logger.warn(`Welcome email failed for ${dto.email}: ${emailErr.message}`);
    }

    return profile as unknown as UserType;
  }

  // ──────────────────────────────────────────────────────────────
  //  update
  // ──────────────────────────────────────────────────────────────

  /**
   * Update a user's profile fields.
   *
   * Steps:
   *   1. Build an update object from the DTO (only include provided fields)
   *   2. Update the row in TABLES.PROFILES
   *   3. If isActive is being set to false, force-logout the user immediately
   *   4. Return the updated user
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserType> {
    const updateData: Record<string, unknown> = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;
    if (dto.zoomUserId !== undefined) updateData.zoom_user_id = dto.zoomUserId;

    const { data, error } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update user ${id}: ${error?.message}`);
      throw new BadRequestException('Failed to update user');
    }

    // If the account was suspended, kick them out immediately
    if (dto.isActive === false) {
      await this.authService.forceLogoutUser(id);
      this.logger.log(`User ${id} suspended — session invalidated`);
    }

    return data as unknown as UserType;
  }

  // ──────────────────────────────────────────────────────────────
  //  suspend
  // ──────────────────────────────────────────────────────────────

  /**
   * Suspend a user — sets is_active to false and force-logs them out.
   *
   * Suspending a user immediately ends their session — they can't stay logged in
   * after being suspended.
   *
   * Steps:
   *   1. Set is_active = false in TABLES.PROFILES
   *   2. Call authService.forceLogoutUser() to invalidate their Redis session
   */
  async suspend(id: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to suspend user ${id}: ${error.message}`);
      throw new BadRequestException('Failed to suspend user');
    }

    await this.authService.forceLogoutUser(id);
    this.logger.log(`User ${id} suspended and logged out`);
  }

  // ──────────────────────────────────────────────────────────────
  //  remove (soft-delete)
  // ──────────────────────────────────────────────────────────────

  /**
   * Soft-delete a user — sets is_active to false and force-logs them out.
   * The row stays in the database for analytics; the user just can't log in.
   *
   * Steps:
   *   1. Set is_active = false in TABLES.PROFILES
   *   2. Call authService.forceLogoutUser() to invalidate their Redis session
   *   3. Return success indicator
   */
  async remove(id: string): Promise<{ deleted: boolean }> {
    const { error } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to soft-delete user ${id}: ${error.message}`);
      throw new BadRequestException('Failed to remove user');
    }

    await this.authService.forceLogoutUser(id);
    this.logger.log(`User ${id} soft-deleted and logged out`);

    return { deleted: true };
  }

  // ──────────────────────────────────────────────────────────────
  //  permanentDelete — safe hard delete for students only
  // ──────────────────────────────────────────────────────────────

  /**
   * Permanently delete a student account — DB-first, retention-aware.
   *
   * Steps:
   *  1. Validate actor/target, role, self-delete
   *  2. Check historical blockers (payments/invoices/etc.) — 409 if any
   *  3. Collect attempt IDs + storage paths before mutation
   *  4. Clean ephemeral Redis state
   *  5. Delete profile (CASCADE handles ephemeral children)
   *  6. Delete Supabase Auth user
   *  7. Verify + audit
   */
  async permanentDelete(
    targetId: string,
    actorId: string,
  ): Promise<{ deleted: boolean; freedEmail: string }> {
    // ── 1. Fetch target profile ─────────────────────────────────
    const { data: target, error: fetchError } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id, email, role, is_active, name')
      .eq('id', targetId)
      .single();

    if (fetchError || !target) {
      // Idempotency: profile missing but Auth may still exist — try to finish Auth deletion
      try {
        const { data: authInfo, error: authFetchError } =
          await this.supabaseService.client.auth.admin.getUserById(targetId);
        if (!authFetchError && authInfo?.user) {
          this.logger.warn(
            `permanentDelete: profile ${targetId} missing but Auth exists — completing Auth deletion`,
          );
          if (this.auditService) {
            await this.auditService
              .log({
                action: 'permanent_delete_attempt',
                entityType: 'profile',
                entityId: targetId,
                actorId,
                actorRole: 'admin',
                metadata: { reason: 'idempotent_auth_cleanup' },
              })
              .catch(() => {});
          }
          const { error: delErr } = await this.supabaseService.client.auth.admin.deleteUser(targetId);
          if (!delErr) {
            if (this.auditService) {
              await this.auditService
                .log({
                  action: 'permanent_deleted',
                  entityType: 'profile',
                  entityId: targetId,
                  actorId,
                  actorRole: 'admin',
                  metadata: { freedEmail: authInfo.user.email ?? null, idempotent: true },
                })
                .catch(() => {});
            }
            await this.cleanRedisForUser(targetId).catch(() => {});
            return { deleted: true, freedEmail: authInfo.user.email ?? '' };
          }
        }
      } catch {}
      throw new NotFoundException('User not found');
    }

    const targetEmail: string = target.email;
    const targetRole: string = target.role;

    // ── 2. Role + self-delete validation ────────────────────────
    if (targetRole !== UserRole.STUDENT) {
      throw new ForbiddenException('Only students can be permanently deleted');
    }
    if (targetId === actorId) {
      throw new ForbiddenException('Cannot permanently delete your own account');
    }

    // ── Audit: attempt ──────────────────────────────────────────
    if (this.auditService) {
      await this.auditService
        .log({
          action: 'permanent_delete_attempt',
          entityType: 'profile',
          entityId: targetId,
          actorId,
          actorRole: 'admin',
          metadata: { email: targetEmail, role: targetRole, is_active: target.is_active },
        })
        .catch(() => {});
    }

    // ── 3. Retention blockers — read-only count checks ──────────
    const blockerDetails: Record<string, number> = {
      payments: 0,
      paymentPlans: 0,
      invoices: 0,
      receipts: 0,
      testResults: 0,
      certificates: 0,
      attendance: 0,
    };

    try {
      const queries: Array<Promise<{ count: number | null; error: any }>> = [
        (this.supabaseService.client
          .from(TABLES.PAYMENTS)
          .select('id', { count: 'exact', head: true })
          .eq('student_id', targetId) as any),
        (this.supabaseService.client
          .from(TABLES.PAYMENT_PLANS)
          .select('id', { count: 'exact', head: true })
          .eq('student_id', targetId) as any),
        (this.supabaseService.client
          .from(TABLES.INVOICES)
          .select('id', { count: 'exact', head: true })
          .eq('student_id', targetId) as any),
        (this.supabaseService.client
          .from(TABLES.RECEIPTS)
          .select('id', { count: 'exact', head: true })
          .eq('student_id', targetId) as any),
        (this.supabaseService.client
          .from(TABLES.TEST_RESULTS)
          .select('id', { count: 'exact', head: true })
          .eq('user_id', targetId) as any),
        (this.supabaseService.client
          .from(TABLES.CERTIFICATES)
          .select('id', { count: 'exact', head: true })
          .eq('user_id', targetId) as any),
        (this.supabaseService.client
          .from(TABLES.ATTENDANCE)
          .select('id', { count: 'exact', head: true })
          .eq('user_id', targetId) as any),
      ];

      const results = await Promise.all(
        queries.map((p) => p.catch((e: any) => ({ count: null, error: e }))),
      );

      const keys: Array<keyof typeof blockerDetails> = [
        'payments',
        'paymentPlans',
        'invoices',
        'receipts',
        'testResults',
        'certificates',
        'attendance',
      ];

      results.forEach((r: any, idx) => {
        const key = keys[idx];
        if (r && !r.error && typeof r.count === 'number') {
          blockerDetails[key] = r.count ?? 0;
        } else if (r && r.error) {
          this.logger.warn(`Blocker check failed for ${key}: ${r.error?.message ?? 'unknown'}`);
        }
      });
    } catch (e: any) {
      this.logger.warn(`Blocker checks error: ${e?.message ?? e}`);
    }

    const hasBlockers = Object.values(blockerDetails).some((v) => v > 0);
    if (hasBlockers) {
      throw new ConflictException({
        code: 'STUDENT_HAS_HISTORICAL_RECORDS',
        message:
          'This student cannot be permanently deleted because historical records exist. Archive the student instead.',
        details: blockerDetails,
      });
    }

    // ── 4. Collect attempt IDs + storage paths before delete ────
    let attemptIds: string[] = [];
    let storagePaths: string[] = [];

    try {
      const { data: attempts } = await this.supabaseService.client
        .from(TABLES.TEST_ATTEMPTS)
        .select('id')
        .eq('user_id', targetId);
      attemptIds = (attempts ?? []).map((a: any) => a.id).filter(Boolean);
    } catch (e: any) {
      this.logger.warn(`Failed to collect attempt IDs for ${targetId}: ${e?.message}`);
    }

    if (attemptIds.length > 0) {
      try {
        const { data: answers } = await this.supabaseService.client
          .from(TABLES.TEST_ANSWERS)
          .select('answer')
          .in('attempt_id', attemptIds);
        for (const row of (answers ?? []) as any[]) {
          const ans = (row as any)?.answer;
          if (!ans) continue;
          // answer may be JSON object with storagePath/url/fileName
          const sp: string | undefined =
            typeof ans === 'object' ? ans.storagePath ?? ans.storage_path : undefined;
          if (sp && typeof sp === 'string' && sp.startsWith('question-answers/')) {
            // Ownership: must be q-<userId>- prefix
            if (sp.includes(`q-${targetId}-`)) {
              storagePaths.push(sp);
            }
          }
        }
      } catch (e: any) {
        this.logger.warn(`Failed to collect storage paths for ${targetId}: ${e?.message}`);
      }
    }

    // ── 5. Redis ephemeral cleanup (before DB delete so attemptIds still available) ──
    await this.cleanRedisForUser(targetId, attemptIds).catch((e: any) => {
      this.logger.warn(`Redis cleanup warning for ${targetId}: ${e?.message}`);
    });
    // Also invalidate app caches
    try {
      if (this.redisCacheService) {
        await Promise.all([
          this.redisCacheService.invalidateRecordingsCacheForUser(targetId).catch(() => {}),
          this.redisCacheService.invalidateCoursesCacheForUser(targetId).catch(() => {}),
          this.redisCacheService.invalidateSessionsCacheForUser(targetId).catch(() => {}),
          this.redisCacheService.invalidatePaymentsCacheForUser(targetId).catch(() => {}),
          this.redisCacheService.invalidateResultsCacheForUser(targetId).catch(() => {}),
          this.redisCacheService.invalidateTestsCacheForUser(targetId).catch(() => {}),
        ]);
      }
    } catch (e: any) {
      this.logger.warn(`Cache invalidation warning for ${targetId}: ${e?.message}`);
    }

    // ── 6. Storage cleanup — only student-owned paths ───────────
    if (storagePaths.length > 0) {
      try {
        // Batch deletes in chunks of 50 (Supabase storage limit)
        const uniquePaths = [...new Set(storagePaths)];
        for (let i = 0; i < uniquePaths.length; i += 50) {
          const chunk = uniquePaths.slice(i, i + 50);
          const { error: rmError } = await this.supabaseService.client.storage
            .from('uploads')
            .remove(chunk);
          if (rmError) {
            this.logger.warn(`Storage remove warning for ${targetId}: ${rmError.message}`);
          } else {
            this.logger.log(`Removed ${chunk.length} storage object(s) for ${targetId}`);
          }
        }
      } catch (e: any) {
        this.logger.warn(`Storage cleanup failed for ${targetId}: ${e?.message}`);
      }
    }

    // ── 7. Delete profile — DB-first ────────────────────────────
    const { error: deleteProfileError } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .delete()
      .eq('id', targetId);

    if (deleteProfileError) {
      // If RESTRICT violation and we missed blockers, surface as 409
      const code: string | undefined = (deleteProfileError as any).code;
      const msg: string = deleteProfileError.message ?? '';
      if (code === '23503' || msg.toLowerCase().includes('foreign key') || msg.toLowerCase().includes('violates')) {
        this.logger.warn(`Profile delete blocked by FK for ${targetId}: ${msg}`);
        throw new ConflictException({
          code: 'STUDENT_HAS_HISTORICAL_RECORDS',
          message:
            'This student cannot be permanently deleted because historical records exist. Archive the student instead.',
          details: blockerDetails,
        });
      }
      this.logger.error(`Failed to delete profile ${targetId}: ${msg}`);
      throw new BadRequestException('Failed to permanently delete student');
    }

    // ── 8. Verify profile gone ──────────────────────────────────
    const { data: verifyProfile } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id')
      .eq('id', targetId)
      .maybeSingle();
    if (verifyProfile) {
      this.logger.error(`Profile ${targetId} still exists after delete`);
      throw new BadRequestException('Failed to verify deletion');
    }

    // ── 9. Delete Supabase Auth user ────────────────────────────
    try {
      const { error: authDeleteError } =
        await this.supabaseService.client.auth.admin.deleteUser(targetId);
      if (authDeleteError) {
        // 404 means already deleted — treat as success (idempotent)
        const isNotFound =
          (authDeleteError as any).status === 404 ||
          authDeleteError.message?.toLowerCase().includes('not found');
        if (!isNotFound) {
          this.logger.error(`Auth delete failed for ${targetId}: ${authDeleteError.message}`);
          // Profile is already gone — return retryable error
          throw new BadRequestException(
            'Student profile deleted but authentication account could not be removed. Please retry permanent deletion.',
          );
        }
      }
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      // If it's a Conflict/Forbidden etc rethrow
      if (e?.status === 404 || e?.message?.toLowerCase().includes('not found')) {
        // idempotent
      } else {
        this.logger.error(`Auth delete exception for ${targetId}: ${e?.message ?? e}`);
        throw new BadRequestException(
          'Student profile deleted but authentication account could not be removed. Please retry permanent deletion.',
        );
      }
    }

    // ── 10. Verify Auth gone (best effort) ──────────────────────
    try {
      const { data: authUser, error: authVerifyError } =
        await this.supabaseService.client.auth.admin.getUserById(targetId);
      if (!authVerifyError && authUser?.user) {
        this.logger.warn(`Auth user ${targetId} still exists after delete — retry may be needed`);
      }
    } catch {}

    // ── 11. Final Redis cleanup + audit ─────────────────────────
    await this.cleanRedisForUser(targetId, attemptIds).catch(() => {});
    if (this.redisCacheService) {
      await Promise.all([
        this.redisCacheService.invalidateRecordingsCacheForUser(targetId).catch(() => {}),
        this.redisCacheService.invalidateCoursesCacheForUser(targetId).catch(() => {}),
        this.redisCacheService.invalidateSessionsCacheForUser(targetId).catch(() => {}),
        this.redisCacheService.invalidatePaymentsCacheForUser(targetId).catch(() => {}),
        this.redisCacheService.invalidateResultsCacheForUser(targetId).catch(() => {}),
        this.redisCacheService.invalidateTestsCacheForUser(targetId).catch(() => {}),
      ]).catch(() => {});
    }

    if (this.auditService) {
      await this.auditService
        .log({
          action: 'permanent_deleted',
          entityType: 'profile',
          entityId: targetId,
          actorId,
          actorRole: 'admin',
          metadata: { email: targetEmail, role: targetRole },
        })
        .catch(() => {});
    }

    this.logger.log(`Student ${targetId} (${targetEmail}) permanently deleted by ${actorId}`);
    return { deleted: true, freedEmail: targetEmail };
  }

  private async cleanRedisForUser(targetId: string, attemptIds?: string[]): Promise<void> {
    // Force logout (user_session + session)
    try {
      await this.authService.forceLogoutUser(targetId);
    } catch (e: any) {
      this.logger.warn(`forceLogout warning for ${targetId}: ${e?.message}`);
    }

    if (!this.redisService) return;
    let redis: any;
    try {
      redis = this.redisService.getOrThrow();
    } catch {
      return;
    }

    const safeDel = async (key: string) => {
      try {
        await redis.del(key);
      } catch (e: any) {
        this.logger.warn(`Redis DEL ${key} warning: ${e?.message}`);
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
            } catch {}
          }
        } while (cursor !== '0');
      } catch (e: any) {
        this.logger.warn(`Redis SCAN/DEL ${pattern} warning: ${e?.message}`);
      }
    };

    // Direct keys
    await safeDel(REDIS_KEYS.playbackRevoked(targetId));
    await safeDel(REDIS_KEYS.screenRecordingRateLimit(targetId));
    await safeDel(REDIS_KEYS.riskScore(targetId));
    // Playback events window keys: playback_events:{userId}:*
    await safeScanDel(`playback_events:${targetId}:*`);
    await safeScanDel(`playback_events:events:${targetId}:*`);
    // Join state
    await safeScanDel(`join_token_index:*:${targetId}`);
    await safeScanDel(`active_join:*:${targetId}`);
    // Note: join_token and playback_token are token-scoped, not user-scoped — expired via TTL
    // Do NOT broad-scan playback_token:* (expensive) — rely on TTL + revoked marker

    // Attempt timers/checkpoints
    const ids = attemptIds ?? [];
    // If not provided, try to fetch (best effort before profile deleted)
    let idsToClean = ids;
    if (idsToClean.length === 0) {
      try {
        const { data: attempts } = await this.supabaseService.client
          .from(TABLES.TEST_ATTEMPTS)
          .select('id')
          .eq('user_id', targetId);
        idsToClean = (attempts ?? []).map((a: any) => a.id);
      } catch {}
    }
    for (const aid of idsToClean) {
      await safeDel(REDIS_KEYS.attemptTimer(aid));
      await safeDel(REDIS_KEYS.attemptCheckpoint(aid));
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  getBatchesForUser
  // ──────────────────────────────────────────────────────────────

  /**
   * Get all batches a user belongs to (as student or teacher).
   *
   * Steps:
   *   1. Fetch the user's role
   *   2. If student → join BATCH_STUDENTS → BATCHES
   *   3. If teacher → join BATCH_TEACHERS → BATCHES
   *   4. Return array of batch objects
   */
  async getBatchesForUser(userId: string) {
    const user = await this.findById(userId);

    let query;

    if (user.role === UserRole.STUDENT) {
      query = this.supabaseService.client
        .from(TABLES.BATCH_STUDENTS)
        .select('batch_id, batches!inner(*)')
        .eq('user_id', userId);
    } else {
      query = this.supabaseService.client
        .from(TABLES.BATCH_TEACHERS)
        .select('batch_id, batches!inner(*)')
        .eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to fetch batches for user ${userId}: ${error.message}`);
      throw new BadRequestException('Could not retrieve batches');
    }

    return (data ?? []).map((item: any) => item.batches);
  }

  // ──────────────────────────────────────────────────────────────
  //  resendWelcome
  // ──────────────────────────────────────────────────────────────

  /**
   * Regenerate temp password and resend welcome email (admin-only recovery).
   * Does not return or log plaintext password.
   */
  async resendWelcome(userId: string): Promise<{ emailSent: boolean }> {
    const { data: profile, error: fetchError } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .select('id, name, email, is_active')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      throw new NotFoundException('User not found');
    }

    const newPassword = generateTempPassword();

    const { error: updateError } = await this.supabaseService.client.auth.admin.updateUserById(
      profile.id,
      { password: newPassword },
    );

    if (updateError) {
      this.logger.error(`Failed to reset password for resendWelcome ${userId}: ${updateError.message}`);
      throw new BadRequestException('Failed to reset password');
    }

    // Ensure must_change_password so student is prompted — failure after password rotation is not silent
    const { error: profileUpdateError } = await this.supabaseService.client
      .from(TABLES.PROFILES)
      .update({ must_change_password: true })
      .eq('id', profile.id);
    if (profileUpdateError) {
      this.logger.error(`Failed to set must_change_password for resendWelcome ${userId}: ${profileUpdateError.message}`);
      throw new BadRequestException('Password was reset but profile update failed — please retry resend');
    }

    let emailSent = false;
    try {
      emailSent = await this.emailService.sendWelcomeEmail(profile.email, profile.name, newPassword);
    } catch (e: any) {
      this.logger.warn(`Resend welcome email failed for ${profile.email}: ${e?.message}`);
      emailSent = false;
    }

    return { emailSent };
  }
}
