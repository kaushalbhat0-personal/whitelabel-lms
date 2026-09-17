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
  status: 'success' | 'failure';
  error?: string;
  warning?: string;
  batchAssigned?: boolean;
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

      // Process rows in parallel chunks of CHUNK_SIZE
      for (let i = 0; i < parsedUsers.length; i += CHUNK_SIZE) {
        const chunk = parsedUsers.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(
          chunk.map((user) => this.processSingleRow(user, dto)),
        );
        results.push(...chunkResults);
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
          status: 'failure',
          error: 'Invalid email format',
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
          const { data: listData } =
            await this.supabaseService.client.auth.admin.listUsers();
          const existing = listData?.users.find((u: any) => u.email === user.email);
          if (!existing) {
            return {
              rowNumber: user.rowNumber,
              email: user.email,
              status: 'failure',
              error: 'User exists in auth but could not be retrieved',
            };
          }
          userId = existing.id;
        } else {
          return {
            rowNumber: user.rowNumber,
            email: user.email,
            status: 'failure',
            error: authError.message,
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
        return {
          rowNumber: user.rowNumber,
          email: user.email,
          status: 'failure',
          error: `Profile insert failed: ${profileError.message}`,
        };
      }

      // Batch enrollment — warn on not found, never fail
      let batchAssigned = false;
      let warning: string | undefined;

      if (user.batchName) {
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
      } else if (dto.batchId) {
        try {
          await this.batchesService.assignStudentToBatch(dto.batchId, userId);
          batchAssigned = true;
        } catch {
          // batch enrollment failure is non-fatal
        }
      }

      // Send welcome email only for new users — existing password preserved
      if (isNewUser) {
        try {
          const sent = await this.emailService.sendWelcomeEmail(user.email, user.name, tempPassword);
          if (!sent) {
            const emailWarning = 'Student created but welcome email failed — resend manually';
            warning = warning ? `${warning}; ${emailWarning}` : emailWarning;
            this.logger.warn(`Welcome email not sent for ${user.email} (suppressed or failed)`);
          }
        } catch (emailErr: any) {
          const emailWarning = 'Student created but welcome email failed — resend manually';
          warning = warning ? `${warning}; ${emailWarning}` : emailWarning;
          this.logger.warn(`Welcome email failed for ${user.email}: ${emailErr.message}`);
        }
      } else {
        const existingWarning =
          'Student already exists — welcome email not sent because existing password was preserved.';
        // Preserve any batch warning, or use existing-user warning
        warning = warning ? `${warning}; ${existingWarning}` : existingWarning;
      }

      return {
        rowNumber: user.rowNumber,
        email: user.email,
        status: 'success',
        warning,
        batchAssigned,
      };
    } catch (rowErr: any) {
      return {
        rowNumber: user.rowNumber,
        email: user.email,
        status: 'failure',
        error: rowErr.message ?? 'Unknown error',
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
