/*
 * Live Sessions controller — endpoints for managing live Zoom webinars
 *
 * Why this controller exists:
 *   - Thin HTTP layer — validates input, delegates to service, returns results.
 *   - Students have their own endpoints (/my, /:id/join) that use @CurrentUser()
 *     so they don't need to know their own ID.
 *   - The /join endpoint returns a unique Zoom URL tied to the student's email
 *     for attendance tracking.
 *
 * A junior should know:
 *   - POST /live-sessions is the big one — it creates a Zoom webinar AND registers
 *     all students automatically.
 *   - GET /live-sessions/my is what the student dashboard calls to see their sessions.
 *   - GET /live-sessions/:id/join returns the student's personal Zoom join URL.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionStatus, UserRole } from '@lms/shared-types';
import { LiveSessionsService } from './live-sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('live-sessions')
export class LiveSessionsController {
  constructor(private readonly liveSessionsService: LiveSessionsService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateSessionDto) {
    return this.liveSessionsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('batchId') batchId?: string,
    @Query('status') status?: string,
  ) {
    return this.liveSessionsService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      batchId,
      status,
    );
  }

  @Roles(UserRole.STUDENT)
  @Get('my')
  getMySessions(@CurrentUser() user: { id: string }) {
    return this.liveSessionsService.getForStudent(user.id);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT)
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.liveSessionsService.findById(id, user);
  }

  /**
   * POST /live-sessions/:id/request-join
   *
   * Request a single-use join token. Validates the session is joinable,
   * revokes previous tokens, and returns a fresh token.
   */
  @Roles(UserRole.STUDENT)
  @Post(':id/request-join')
  async requestJoin(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.liveSessionsService.requestJoinToken(id, user.id);
  }

  /**
   * POST /live-sessions/:id/join
   *
   * Consume a single-use join token and return the Zoom join URL.
   * Token is sent in the request body, never in the URL.
   */
  @Roles(UserRole.STUDENT)
  @Post(':id/join')
  async getJoinUrl(
    @Param('id') id: string,
    @Body('token') token: string,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown') as string;
    const userAgent = req.headers['user-agent'] || 'unknown';

    return this.liveSessionsService.getStudentJoinUrl(
      id,
      user.id,
      token,
      ip,
      userAgent as string,
    );
  }

  /**
   * POST /live-sessions/:id/leave
   *
   * Mark the current user as having left the session.
   * Clears the active join marker in Redis.
   */
  @Roles(UserRole.STUDENT)
  @Post(':id/leave')
  async leaveSession(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.liveSessionsService.leaveSession(id, user.id);
    return { left: true };
  }

  /**
   * GET /live-sessions/:id/join-audit
   *
   * View join attempt audit trail for a session. Includes IP, user agent,
   * outcome, and user info. Admin only.
   */
  @Roles(UserRole.ADMIN)
  @Get(':id/join-audit')
  async getJoinAudit(@Param('id') id: string) {
    return this.liveSessionsService.getJoinAudit(id);
  }

  /**
   * GET /live-sessions/:id/active-joins
   *
   * View currently active join sessions (from Redis). Admin only.
   * Used to detect link sharing (same user from multiple IPs).
   */
  @Roles(UserRole.ADMIN)
  @Get(':id/active-joins')
  async getActiveJoins(@Param('id') id: string) {
    return this.liveSessionsService.getActiveJoins(id);
  }

  /**
   * POST /live-sessions/:id/revoke-tokens
   *
   * Revoke ALL outstanding join tokens for a session. Admin only.
   * Sets a revocation timestamp — all future token requests will be rejected
   * until the admin re-enables them. Clears all active join markers.
   */
  @Roles(UserRole.ADMIN)
  @Post(':id/revoke-tokens')
  async revokeTokens(@Param('id') id: string) {
    await this.liveSessionsService.revokeAllTokens(id);
    return { revoked: true };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: SessionStatus,
  ) {
    return this.liveSessionsService.updateStatus(id, status);
  }
}
