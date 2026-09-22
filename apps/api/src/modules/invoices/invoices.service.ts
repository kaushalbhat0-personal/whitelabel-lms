import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { PdfGenerationService } from '../pdf/pdf-generation.service';
import { ObservabilityService } from '../observability/observability.service';
import { TABLES } from '../../common/constants/tables.constant';
import { logEntityEvent } from '../../common/utils/observability-helper';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
    private readonly pdfService: PdfGenerationService,
    private readonly observabilityService: ObservabilityService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  //  calculateFinancialYear
  // ──────────────────────────────────────────────────────────────

  /**
   * Calculate the Indian financial year string (e.g. "2025-26").
   *
   * Logic:
   *   - Indian FY starts in April (JS month index 3).
   *   - If current month >= 3 (April), FY = YYYY-(YY+1).
   *   - If current month < 3 (Jan-Mar), FY = (YYYY-1)-YY.
   *
   * Examples:
   *   - May 2025  → "2025-26"
   *   - Jan 2026  → "2025-26"
   *   - Apr 2026  → "2026-27"
   */
  calculateFinancialYear(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (month >= 3) {
      const shortNext = (year + 1).toString().slice(-2);
      return `${year}-${shortNext}`;
    }

    const shortCurr = year.toString().slice(-2);
    return `${year - 1}-${shortCurr}`;
  }

  // ──────────────────────────────────────────────────────────────
  //  getNextDocumentNumber (atomic via invoice_sequences)
  // ──────────────────────────────────────────────────────────────

  /**
   * Atomically allocate the next document sequence number using the
   * dedicated invoice_sequences table with an atomic UPDATE ... RETURNING.
   *
   * This eliminates the race condition in the previous approach that
   * read-from, incremented, and wrote-back to business_config.
   *
   * Format: {prefix}-{FY}-{NNNN}  (6-digit zero-padded)
   *   e.g. "MCT-INV-2025-26-000001"
   *
   * If the invoice_sequences row does not exist for this type + FY,
   * a fallback to business_config is used for backward compatibility.
   */
  async getNextDocumentNumber(
    type: 'INVOICE' | 'RECEIPT',
  ): Promise<{ formatted: string; rawNumber: number }> {
    const supabase = this.supabaseService.client;
    const fy = this.calculateFinancialYear();
    const isInvoice = type === 'INVOICE';

    // Atomic UPDATE ... RETURNING: guaranteed unique, no race condition
    const { data, error } = await supabase
      .rpc('increment_sequence', {
        p_sequence_type: type,
        p_fiscal_year: fy,
      });

    if (!error && data) {
      const rawNumber = Number(data);
      const prefix = isInvoice ? 'MCT-INV' : 'MCT-RCP';
      const formatted = `${prefix}-${fy}-${String(rawNumber).padStart(6, '0')}`;
      return { formatted, rawNumber };
    }

    // Fallback: try direct upsert (creates row if not exists)
    if (error && (error as any).code === 'PGRST116') {
      const { data: existing } = await supabase
        .from('invoice_sequences')
        .select('counter')
        .eq('sequence_type', type)
        .eq('fiscal_year', fy)
        .maybeSingle();

      if (existing) {
        const newCounter = (existing as any).counter + 1;
        const { error: updateErr } = await supabase
          .from('invoice_sequences')
          .update({ counter: newCounter, updated_at: new Date().toISOString() })
          .eq('sequence_type', type)
          .eq('fiscal_year', fy);

        if (!updateErr) {
          const prefix = isInvoice ? 'MCT-INV' : 'MCT-RCP';
          const formatted = `${prefix}-${fy}-${String(newCounter).padStart(6, '0')}`;
          return { formatted, rawNumber: newCounter };
        }
      }

      // Row does not exist — create it
      const initialCounter = 1;
      const { error: insertErr } = await supabase
        .from('invoice_sequences')
        .insert({ sequence_type: type, fiscal_year: fy, counter: initialCounter });

      if (!insertErr) {
        const prefix = isInvoice ? 'MCT-INV' : 'MCT-RCP';
        const formatted = `${prefix}-${fy}-${String(initialCounter).padStart(6, '0')}`;
        return { formatted, rawNumber: initialCounter };
      }
    }

    // Last resort: legacy business_config fallback
    const { data: config, error: cfgError } = await supabase
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    if (cfgError || !config) {
      this.logger.error('Business config not found — cannot generate document number');
      throw new BadRequestException(
        'Business configuration is missing. Run the seed script first.',
      );
    }

    const cfg = config as any;
    const prefix = isInvoice ? cfg.invoice_prefix : cfg.receipt_prefix;
    const counterField = isInvoice ? 'next_invoice_number' : 'next_receipt_number';
    const currentNumber = cfg[counterField];

    const { error: updateError } = await supabase
      .from(TABLES.BUSINESS_CONFIG)
      .update({ [counterField]: currentNumber + 1 })
      .eq('id', cfg.id);

    if (updateError) {
      this.logger.error(`Failed to increment ${counterField}: ${updateError.message}`);
      throw new BadRequestException('Failed to generate document number');
    }

    const formatted = `${prefix}-${fy}-${String(currentNumber).padStart(6, '0')}`;
    return { formatted, rawNumber: currentNumber };
  }

  // ──────────────────────────────────────────────────────────────
  //  generatePdf (delegated to PdfGenerationService)
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate a PDF from HTML using the shared PdfGenerationService.
   * Handles timeout and error gracefully — never crashes the process.
   */
  async generatePdf(html: string): Promise<Buffer> {
    try {
      return await this.pdfService.generatePdf(html);
    } catch (err: any) {
      this.logger.error(`PDF generation failed: ${err.message}`);
      throw new InternalServerErrorException('Failed to generate PDF. Is Chrome/Puppeteer installed?');
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  readTemplate
  // ──────────────────────────────────────────────────────────────

  /**
   * Read a Handlebars template file.
   *
   * First tries the path relative to __dirname (production / dist/ layout),
   * then falls back to the project source path (dev mode).
   */
  private readTemplate(fileName: string): string {
    const devPath = path.join(
      process.cwd(),
      'apps',
      'api',
      'src',
      'modules',
      'invoices',
      'templates',
      fileName,
    );

    const prodPath = path.join(
      __dirname,
      '..',
      'invoices',
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

  // ──────────────────────────────────────────────────────────────
  //  calculateGstSplit
  // ──────────────────────────────────────────────────────────────

  /**
   * Split a total amount (inclusive of 18% GST) into Base, CGST, SGST.
   *
   * The admin-facing price (payment amount) already includes 18% GST.
   *   - Base  = Total / 1.18
   *   - CGST  = Base × 0.09  (9%)
   *   - SGST  = Base × 0.09  (9%)
   *
   * All values are rounded to 2 decimal places.
   */
  private calculateGstSplit(totalAmount: number): {
    baseAmount: number;
    cgstAmount: number;
    sgstAmount: number;
  } {
    const baseAmount = +(totalAmount / 1.18).toFixed(2);
    const cgstAmount = +(baseAmount * 0.09).toFixed(2);
    const sgstAmount = +(baseAmount * 0.09).toFixed(2);
    return { baseAmount, cgstAmount, sgstAmount };
  }

  // ──────────────────────────────────────────────────────────────
  //  uploadPdf
  // ──────────────────────────────────────────────────────────────

  /**
   * Upload a PDF buffer to Supabase Storage under the `invoices` bucket.
   *
   * Path: {type}s/{studentId}/{documentNumber}.pdf
   *   e.g. receipts/abc-123/MCT-RCP-2025-26-0001.pdf
   */
  private async uploadPdf(
    pdfBuffer: Buffer,
    storagePath: string,
  ): Promise<string> {
    const bucketName = 'invoices';

    const { error: uploadError } = await this.supabaseService.client
      .storage
      .from(bucketName)
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      this.logger.error(`Failed to upload PDF to storage: ${uploadError.message}`);
      return '';
    }

    // Generate a signed URL valid for 7 days
    const { data: signedUrl } = await this.supabaseService.client
      .storage
      .from(bucketName)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    return signedUrl?.signedUrl ?? '';
  }

  // ──────────────────────────────────────────────────────────────
  //  createAndSendReceipt
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate, store, and email a Payment Receipt for an installment payment.
   *
   * Flow:
   *   1. Fetch the payment record with student + course joins.
   *   2. Read business_config for address, GSTIN, etc.
   *   3. Get the next receipt number.
   *   4. Calculate GST breakdown (inclusive 18% GST).
   *   5. Compile the receipt Handlebars template.
   *   6. Generate the PDF via Puppeteer.
   *   7. Upload PDF to Supabase Storage.
   *   8. Insert the receipt record into TABLES.RECEIPTS.
   *   9. Email the PDF to the student.
   *  10. Update the receipt record with email_sent_at and email_sent_to.
   */
  async createAndSendReceipt(paymentId: string): Promise<void> {
    // 0. Idempotency — one receipt per payment (uq_receipts_payment_id)
    // Outbox retry or duplicate enqueue must not create a second receipt.
    const { data: existingReceipt } = await this.supabaseService.client
      .from(TABLES.RECEIPTS)
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (existingReceipt) {
      this.logger.log(`Receipt already exists for payment ${paymentId} — skipping duplicate generation`);
      return;
    }

    // 1. Fetch payment
    const { data: payment, error: payError } = await this.supabaseService.client
      .from(TABLES.PAYMENTS)
      .select('*, student:profiles!student_id(*), course:courses!course_id(*)')
      .eq('id', paymentId)
      .single();

    if (payError || !payment) {
      this.logger.error(`Payment ${paymentId} not found: ${payError?.message}`);
      throw new NotFoundException('Payment not found');
    }

    const pay = payment as any;
    const student = pay.student;
    const course = pay.course;

    // Null-safe labels for missing relations
    const studentName = student?.name ?? 'Unknown Student';
    const studentEmail = student?.email ?? 'unknown@email.com';
    const courseName = course?.name ?? 'Unknown Course';
    const studentId = student?.id ?? pay.student_id ?? 'unknown';
    const courseId = course?.id ?? pay.course_id ?? 'unknown';

    // 2. Fetch business config
    const { data: bizCfg } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    const biz = bizCfg as any;
    const { baseAmount, cgstAmount, sgstAmount } = this.calculateGstSplit(pay.amount);

    // 3. Get receipt number
    const { formatted: receiptNumber, rawNumber } = await this.getNextDocumentNumber('RECEIPT');

    logEntityEvent(
      this.observabilityService,
      'INVOICE_GENERATED',
      'receipt',
      receiptNumber,
      pay.recorded_by ?? 'system',
      { studentId, courseId, amount: pay.amount, paymentId },
    ).catch(() => {});

    // 4. Compile template
    const templateSource = this.readTemplate('receipt.template.hbs');
    const template = Handlebars.compile(templateSource);
    const dateStr = new Date().toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const html = template({
      receiptNumber,
      date: dateStr,
      studentName,
      studentEmail,
      courseName,
      installmentNumber: pay.installment_id ? `Installment` : undefined,
      paymentMethod: pay.payment_method,
      transactionId: pay.transaction_id,
      baseAmount: baseAmount.toFixed(2),
      cgstAmount: cgstAmount.toFixed(2),
      sgstAmount: sgstAmount.toFixed(2),
      totalAmount: pay.amount.toFixed(2),
      businessName: biz?.business_name ?? 'Business Name',
      businessAddress: `${biz?.address_line_1 ?? ''}, ${biz?.city ?? ''}, ${biz?.state ?? ''} ${biz?.pincode ?? ''}`,
      businessGst: biz?.gstin ?? '',
      businessPan: biz?.pan ?? '',
      businessLogo: biz?.logo_url ?? '',
    });

    // 5. Generate PDF
    const pdfBuffer = await this.generatePdf(html);

    // 6. Upload to storage
    const storagePath = `receipts/${studentId}/${receiptNumber}.pdf`;
    const pdfUrl = await this.uploadPdf(pdfBuffer, storagePath);

    // 7. Insert receipt record
    const { error: insertError } = await this.supabaseService.client
      .from(TABLES.RECEIPTS)
      .insert({
        receipt_number: receiptNumber,
        student_id: studentId,
        course_id: courseId,
        payment_id: paymentId,
        installment_id: pay.installment_id ?? null,
        amount: pay.amount,
        issued_on: new Date().toISOString().split('T')[0],
        pdf_url: pdfUrl || null,
        generated_by: pay.recorded_by,
      });

    if (insertError) {
      // Unique violation (23505) means concurrent retry already inserted receipt — treat as idempotent success
      if ((insertError as any).code === '23505' || insertError.message?.includes('uq_receipts_payment_id') || insertError.message?.includes('duplicate key')) {
        this.logger.warn(`Receipt insert conflict for payment ${paymentId} — concurrent duplicate, treating as success`);
        return;
      }
      this.logger.error(`Failed to insert receipt record: ${insertError.message}`);
    }

    // 8. Email (P2 keeps automatic email; P3 will separate)
    const emailSent = await this.emailService.sendEmail(
      student.email,
      `Payment Receipt — ${receiptNumber}`,
      `<p>Dear ${student.name},</p>
<p>Please find attached your payment receipt for <strong>${course.name}</strong>.</p>
<p>Receipt No: <strong>${receiptNumber}</strong></p>
<p>Amount Paid: <strong>&#x20B9; ${pay.amount.toFixed(2)}</strong></p>`,
      [
        {
          filename: `${receiptNumber}.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    );

    // 9. Update email_sent fields
    if (emailSent) {
      await this.supabaseService.client
        .from(TABLES.RECEIPTS)
        .update({
          email_sent_at: new Date().toISOString(),
          email_sent_to: student.email,
        })
        .eq('receipt_number', receiptNumber);
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  createAndSendInvoice
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate, store, and email a Tax Invoice for a full payment.
   *
   * Mirror of createAndSendReceipt, but uses:
   *   - invoice template
   *   - invoice numbering
   *   - TABLES.INVOICES
   *
   * Flow is identical to createAndSendReceipt (see above).
   */
  async createAndSendInvoice(paymentId: string): Promise<void> {
    // 1. Fetch payment
    const { data: payment, error: payError } = await this.supabaseService.client
      .from(TABLES.PAYMENTS)
      .select('*, student:profiles!student_id(*), course:courses!course_id(*)')
      .eq('id', paymentId)
      .single();

    if (payError || !payment) {
      this.logger.error(`Payment ${paymentId} not found: ${payError?.message}`);
      throw new NotFoundException('Payment not found');
    }

    const pay = payment as any;
    const student = pay.student;
    const course = pay.course;

    // Null-safe labels for missing relations
    const studentName = student?.name ?? 'Unknown Student';
    const studentEmail = student?.email ?? 'unknown@email.com';
    const courseName = course?.name ?? 'Unknown Course';
    const studentId = student?.id ?? pay.student_id ?? 'unknown';
    const courseId = course?.id ?? pay.course_id ?? 'unknown';

    // 2. Fetch business config
    const { data: bizCfg } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    const biz = bizCfg as any;
    const { baseAmount, cgstAmount, sgstAmount } = this.calculateGstSplit(pay.amount);

    // 3. Get invoice number
    const { formatted: invoiceNumber } = await this.getNextDocumentNumber('INVOICE');

    logEntityEvent(
      this.observabilityService,
      'INVOICE_GENERATED',
      'invoice',
      invoiceNumber,
      pay.recorded_by ?? 'system',
      { studentId, courseId, amount: pay.amount, paymentId },
    ).catch(() => {});

    // 4. Compile template
    const templateSource = this.readTemplate('invoice.template.hbs');
    const template = Handlebars.compile(templateSource);
    const dateStr = new Date().toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const html = template({
      invoiceNumber,
      date: dateStr,
      studentName,
      studentEmail,
      courseName,
      paymentMethod: pay.payment_method,
      transactionId: pay.transaction_id,
      baseAmount: baseAmount.toFixed(2),
      cgstAmount: cgstAmount.toFixed(2),
      sgstAmount: sgstAmount.toFixed(2),
      totalAmount: pay.amount.toFixed(2),
      businessName: biz?.business_name ?? 'Business Name',
      businessAddress: `${biz?.address_line_1 ?? ''}, ${biz?.city ?? ''}, ${biz?.state ?? ''} ${biz?.pincode ?? ''}`,
      businessGst: biz?.gstin ?? '',
      businessPan: biz?.pan ?? '',
      businessLogo: biz?.logo_url ?? '',
    });

    // 5. Generate PDF
    const pdfBuffer = await this.generatePdf(html);

    // 6. Upload to storage
    const storagePath = `invoices/${studentId}/${invoiceNumber}.pdf`;
    const pdfUrl = await this.uploadPdf(pdfBuffer, storagePath);

    // 7. Insert invoice record
    const { baseAmount: subTotal, cgstAmount: cgst, sgstAmount: sgst } =
      this.calculateGstSplit(pay.amount);

    const { error: insertError } = await this.supabaseService.client
      .from(TABLES.INVOICES)
      .insert({
        invoice_number: invoiceNumber,
        student_id: studentId,
        course_id: courseId,
        payment_id: paymentId,
        subtotal: subTotal,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: 0,
        total_amount: pay.amount,
        gst_applicable: true,
        issued_on: new Date().toISOString().split('T')[0],
        pdf_url: pdfUrl || null,
        generated_by: pay.recorded_by,
      });

    if (insertError) {
      this.logger.error(`Failed to insert invoice record: ${insertError.message}`);
    }

    // 8. Email
    const emailSent = await this.emailService.sendEmail(
      student.email,
      `Tax Invoice — ${invoiceNumber}`,
      `<p>Dear ${student.name},</p>
<p>Please find attached your tax invoice for <strong>${course.name}</strong>.</p>
<p>Invoice No: <strong>${invoiceNumber}</strong></p>
<p>Total Amount: <strong>&#x20B9; ${pay.amount.toFixed(2)}</strong></p>`,
      [
        {
          filename: `${invoiceNumber}.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    );

    // 9. Update email_sent fields
    if (emailSent) {
      await this.supabaseService.client
        .from(TABLES.INVOICES)
        .update({
          email_sent_at: new Date().toISOString(),
          email_sent_to: student.email,
        })
        .eq('invoice_number', invoiceNumber);

      logEntityEvent(
        this.observabilityService,
        'INVOICE_SENT',
        'invoice',
        invoiceNumber,
        pay.recorded_by ?? 'system',
        { studentId, studentEmail: student.email, paymentId },
      ).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  getDownloadUrl
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate a signed URL to download an invoice or receipt PDF.
   *
   * Looks up the record in both TABLES.INVOICES and TABLES.RECEIPTS
   * to find which table the ID belongs to.
   */
  async getDownloadUrl(id: string): Promise<{ url: string; fileName: string }> {
    // Try invoices first
    const { data: invoice } = await this.supabaseService.client
      .from(TABLES.INVOICES)
      .select('*')
      .eq('id', id)
      .single();

    if (invoice) {
      const inv = invoice as any;
      if (!inv.pdf_url) {
        throw new BadRequestException('Invoice PDF has not been generated yet');
      }
      return { url: inv.pdf_url, fileName: `${inv.invoice_number}.pdf` };
    }

    // Try receipts
    const { data: receipt } = await this.supabaseService.client
      .from(TABLES.RECEIPTS)
      .select('*')
      .eq('id', id)
      .single();

    if (receipt) {
      const rcp = receipt as any;
      if (!rcp.pdf_url) {
        throw new BadRequestException('Receipt PDF has not been generated yet');
      }
      return { url: rcp.pdf_url, fileName: `${rcp.receipt_number}.pdf` };
    }

    throw new NotFoundException('Invoice or Receipt not found');
  }

  // ──────────────────────────────────────────────────────────────
  //  bulkGenerate (CSV-based)
  // ──────────────────────────────────────────────────────────────

  /**
   * Bulk-generate invoices or receipts from a CSV file.
   *
   * Expected CSV columns:
   *   studentEmail, courseId, amount, paymentDate, paymentMethod, transactionId, type
   *
   * type must be "INVOICE" or "RECEIPT".
   *
   * Uses a continue-on-error pattern.
   */
  async bulkGenerate(
    adminId: string,
    file: Express.Multer.File,
  ): Promise<{
    jobId: string;
    totalRows: number;
    successCount: number;
    failureCount: number;
    failures: { row: number; email: string; error: string }[];
  }> {
    const { parseUsersFile } = require('../../common/utils/file-parser.util');

    // Parse the generic rows (extend to handle CSV with more columns)
    const Papa = require('papaparse');
    const csvString = file.buffer.toString('utf-8');
    const result = Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });
    const rows = result.data as Record<string, any>[];

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty or has no valid rows');
    }

    // Validate required columns
    const requiredColumns = ['studentEmail', 'courseId', 'amount', 'type'];
    const headers = Object.keys(rows[0]);
    const missing = requiredColumns.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}. Expected: studentEmail, courseId, amount, paymentDate, paymentMethod, transactionId, type`,
      );
    }

    // Insert job record
    const { data: job, error: jobError } = await this.supabaseService.client
      .from(TABLES.BULK_UPLOAD_JOBS)
      .insert({
        job_type: 'invoices',
        uploaded_by: adminId,
        file_name: file.originalname,
        total_rows: 0,
        success_count: 0,
        failure_count: 0,
        status: 'processing',
        failures: null,
      })
      .select()
      .single();

    if (jobError) {
      this.logger.error(`Failed to create bulk job: ${jobError.message}`);
      throw new BadRequestException('Failed to create bulk job');
    }

    const jobId = (job as any).id;
    const totalRows = rows.length;
    let successCount = 0;
    const failures: { row: number; email: string; error: string }[] = [];

    await this.supabaseService.client
      .from(TABLES.BULK_UPLOAD_JOBS)
      .update({ total_rows: totalRows })
      .eq('id', jobId);

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is header and array is 0-indexed

      try {
        const studentEmail = row.studentEmail?.trim();
        const courseId = row.courseId?.trim();
        const amount = parseFloat(row.amount);
        const docType = row.type?.trim().toUpperCase();
        const paymentDate = row.paymentDate?.trim() || new Date().toISOString().split('T')[0];
        const paymentMethod = row.paymentMethod?.trim() || 'other';
        const transactionId = row.transactionId?.trim() || null;

        if (!studentEmail || !courseId || isNaN(amount) || !docType) {
          failures.push({
            row: rowNum,
            email: studentEmail || 'unknown',
            error: 'Missing required fields: studentEmail, courseId, amount, type',
          });
          continue;
        }

        if (!['INVOICE', 'RECEIPT'].includes(docType)) {
          failures.push({
            row: rowNum,
            email: studentEmail,
            error: `Invalid type "${docType}". Must be INVOICE or RECEIPT.`,
          });
          continue;
        }

        // Find student by email
        const { data: student } = await this.supabaseService.client
          .from(TABLES.PROFILES)
          .select('id, name, email')
          .eq('email', studentEmail)
          .single();

        if (!student) {
          failures.push({
            row: rowNum,
            email: studentEmail,
            error: 'Student not found with this email',
          });
          continue;
        }

        // Create a payment record
        const { data: payment, error: payError } = await this.supabaseService.client
          .from(TABLES.PAYMENTS)
          .insert({
            student_id: (student as any).id,
            course_id: courseId,
            amount,
            payment_method: paymentMethod,
            transaction_id: transactionId,
            paid_on: paymentDate,
            is_full_payment: docType === 'INVOICE',
            recorded_by: adminId,
          })
          .select()
          .single();

        if (payError || !payment) {
          failures.push({
            row: rowNum,
            email: studentEmail,
            error: `Payment creation failed: ${payError?.message}`,
          });
          continue;
        }

        // Generate the document
        if (docType === 'INVOICE') {
          await this.createAndSendInvoice((payment as any).id);
        } else {
          await this.createAndSendReceipt((payment as any).id);
        }

        successCount++;
      } catch (rowErr: any) {
        failures.push({
          row: rowNum,
          email: row.studentEmail ?? 'unknown',
          error: rowErr.message ?? 'Unknown error',
        });
      }
    }

    // Update job as completed
    await this.supabaseService.client
      .from(TABLES.BULK_UPLOAD_JOBS)
      .update({
        status: 'completed',
        success_count: successCount,
        failure_count: failures.length,
        failures: failures.length > 0 ? JSON.parse(JSON.stringify(failures)) : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return {
      jobId,
      totalRows,
      successCount,
      failureCount: failures.length,
      failures,
    };
  }
}
