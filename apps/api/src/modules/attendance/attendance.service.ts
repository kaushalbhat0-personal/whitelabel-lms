/*
 * Attendance service — manual marking, reporting, and percentage calculations
 *
 * Why this service exists:
 *   - Attendance is auto-captured from Zoom webhooks during live sessions (handled in
 *     ZoomWebhookHandler). This service handles manual overrides, reporting, and
 *     percentage calculations.
 *   - Manual marking UPSERTS so a teacher's override replaces whatever Zoom recorded.
 *   - The batch attendance report builds a grid (students × sessions) used by the
 *     admin dashboard's AttendanceGrid component.
 *
 * A junior should know:
 *   - Auto-attendance from Zoom happens in zoom-webhook.handler.ts — this service
 *     only deals with manual operations and read-only reports.
 *   - The CSV export builds the string manually — no external libraries.
 *   - getBatchAttendanceReport is the most complex method — it builds a 2D grid
 *     of students × sessions with percentage calculations.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AttendanceStatus } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { ManualAttendanceDto } from './dto/manual-attendance.dto';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  // ──────────────────────────────────────────────────────────────
  //  getSessionAttendance
  // ──────────────────────────────────────────────────────────────

  /**
   * Get attendance summary and records for a single session.
   *
   * Shows the full picture — students who joined and those who didn't.
   *
   * Steps:
   *   1. Verify the session exists
   *   2. Fetch all attendance records joined with user profiles
   *   3. Count present, absent, late, and total
   *   4. Return summary + records
   */
  async getSessionAttendance(sessionId: string) {
    // Verify session exists
    const { data: session, error: sessionError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('id, topic')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new NotFoundException('Session not found');
    }

    // Fetch attendance records with user info
    const { data: records, error: recordsError } = await this.supabaseService.client
      .from(TABLES.ATTENDANCE)
      .select(`
        *,
        profiles!inner(id, name, email)
      `)
      .eq('session_id', sessionId);

    if (recordsError) {
      this.logger.error(`Failed to fetch attendance for session ${sessionId}: ${recordsError.message}`);
      throw new BadRequestException('Could not retrieve attendance records');
    }

    // Calculate counts
    const present = (records ?? []).filter((r: any) => r.status === 'present').length;
    const absent = (records ?? []).filter((r: any) => r.status === 'absent').length;
    const late = (records ?? []).filter((r: any) => r.status === 'late').length;

    return {
      sessionId,
      topic: session.topic,
      summary: {
        present,
        absent,
        late,
        total: (records ?? []).length,
      },
      records: records ?? [],
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  markManual
  // ──────────────────────────────────────────────────────────────

  /**
   * Manually mark attendance for a session.
   *
   * Upsert means if Zoom already auto-recorded their attendance, the manual mark
   * overrides it.
   *
   * Steps:
   *   1. Verify the session exists and has ended (can't mark future sessions)
   *   2. Upsert each entry into TABLES.ATTENDANCE
   *   3. Return count of records updated
   */
  async markManual(dto: ManualAttendanceDto, markedBy: string) {
    // Verify session exists and has ended
    const { data: session, error: sessionError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('id, status')
      .eq('id', dto.sessionId)
      .single();

    if (sessionError || !session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== 'ended') {
      throw new BadRequestException(
        'Cannot mark attendance for a session that has not ended yet.',
      );
    }

    // Upsert each entry — schema uses marked_manually + updated_at trigger
    const now = new Date().toISOString();
    const records = dto.entries.map((entry) => ({
      session_id: dto.sessionId,
      user_id: entry.userId,
      status: entry.status,
      marked_by: markedBy,
      marked_manually: true,
      join_time: now,
      updated_at: now,
    }));

    const { error: upsertError } = await this.supabaseService.client
      .from(TABLES.ATTENDANCE)
      .upsert(records, { onConflict: 'session_id,user_id' });

    if (upsertError) {
      this.logger.error(`Failed to mark attendance: ${upsertError.message}`);
      throw new BadRequestException('Failed to mark attendance');
    }

    return { updatedCount: dto.entries.length };
  }

  // ──────────────────────────────────────────────────────────────
  //  getStudentAttendance
  // ──────────────────────────────────────────────────────────────

  /**
   * Get attendance summary for a single student.
   *
   * Steps:
   *   1. Find all sessions the student was registered for (optionally by batch)
   *   2. Join attendance records
   *   3. Calculate total, present, absent, late, and percentage
   *   4. Return summary + records
   */
  async getStudentAttendance(userId: string, batchId?: string) {
    // Find sessions via SESSION_REGISTRANTS
    let sessionQuery = this.supabaseService.client
      .from(TABLES.SESSION_REGISTRANTS)
      .select('session_id, live_sessions!inner(id, topic, start_time, status)')
      .eq('user_id', userId);

    // If batch filter, join through SESSION_BATCHES
    if (batchId) {
      const { data: batchSessions } = await this.supabaseService.client
        .from(TABLES.SESSION_BATCHES)
        .select('session_id')
        .eq('batch_id', batchId);

      const sessionIds = (batchSessions ?? []).map((s: any) => s.session_id);
      if (sessionIds.length > 0) {
        sessionQuery = sessionQuery.in('session_id', sessionIds) as any;
      } else {
        return { summary: { total: 0, present: 0, absent: 0, late: 0, percentage: 0 }, records: [] };
      }
    }

    const { data: registrations, error: regError } = await sessionQuery;

    if (regError) {
      this.logger.error(`Failed to fetch student sessions: ${regError.message}`);
      throw new BadRequestException('Could not retrieve attendance');
    }

    const sessionIds = (registrations ?? []).map((r: any) => r.session_id);
    const sessions = (registrations ?? []).map((r: any) => r.live_sessions);

    if (sessionIds.length === 0) {
      return { summary: { total: 0, present: 0, absent: 0, late: 0, percentage: 0 }, records: [] };
    }

    // Fetch attendance records
    const { data: records } = await this.supabaseService.client
      .from(TABLES.ATTENDANCE)
      .select('*')
      .in('session_id', sessionIds)
      .eq('user_id', userId);

    const present = (records ?? []).filter((r: any) => r.status === 'present').length;
    const absent = (records ?? []).filter((r: any) => r.status === 'absent').length;
    const late = (records ?? []).filter((r: any) => r.status === 'late').length;
    const total = (records ?? []).length;
    const percentage = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

    return {
      summary: { total, present, absent, late, percentage },
      records: sessions.map((session: any) => {
        const record = (records ?? []).find((r: any) => r.session_id === session.id);
        return {
          sessionId: session.id,
          topic: session.topic,
          startTime: session.start_time,
          status: record?.status || null,
        };
      }),
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  getBatchAttendanceReport
  // ──────────────────────────────────────────────────────────────

  /**
   * Build a grid report of attendance for a batch.
   *
   * Rows = students, columns = sessions, each cell = attendance status.
   * Used by admin dashboard AttendanceGrid component.
   *
   * Steps:
   *   1. Verify the batch exists
   *   2. Get all ended sessions for this batch
   *   3. Get all enrolled students
   *   4. For each student, get their attendance across all sessions
   *   5. Build the grid and calculate per-student percentages
   */
  async getBatchAttendanceReport(batchId: string, sessionId?: string) {
    // Verify batch exists
    const { data: batch, error: batchError } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id, name')
      .eq('id', batchId)
      .single();

    if (batchError || !batch) {
      throw new NotFoundException('Batch not found');
    }

    // Get sessions (optionally filtered by sessionId) — only ended sessions must appear in batch attendance report
    let sessionsQuery = this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('session_id, live_sessions!inner(id, topic, start_time, status)')
      .eq('batch_id', batchId);

    if (sessionId) {
      sessionsQuery = sessionsQuery.eq('session_id', sessionId) as any;
    }

    const { data: sessionLinks } = await sessionsQuery;

    const sessions = (sessionLinks ?? []).map((s: any) => s.live_sessions).filter((s: any) => s.status === 'ended');
    const sessionIds = sessions.map((s: any) => s.id);

    if (sessions.length === 0) {
      return { batchName: batch.name, sessions: [], students: [] };
    }

    // Get enrolled students
    const { data: studentLinks } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('user_id, profiles!inner(id, name, email)')
      .eq('batch_id', batchId);

    const students = (studentLinks ?? []).map((s: any) => s.profiles);

    // Get all attendance records for this batch's sessions
    const { data: allRecords } = await this.supabaseService.client
      .from(TABLES.ATTENDANCE)
      .select('session_id, user_id, status')
      .in('session_id', sessionIds);

    // Build attendance map: userId → { sessionId: status }
    const attendanceMap = new Map<string, Map<string, string>>();
    for (const record of allRecords ?? []) {
      if (!attendanceMap.has(record.user_id)) {
        attendanceMap.set(record.user_id, new Map());
      }
      attendanceMap.get(record.user_id)!.set(record.session_id, record.status);
    }

    // Build the grid
    const studentRows = students.map((student: any) => {
      const studentAttendance = attendanceMap.get(student.id) || new Map();
      let present = 0;
      const attendance: Record<string, string | null> = {};

      for (const session of sessions) {
        const status = studentAttendance.get(session.id) || null;
        attendance[session.id] = status;
        if (status === 'present' || status === 'late') present++;
      }

      const percentage = sessions.length > 0
        ? Math.round((present / sessions.length) * 100)
        : 0;

      return {
        id: student.id,
        name: student.name,
        email: student.email,
        attendance,
        percentage,
      };
    });

    return {
      batchName: batch.name,
      sessions: sessions.map((s: any) => ({
        id: s.id,
        topic: s.topic,
        date: s.start_time,
      })),
      students: studentRows,
    };
  }

  // ──────────────────────────────────────────────────────────────
  //  exportAttendanceCsv
  // ──────────────────────────────────────────────────────────────

  /**
   * Export batch attendance as a CSV string.
   *
   * Simple CSV export — no external library needed, we build it manually.
   * Header row: "Name, Email, Session1, Session2, ..., %"
   * Each student row: "John, john@email.com, present, absent, ..., 75"
   *
   * Steps:
   *   1. Get the batch attendance report
   *   2. Build the CSV header row from session topics
   *   3. Build each student row
   *   4. Return the full CSV string
   */
  async exportAttendanceCsv(batchId: string): Promise<string> {
    const report = await this.getBatchAttendanceReport(batchId);

    // Escape a CSV field (wrap in quotes if it contains commas or quotes)
    const escapeCsv = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    // Build header row
    const headers = ['Name', 'Email', ...report.sessions.map((s) => escapeCsv(s.topic)), '%'];

    // Build rows
    const rows = report.students.map((student) => {
      const cells = [
        escapeCsv(student.name),
        escapeCsv(student.email),
        ...report.sessions.map((s) => student.attendance[s.id] || ''),
        student.percentage.toString(),
      ];
      return cells.join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}
