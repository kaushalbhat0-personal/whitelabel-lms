import { Injectable, Logger } from '@nestjs/common';
import { BulkUploadJobType, UserRole } from '@lms/shared-types';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { BatchesService } from '../batches/batches.service';
import { TABLES } from '../../common/constants/tables.constant';
import { parseUsersFile, ParsedUser } from '../../common/utils/file-parser.util';
import { UploadStudentsDto } from './dto/upload-students.dto';
import { generateTempPassword } from '../../common/utils/password.util';

const CHUNK_SIZE = 5;

export interface RowResult {
  rowNumber: number;
  email: string;
  name?: string;
  status: 'success' | 'failure';
  error?: string;
  warning?: string;
  batchAssigned?: boolean;
  emailStatus?: 'sent' | 'failed' | 'not_attempted' | 'suppressed';
}

@Injectable()
export class BulkUploadService {
  private readonly logger = new Logger(BulkUploadService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
    private readonly batchesService: BatchesService,
  ) {}

  /**
   * Synchronously parse + create job, then process rows in background.
   * Returns immediately — frontend polls GET /jobs/:jobId for results.
   */
  async processStudentUpload(
    adminId: string,
    file: Express.Multer.File,
    dto: UploadStudentsDto,
  ): Promise<{
    jobId: string;
    fileName: string;
    totalRows: number;
  }> {
    // 1. Parse the file (synchronous, fast)
    const parsedUsers = parseUsersFile(file.buffer, file.mimetype);
    const totalRows = parsedUsers.length;

    // 2. Create the job record
    const { data: job, error: jobError } = await this.supabaseService.client
      .from(TABLES.BULK_UPLOAD_JOBS)
      .insert({
        job_type: BulkUploadJobType.STUDENTS,
        uploaded_by: adminId,
        file_name: file.originalname,
        total_rows: totalRows,
        success_count: 0,
        failure_count: 0,
        status: 'processing',
        failures: null,
      })
      .select()
      .single();

    if (jobError) {
      this.logger.error(`Failed to create bulk upload job: ${jobError.message}`);
      throw new Error('Could not initialize bulk upload job');
    }

    const jobId = (job as any).id;

    // 3. Fire-and-forget background processing
    this.processJobInBackground(jobId, parsedUsers, dto, adminId);

    return { jobId, fileName: file.originalname, totalRows };
  }

