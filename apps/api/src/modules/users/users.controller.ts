/*
 * Users controller — CRUD and management endpoints for users
 *
 * Why this controller exists:
 *   - Thin HTTP layer that validates incoming parameters and delegates to UsersService.
 *   - Role decorators (@Roles()) restrict access so only admins and teachers can
 *     view/manage users, and students can only view their own batches.
 *
 * A junior should know:
 *   - @Roles('admin') means only admin users can call that endpoint.
 *   - @CurrentUser() extracts the user object JwtAuthGuard attached to the request.
 *   - GET /users/me/batches is a student-facing shortcut — no need to know user IDs.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users
   *
   * List all users with optional role filter and pagination.
   * Only admins can see the full user list.
   */
  @Roles(UserRole.ADMIN)
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: UserRole,
    @Query('includeInactive') includeInactive?: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      role,
      includeInactive === 'true',
      search,
    );
  }

  /**
   * GET /users/me/batches
   *
   * Get all batches for the currently logged-in user.
   * Students use this to see their enrolled batches without knowing their user ID.
   * NOTE: must be registered BEFORE @Get(':id') or Nest would match 'me' as :id.
   */
  @Get('me/batches')
  getMyBatches(@CurrentUser() user: { id: string }) {
    return this.usersService.getBatchesForUser(user.id);
  }

  /**
   * GET /users/:id
   *
   * Get a single user by ID.
   * Admins and teachers can view any user.
   */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  /**
   * POST /users
   *
   * Create a new user (auth account + profile).
   * Only admins can create users.
   */
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  /**
   * PATCH /users/:id
   *
   * Update a user's profile fields.
   * Only admins can update users.
   */
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  /**
   * POST /users/:id/suspend
   *
   * Suspend a user — deactivates account and force-logs them out.
   * Only admins can suspend users.
   */
  @Roles(UserRole.ADMIN)
  @Post(':id/suspend')
  suspend(@Param('id') id: string) {
    return this.usersService.suspend(id);
  }

  /**
   * DELETE /users/:id
   *
   * Soft-delete a user — sets is_active = false and force-logs them out.
   */
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  /**
   * GET /users/:id/batches
   *
   * Get all batches a specific user belongs to.
   * Admins and teachers can check any user's batches.
   */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get(':id/batches')
  getUserBatches(@Param('id') id: string) {
    return this.usersService.getBatchesForUser(id);
  }

}
