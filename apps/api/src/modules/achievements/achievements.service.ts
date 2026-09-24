import { Injectable, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { PdfGenerationService } from '../pdf/pdf-generation.service';
import { ObservabilityService } from '../observability/observability.service';
import { TABLES } from '../../common/constants/tables.constant';
import { logEntityEvent } from '../../common/utils/observability-helper';
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
} from '../../common/config/defaults';

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
    private readonly pdfService: PdfGenerationService,
    private readonly observabilityService: ObservabilityService,
  ) {}

  async getMyAchievements(userId: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.STUDENT_ACHIEVEMENTS)
      .select('*, achievement_definitions(*)')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch achievements: ${error.message}`);
      throw error;
    }
    return data ?? [];
  }

  async getMyCertificates(userId: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .select('*, courses(name)')
      .eq('user_id', userId)
      .order('issued_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch certificates: ${error.message}`);
      throw error;
    }
    return data ?? [];
  }

  async checkAndAward(userId: string, batchId: string) {
    const awarded: string[] = [];

    const { data: achievements } = await this.supabaseService.client
      .from(TABLES.ACHIEVEMENT_DEFINITIONS)
      .select('*');

    const recordingCompletedCount = await this.countCompletedRecordings(userId);
    const { data: certificates } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .select('id')
      .eq('user_id', userId);
    const courseCompleteCount = (certificates ?? []).length;

    const { data: testResults } = await this.supabaseService.client
      .from(TABLES.TEST_RESULTS)
      .select('percentage')
      .eq('user_id', userId);
    const perfectTestCount = (testResults ?? []).filter((r: any) => Number(r.percentage) >= 100).length;

    for (const ach of achievements ?? []) {
      const { data: existing } = await this.supabaseService.client
        .from(TABLES.STUDENT_ACHIEVEMENTS)
        .select('id')
        .eq('user_id', userId)
        .eq('achievement_id', ach.id)
        .maybeSingle();

      if (existing) continue;

      let earned = false;
      const criteria = (ach as any).criteria ?? {};
      const type = criteria.type as string;
      const count = (criteria.count as number) ?? 1;

      if (type === 'video_count' && recordingCompletedCount >= count) earned = true;
      if (type === 'perfect_test' && perfectTestCount >= count) earned = true;
      if (type === 'course_complete' && courseCompleteCount >= count) earned = true;

      if (earned) {
        const { error } = await this.supabaseService.client
          .from(TABLES.STUDENT_ACHIEVEMENTS)
          .insert({ user_id: userId, achievement_id: ach.id, batch_id: batchId });

        if (!error) {
          awarded.push((ach as any).key);
          logEntityEvent(
            this.observabilityService,
            'ACHIEVEMENT_AWARDED',
            'achievement',
            ach.id,
            userId,
            { achievementKey: (ach as any).key, batchId },
          ).catch(() => {});
        }
      }
    }

    return { awarded };
  }

  async issueCertificate(userId: string, courseId: string, batchId?: string) {
    const { data: existing } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .select('id, certificate_number, issued_at')
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (existing) return existing;

    const certNumber = `CERT-${Date.now().toString(36).toUpperCase()}-${userId.slice(0, 6).toUpperCase()}`;

    const { data, error } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .insert({
        user_id: userId,
        course_id: courseId,
        batch_id: batchId ?? null,
        certificate_number: certNumber,
      })
      .select('*, courses(name)')
      .single();

    if (error) {
      if ((error as any).code === '23505') {
        const { data: retry } = await this.supabaseService.client
          .from(TABLES.CERTIFICATES)
          .select('id, certificate_number, issued_at')
          .eq('user_id', userId)
          .eq('course_id', courseId)
          .maybeSingle();

        if (retry) return retry;
      }

      this.logger.error(`Failed to issue certificate: ${error.message}`);
      throw error;
    }

    // Phase 7D: Generate PDF + email in background (fire-and-forget)
    this.generateCertificatePdf(data.id, userId, courseId).catch((err) => {
      this.logger.warn(`Certificate PDF generation failed: ${err.message}`);
    });

    await this.checkAndAward(userId, batchId ?? '').catch((err) => {
      this.logger.warn(`Achievement check failed after certificate issuance: ${err.message}`);
    });

    logEntityEvent(
      this.observabilityService,
      'CERTIFICATE_ISSUED',
      'certificate',
      data.id,
      userId,
      { courseId, batchId, certificateNumber: data.certificate_number },
    ).catch(() => {});

    return data;
  }

  async verifyCertificate(token: string) {
    const { data: verification } = await this.supabaseService.client
      .from(TABLES.CERTIFICATE_VERIFICATIONS)
      .select('id, certificate_id, token, expires_at, verified_at')
      .eq('token', token)
      .maybeSingle();

    if (!verification) {
      throw new NotFoundException('Invalid verification token.');
    }

    const v = verification as any;

    if (v.verified_at) {
      return { status: 'already_verified', verifiedAt: v.verified_at };
    }

    if (v.expires_at && new Date(v.expires_at) < new Date()) {
      return { status: 'expired' };
    }

    // Mark as verified
    await this.supabaseService.client
      .from(TABLES.CERTIFICATE_VERIFICATIONS)
      .update({ verified_at: new Date().toISOString() })
      .eq('id', v.id);

    // Fetch certificate details
    const { data: cert } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .select('*, courses(name), profiles(name, email)')
      .eq('id', v.certificate_id)
      .single();

    return {
      status: 'verified',
      certificate: cert,
    };
  }

  async getVerificationStatus(certificateId: string) {
    const { data: cert } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .select('certificate_number, issued_at, courses(name), profiles(name)')
      .eq('id', certificateId)
      .maybeSingle();

    if (!cert) throw new NotFoundException('Certificate not found.');

    const { data: verification } = await this.supabaseService.client
      .from(TABLES.CERTIFICATE_VERIFICATIONS)
      .select('verified_at')
      .eq('certificate_id', certificateId)
      .maybeSingle();

    return {
      ...cert,
      verifiedAt: (verification as any)?.verified_at ?? null,
    };
  }

  async checkCourseCompletion(userId: string, batchId: string) {
    // Verify enrollment first — do not leak across batches
    const { data: enrollment } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId)
      .eq('batch_id', batchId)
      .maybeSingle();
    if (!enrollment) return { completed: false, reason: 'not_enrolled' };

    const { data: progress } = await this.supabaseService.client
      .from(TABLES.BATCH_CURRICULUM_ITEM_PROGRESS)
      .select('curriculum_id, completed')
      .eq('user_id', userId);

    const { data: curriculum } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('id')
      .eq('batch_id', batchId);

    const completedIds = new Set(
      (progress ?? []).filter((p: any) => p.completed).map((p: any) => p.curriculum_id),
    );
    const allIds = new Set((curriculum ?? []).map((c: any) => c.id));

    const allCompleted = [...allIds].every((id) => completedIds.has(id));

    if (allCompleted && curriculum?.length) {
      const { data: batch } = await this.supabaseService.client
        .from(TABLES.BATCHES)
        .select('course_id')
        .eq('id', batchId)
        .single();

      if (batch) {
        return this.issueCertificate(userId, (batch as any).course_id, batchId);
      }
    }

    return { completed: allCompleted };
  }

  // ── Phase 7D: Certificate PDF Generation ────────────────────

  async generateCertificatePdf(certificateId: string, userId: string, courseId: string) {
    const { data: cert } = await this.supabaseService.client
      .from(TABLES.CERTIFICATES)
      .select('*, courses(name), profiles(name, email)')
      .eq('id', certificateId)
      .single();

    if (!cert) {
      this.logger.warn(`Certificate ${certificateId} not found for PDF generation`);
      return;
    }

    const c = cert as any;
    const templateSource = this.readTemplate('certificate.template.hbs');
    const template = Handlebars.compile(templateSource);

    // Create verification token first so verifyUrl uses real token, not cert id
    let verifyToken: string | null = null;
    try {
      const { data: vt } = await this.supabaseService.client
        .from(TABLES.CERTIFICATE_VERIFICATIONS)
        .insert({ certificate_id: certificateId })
        .select('token')
        .single();
      verifyToken = (vt as any)?.token ?? null;
    } catch { /* fallback below */ }
    if (!verifyToken) {
      const { data: existing } = await this.supabaseService.client
        .from(TABLES.CERTIFICATE_VERIFICATIONS)
        .select('token')
        .eq('certificate_id', certificateId)
        .maybeSingle();
      verifyToken = (existing as any)?.token ?? c.id;
    }
    // Fetch BusinessConfig for presentation (locale/timezone/businessName)
    let certBiz: any = null;
    try {
      const { data: bizData } = await this.supabaseService.client
        .from(TABLES.BUSINESS_CONFIG)
        .select('*')
        .limit(1)
        .maybeSingle();
      certBiz = bizData ?? null;
    } catch { /* fallback to defaults */ }
    const certLocale = certBiz?.locale ?? DEFAULT_LOCALE;
    const certTimezone = certBiz?.timezone ?? DEFAULT_TIMEZONE;
    const certBusinessName = certBiz?.business_name ?? 'LMS Platform';
    let issueDateStr: string;
    try {
      issueDateStr = new Date(c.issued_at).toLocaleDateString(certLocale, {
        timeZone: certTimezone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      issueDateStr = new Date(c.issued_at).toLocaleDateString(DEFAULT_LOCALE, {
        timeZone: DEFAULT_TIMEZONE,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    const html = template({
      studentName: c.profiles?.name ?? 'Student',
      courseName: c.courses?.name ?? 'Course',
      issueDate: issueDateStr,
      certificateNumber: c.certificate_number,
      verifyUrl: `${this.getFrontendUrl()}/verify-certificate?token=${verifyToken}`,
      businessName: certBusinessName,
    });

    try {
      const pdfBuffer = await this.pdfService.generatePdf(html);

      const pdfPath = `certificates/${certificateId}.pdf`;
      await this.supabaseService.client
        .from(TABLES.CERTIFICATES)
        .update({ pdf_path: pdfPath, pdf_generated: true })
        .eq('id', certificateId);

      // Send email with PDF
      const studentEmail = (c as any).profiles?.email;
      if (studentEmail) {
        await this.emailService.sendEmail(
          studentEmail,
          `Certificate of Completion — ${c.courses?.name ?? 'Course'}`,
          `<p>Dear ${c.profiles?.name ?? 'Student'},</p>
            <p>Congratulations on completing <strong>${c.courses?.name ?? 'Course'}</strong>!</p>
            <p>Your certificate (${c.certificate_number}) is attached to this email.</p>
            <p>You can also verify your certificate at any time: <a href="${this.getFrontendUrl()}/verify-certificate?token=${verifyToken}">Verify Certificate</a></p>
            <p>— MCT Learn Team</p>`,
          [{ filename: `Certificate-${c.certificate_number}.pdf`, content: pdfBuffer }],
        );
      }

      await this.supabaseService.client
        .from(TABLES.CERTIFICATES)
        .update({ email_sent: true, email_sent_at: new Date().toISOString() })
        .eq('id', certificateId);
    } catch (err: any) {
      this.logger.error(`Certificate PDF generation failed: ${err.message}`);
    }
  }

  private async createVerificationToken(certificateId: string) {
    const { error } = await this.supabaseService.client
      .from(TABLES.CERTIFICATE_VERIFICATIONS)
      .insert({
        certificate_id: certificateId,
      });

    if (error) {
      this.logger.warn(`Failed to create verification token: ${error.message}`);
    }
  }

  private readTemplate(fileName: string): string {
    const devPath = path.join(
      process.cwd(),
      'apps',
      'api',
      'src',
      'modules',
      'achievements',
      'templates',
      fileName,
    );

    const prodPath = path.join(
      __dirname,
      '..',
      'achievements',
      'templates',
      fileName,
    );

    const resolvedPath = fs.existsSync(prodPath) ? prodPath : devPath;

    try {
      return fs.readFileSync(resolvedPath, 'utf-8');
    } catch {
      this.logger.warn(`Template ${fileName} not found at ${resolvedPath}, trying dev path`);
      return fs.readFileSync(devPath, 'utf-8');
    }
  }

  private getFrontendUrl(): string {
    return process.env.FRONTEND_URL ?? 'http://localhost:3000';
  }

  private async countCompletedRecordings(userId: string): Promise<number> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCH_CURRICULUM_ITEM_PROGRESS)
      .select('curriculum_id')
      .eq('user_id', userId)
      .eq('completed', true);

    if (error || !data || data.length === 0) return 0;

    const curriculumIds = data.map((p: any) => p.curriculum_id);

    const { data: items } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('id')
      .in('id', curriculumIds)
      .eq('content_type', 'recording');

    return (items ?? []).length;
  }
}
