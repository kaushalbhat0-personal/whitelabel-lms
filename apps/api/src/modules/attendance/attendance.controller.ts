/*
 * Attendance controller — endpoints for manual marking and reports
 *
 * Why this controller exists:
 *   - Thin HTTP layer between the client and AttendanceService.
 *   - Students see their own attendance via /attendance/me (uses @CurrentUser()).
 *   - CSV export endpoint sets appropriate Content-Type and Content-Disposition headers
 *     so the browser downloads the file automatically.
 *
 * A junior should know:
 *   - POST /attendance/manual is for teachers/admins to override Zoom's auto-attendance.
 *   - GET /attendance/me is what the student dashboard calls.
 *   - GET /attendance/batch/:batchId/export triggers a CSV download — the response
 *     is a plain string with CSV headers set so the browser saves it as a file.
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@lms/shared-types';
import { AttendanceService } from './attendance.service';
import { ManualAttendanceDto } from './dto/manual-attendance.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * GET /attendance/session/:sessionId
   *
   * Get attendance summary and records for a specific session.
   * Teachers and admins can view any session's attendance.
   */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('session/:sessionId')
  getSessionAttendance(@Param('sessionId') sessionId: string) {
    return this.attendanceService.getSessionAttendance(sessionId);
  }

  /**
   * POST /attendance/manual
   *
   * Manually mark attendance for a session (overrides Zoom auto-attendance).
   * Teachers and admins can mark attendance.
   */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post('manual')
  markManual(
    @Body() dto: ManualAttendanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.attendanceService.markManual(dto, user.id);
  }

  /**
   * GET /attendance/student/:userId
   *
   * Get a student's full attendance summary across all their sessions.
   * Teachers and admins can view any student's attendance.
   */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('student/:userId')
  getStudentAttendance(
    @Param('userId') userId: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.attendanceService.getStudentAttendance(userId, batchId);
  }

  /**
   * GET /attendance/me
   *
   * Get the currently logged-in student's own attendance.
   * Students don't need to pass their user ID — @CurrentUser() provides it.
   */
  @Roles(UserRole.STUDENT)
  @Get('me')
  getMyAttendance(
    @CurrentUser() user: { id: string },
    @Query('batchId') batchId?: string,
  ) {
    return this.attendanceService.getStudentAttendance(user.id, batchId);
  }

  /**
   * GET /attendance/batch/:batchId/report
   *
   * Get a grid report of attendance for a batch (rows = students, cols = sessions).
   * Used by the admin dashboard AttendanceGrid component.
   */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('batch/:batchId/report')
  getBatchReport(
    @Param('batchId') batchId: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.attendanceService.getBatchAttendanceReport(batchId, sessionId);
  }

  /**
   * GET /attendance/batch/:batchId/export
   *
   * Download a CSV file of attendance for a batch.
   * Only admins can export CSV.
   */
  @Roles(UserRole.ADMIN)
  @Get('batch/:batchId/export')
  async exportCsv(
    @Param('batchId') batchId: string,
    @Res() res: Response,
  ) {
    const csv = await this.attendanceService.exportAttendanceCsv(batchId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attendance-${batchId}.csv"`,
    );
    res.send(csv);
  }
}
