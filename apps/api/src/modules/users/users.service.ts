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
  Logger,
} from '@nestjs/common';
import { UserRole, PaginatedResponse, User as UserType } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { TABLES } from '../../common/constants/tables.constant';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
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
      const term = `%${search.trim()}%`;
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
    // Step 1: Create auth user
    const { data: authData, error: authError } =
      await this.supabaseService.client.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
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

    // Fire-and-forget welcome email — failure must NOT block user creation
    this.emailService
      .sendWelcomeEmail(dto.email, dto.name, dto.password)
      .catch((emailErr: any) =>
        this.logger.warn(`Welcome email failed for ${dto.email}: ${emailErr.message}`),
      );

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
}