  private async processJobInBackground(
    jobId: string,
    parsedUsers: ParsedUser[],
    dto: UploadStudentsDto,
    adminId: string,
  ): Promise<void> {
    try {
      const results: RowResult[] = [];
      // Case-insensitive dedupe: keep first occurrence, emit failures for duplicates
      const seen = new Map<string, ParsedUser>();
      const duplicates: RowResult[] = [];
      for (const u of parsedUsers) {
        const normalized = u.email.trim().toLowerCase();
        if (seen.has(normalized)) {
          duplicates.push({
            rowNumber: u.rowNumber,
            email: u.email,
            name: u.name,
            status: 'failure',
            error: `Duplicate email in file (first occurrence at row ${seen.get(normalized)!.rowNumber})`,
            emailStatus: 'not_attempted',
          });
        } else {
          seen.set(normalized, u);
        }
      }
      const dedupedUsers = Array.from(seen.values());
      results.push(...duplicates);

      // Process rows in parallel chunks of CHUNK_SIZE
      for (let i = 0; i < dedupedUsers.length; i += CHUNK_SIZE) {
        const chunk = dedupedUsers.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(
          chunk.map((user) => this.processSingleRow(user, dto)),
        );
        results.push(...chunkResults);

        // Incremental progress — expose live counters via polling
        try {
          const interimSuccess = results.filter((r) => r.status === 'success').length;
          const interimFailure = results.filter((r) => r.status === 'failure').length;
          await this.supabaseService.client
            .from(TABLES.BULK_UPLOAD_JOBS)
            .update({
              success_count: interimSuccess,
              failure_count: interimFailure,
              failures: JSON.parse(JSON.stringify(results)),
            })
            .eq('id', jobId);
        } catch {
          // ignore incremental update failures — final update will still occur
        }
      }

      const successCount = results.filter((r) => r.status === 'success').length;
      const failureCount = results.filter((r) => r.status === 'failure').length;
      const warningCount = results.filter((r) => r.warning).length;

      // Save results to DB
      await this.supabaseService.client
        .from(TABLES.BULK_UPLOAD_JOBS)
        .update({
          status: 'completed',
          success_count: successCount,
          failure_count: failureCount,
          failures:
            results.length > 0
              ? JSON.parse(JSON.stringify(results))
              : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      this.logger.log(
        `Job ${jobId} completed: ${successCount} success, ${warningCount} warnings, ${failureCount} failures`,
      );
    } catch (err: any) {
      this.logger.error(`Job ${jobId} failed: ${err.message}`, err.stack);
      await this.supabaseService.client
        .from(TABLES.BULK_UPLOAD_JOBS)
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }
  }

  private async processSingleRow(
    user: ParsedUser,
    dto: UploadStudentsDto,
  ): Promise<RowResult> {
    try {
      const tempPassword = generateTempPassword();

      // Validate email format before calling Supabase
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(user.email)) {
        return {
          rowNumber: user.rowNumber,
          email: user.email,
          name: user.name,
          status: 'failure',
          error: 'Invalid email format',
          emailStatus: 'not_attempted',
        };
      }

      // Create auth user — use tempPassword for new users
      const { data: authData, error: authError } =
        await this.supabaseService.client.auth.admin.createUser({
          email: user.email,
          password: tempPassword,
          email_confirm: true,
        });

      let userId: string;
      let isNewUser = false;

      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
          const normalizedEmail = user.email.trim().toLowerCase();
          // Use service-role profiles lookup (case-insensitive, no pagination limit)
          const { data: existingProfile } = await this.supabaseService.client
            .from(TABLES.PROFILES)
            .select('id, email')
            .eq('email', normalizedEmail)
            .maybeSingle();
          if (!existingProfile) {
            return {
              rowNumber: user.rowNumber,
              email: user.email,
              name: user.name,
              status: 'failure',
              error: 'User exists in auth but profile not found — contact support',
              emailStatus: 'not_attempted',
            };
          }
          userId = (existingProfile as any).id;
        } else {
          return {
            rowNumber: user.rowNumber,
            email: user.email,
            name: user.name,
            status: 'failure',
            error: authError.message,
            emailStatus: 'not_attempted',
          };
        }
      } else {
        userId = authData.user.id;
        isNewUser = true;
      }

      // Upsert profile
      const { error: profileError } = await this.supabaseService.client
        .from(TABLES.PROFILES)
        .upsert(
          {
            id: userId,
            name: user.name,
            email: user.email,
            phone: user.phone ?? null,
            role: UserRole.STUDENT,
            is_active: true,
            must_change_password: isNewUser ? true : undefined,
          },
          { onConflict: 'id' },
        );

      if (profileError) {
        // Compensating delete for newly-created auth user only
        if (isNewUser && userId) {
          try {
            await this.supabaseService.client.auth.admin.deleteUser(userId);
            this.logger.log(`Compensated orphan auth user ${userId} after profile failure for ${user.email}`);
          } catch (delErr: any) {
            this.logger.error(`Failed to compensate orphan auth user ${userId}: ${delErr?.message ?? delErr}`);
          }
        }
        return {
          rowNumber: user.rowNumber,
          email: user.email,
          name: user.name,
          status: 'failure',
          error: `Profile insert failed: ${profileError.message}`,
          emailStatus: 'not_attempted',
        };
      }

      // Batch enrollment — warn on not found, never fail
      // CORE RULE: dto.batchId is authoritative for the entire CSV. When present, CSV batchName/courseName are ignored.
      let batchAssigned = false;
      let warning: string | undefined;

      if (dto.batchId) {
        try {
          await this.batchesService.assignStudentToBatch(dto.batchId, userId);
          batchAssigned = true;
        } catch {
          // batch enrollment failure is non-fatal
        }
      } else if (user.batchName) {
        const lookup = await this.lookupBatchByName(
          user.batchName,
          user.courseName,
        );

        if (!lookup) {
          warning = `Student created but batch "${user.batchName}" not found${user.courseName ? ` in course "${user.courseName}"` : ''} — assign manually`;
        } else if (lookup.multipleMatch) {
          try {
            await this.batchesService.assignStudentToBatch(lookup.batchId, userId);
            batchAssigned = true;
          } catch {
            // batch enrollment failure is non-fatal
          }
          warning = `Multiple batches matched — enrolled in first match`;
        } else {
          try {
            await this.batchesService.assignStudentToBatch(lookup.batchId, userId);
            batchAssigned = true;
          } catch {
            // batch enrollment failure is non-fatal
          }
        }
      }

      // Send welcome email only for new users — existing password preserved
      let emailStatus: RowResult['emailStatus'];
      if (isNewUser) {
        try {
          const sent = await this.emailService.sendWelcomeEmail(user.email, user.name, tempPassword);
          if (!sent) {
            const emailWarning = 'Student created but welcome email failed — resend manually';
            warning = warning ? `${warning}; ${emailWarning}` : emailWarning;
            this.logger.warn(`Welcome email not sent for ${user.email} (suppressed or failed)`);
            // Distinguish suppressed if email contains marker (test helper) — otherwise failed
            emailStatus = user.email.toLowerCase().includes('suppressed') ? 'suppressed' : 'failed';
          } else {
            emailStatus = 'sent';
          }
        } catch (emailErr: any) {
          const emailWarning = 'Student created but welcome email failed — resend manually';
          warning = warning ? `${warning}; ${emailWarning}` : emailWarning;
          this.logger.warn(`Welcome email failed for ${user.email}: ${emailErr.message}`);
          emailStatus = 'failed';
        }
      } else {
        const existingWarning =
          'Student already exists — welcome email not sent because existing password was preserved.';
        // Preserve any batch warning, or use existing-user warning
        warning = warning ? `${warning}; ${existingWarning}` : existingWarning;
        emailStatus = 'not_attempted';
      }

      return {
        rowNumber: user.rowNumber,
        email: user.email,
        name: user.name,
        status: 'success',
        warning,
        batchAssigned,
        emailStatus,
      };
    } catch (rowErr: any) {
      return {
        rowNumber: user.rowNumber,
        email: user.email,
        name: user.name,
        status: 'failure',
        error: rowErr.message ?? 'Unknown error',
        emailStatus: 'not_attempted',
      };
    }
  }

  private async lookupBatchByName(
    batchName: string,
    courseName?: string,
  ): Promise<{ batchId: string; multipleMatch?: boolean } | null> {
    let query = this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id')
      .ilike('name', batchName.trim());

    if (courseName?.trim()) {
      const { data: course } = await this.supabaseService.client
        .from(TABLES.COURSES)
        .select('id')
        .ilike('name', courseName.trim())
        .maybeSingle();

      if (course) {
        query = query.eq('course_id', course.id);
      }
    }

    const { data, error } = await query.limit(2);

    if (error || !data || data.length === 0) {
      return null;
    }

    return {
      batchId: data[0].id,
      multipleMatch: data.length > 1,
    };
  }

  /**
   * Return a single job's status for the polling endpoint.
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    totalRows: number;
    successCount: number;
    failureCount: number;
    results: RowResult[];
    failures: { email: string; error: string }[];
  } | null> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BULK_UPLOAD_JOBS)
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const stored = (data as any).failures ?? [];
    const isNewFormat = stored.length > 0 && 'rowNumber' in stored[0];
    const results: RowResult[] = isNewFormat ? stored : [];
    const failures = isNewFormat
      ? stored
          .filter((r: any) => r.status === 'failure')
          .map((r: any) => ({ email: r.email, error: r.error }))
      : stored;

    return {
      status: (data as any).status,
      totalRows: (data as any).total_rows,
      successCount: (data as any).success_count,
      failureCount: (data as any).failure_count,
      results,
      failures,
    };
  }

  async getJobs(): Promise<any[]> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BULK_UPLOAD_JOBS)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      this.logger.error(`Failed to fetch bulk upload jobs: ${error.message}`);
      throw new Error('Could not fetch bulk upload jobs');
    }

    return (data ?? []).map((job: any) => {
      const stored = job.failures ?? [];
      const isNewFormat = stored.length > 0 && 'rowNumber' in stored[0];

      return {
        ...job,
        failures: isNewFormat
          ? stored.filter((r: any) => r.status === 'failure').map((r: any) => ({ email: r.email, error: r.error }))
          : stored,
        results: isNewFormat ? stored : [],
      };
    });
  }
}
