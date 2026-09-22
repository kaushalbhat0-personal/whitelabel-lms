import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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

  /**
   * Create a receipt document for a payment — P3 split.
   * Generates PDF, uploads to Storage, persists receipt with storage_path.
   * Does NOT send email. Idempotent: returns existing if already present.
   */
  async createReceipt(paymentId: string): Promise<any> {
    // 0. Idempotency — one receipt per payment (uq_receipts_payment_id)
    const { data: existingReceipt } = await this.supabaseService.client
      .from(TABLES.RECEIPTS)
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (existingReceipt) {
      this.logger.log(`Receipt already exists for payment ${paymentId} — skipping duplicate generation`);
      return existingReceipt;
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

    const studentName = student?.name ?? 'Unknown Student';
    const studentEmail = student?.email ?? 'unknown@email.com';
    const courseName = course?.name ?? 'Unknown Course';
    const studentId = student?.id ?? pay.student_id ?? 'unknown';
    const courseId = course?.id ?? pay.course_id ?? 'unknown';

    const { data: bizCfg } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    const biz = bizCfg as any;
    const { baseAmount, cgstAmount, sgstAmount } = this.calculateGstSplit(pay.amount);

    // 3. Get receipt number AFTER guard (no leak on duplicate)
    const { formatted: receiptNumber } = await this.getNextDocumentNumber('RECEIPT');

    logEntityEvent(
      this.observabilityService,
      'INVOICE_GENERATED',
      'receipt',
      receiptNumber,
      pay.recorded_by ?? 'system',
      { studentId, courseId, amount: pay.amount, paymentId },
    ).catch(() => {});

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

    const pdfBuffer = await this.generatePdf(html);
    const storagePath = `receipts/${studentId}/${receiptNumber}.pdf`;
    const pdfUrl = await this.uploadPdf(pdfBuffer, storagePath);

    const { data: inserted, error: insertError } = await this.supabaseService.client
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
        storage_path: storagePath,
        generated_by: pay.recorded_by,
      })
      .select()
      .single();

    if (insertError) {
      if ((insertError as any).code === '23505' || insertError.message?.includes('uq_receipts_payment_id') || insertError.message?.includes('duplicate key')) {
        this.logger.warn(`Receipt insert conflict for payment ${paymentId} — concurrent duplicate, treating as success`);
        const { data: race } = await this.supabaseService.client.from(TABLES.RECEIPTS).select('id').eq('payment_id', paymentId).maybeSingle();
        return race ?? null;
      }
      this.logger.error(`Failed to insert receipt record: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to persist receipt');
    }

    return inserted;
  }

  /**
   * Explicit admin action: send existing receipt PDF via email.
   * Prefers storage_path download; legacy pdf_url fallback is controlled error.
   */
  async sendReceiptEmail(receiptId: string, _adminId: string): Promise<{ email_sent_to: string; email_sent_at: string }> {
    const { data: receipt, error } = await this.supabaseService.client
      .from(TABLES.RECEIPTS)
      .select('*')
      .eq('id', receiptId)
      .single();
    if (error || !receipt) throw new NotFoundException('Receipt not found');
    const r = receipt as any;

    if (!r.storage_path && !r.pdf_url) {
      throw new BadRequestException('Receipt has no stored document — cannot send');
    }

    const { data: payment } = await this.supabaseService.client
      .from(TABLES.PAYMENTS)
      .select('*, student:profiles!student_id(*), course:courses!course_id(*)')
      .eq('id', r.payment_id)
      .single();
    const pay: any = payment;
    const student = pay?.student ?? null;
    const courseName = pay?.course?.name ?? r.course_id ?? 'Course';
    const recipient = student?.email ?? r.email_sent_to ?? null;
    if (!recipient) throw new BadRequestException('Receipt has no recipient email');

    let pdfBuffer: Buffer | null = null;
    let filename = `${r.receipt_number}.pdf`;

    if (r.storage_path) {
      const { data: blob, error: dlErr } = await this.supabaseService.client.storage.from('invoices').download(r.storage_path);
      if (dlErr || !blob) {
        this.logger.error(`Failed to download receipt PDF from storage_path ${r.storage_path}: ${dlErr?.message}`);
        throw new BadRequestException('Stored receipt PDF not available for sending');
      }
      const ab = await (blob as any).arrayBuffer();
      pdfBuffer = Buffer.from(ab);
    } else {
      // Legacy fallback: try pdf_url fetch if still usable
      try {
        const res = await fetch(r.pdf_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        pdfBuffer = Buffer.from(ab);
      } catch (e: any) {
        throw new BadRequestException(`Legacy receipt has no storage_path and signed URL is expired/unreachable: ${e.message}`);
      }
    }

    const studentName = student?.name ?? 'Student';
    const html = `<p>Dear ${studentName},</p><p>Please find attached your payment receipt for <strong>${courseName}</strong>.</p><p>Receipt No: <strong>${r.receipt_number}</strong></p><p>Amount Paid: <strong>&#x20B9; ${Number(r.amount).toFixed(2)}</strong></p>`;

    const sent = await this.emailService.sendEmail(recipient, `Payment Receipt — ${r.receipt_number}`, html, [{ filename, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }]);

    if (!sent) {
      // Suppressed or provider failure — do not mark sent
      throw new ConflictException('Email not sent — recipient suppressed or email provider rejected the request');
    }

    const now = new Date().toISOString();
    await this.supabaseService.client.from(TABLES.RECEIPTS).update({ email_sent_at: now, email_sent_to: recipient }).eq('id', r.id);

    logEntityEvent(this.observabilityService, 'INVOICE_SENT', 'receipt', r.receipt_number, _adminId, { receiptId: r.id, recipient }).catch(() => {});

    return { email_sent_to: recipient, email_sent_at: now };
  }
  /**
   * Create an invoice document for a payment — P3 split (payment-level, P4 will be per-plan).
   * No email. Persists storage_path. Idempotent per payment.
   */
  async createInvoice(paymentId: string): Promise<any> {
    const { data: existing } = await this.supabaseService.client
      .from(TABLES.INVOICES)
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (existing) {
      this.logger.log(`Invoice already exists for payment ${paymentId} — skipping duplicate`);
      return existing;
    }

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

    const studentName = student?.name ?? 'Unknown Student';
    const studentEmail = student?.email ?? 'unknown@email.com';
    const courseName = course?.name ?? 'Unknown Course';
    const studentId = student?.id ?? pay.student_id ?? 'unknown';
    const courseId = course?.id ?? pay.course_id ?? 'unknown';

    const { data: bizCfg } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    const biz = bizCfg as any;
    const { baseAmount, cgstAmount, sgstAmount } = this.calculateGstSplit(pay.amount);

    const { formatted: invoiceNumber } = await this.getNextDocumentNumber('INVOICE');

    logEntityEvent(
      this.observabilityService,
      'INVOICE_GENERATED',
      'invoice',
      invoiceNumber,
      pay.recorded_by ?? 'system',
      { studentId, courseId, amount: pay.amount, paymentId },
    ).catch(() => {});

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

    const pdfBuffer = await this.generatePdf(html);
    const storagePath = `invoices/${studentId}/${invoiceNumber}.pdf`;
    const pdfUrl = await this.uploadPdf(pdfBuffer, storagePath);

    const { baseAmount: subTotal, cgstAmount: cgst, sgstAmount: sgst } = this.calculateGstSplit(pay.amount);

    const { data: inserted, error: insertError } = await this.supabaseService.client
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
        storage_path: storagePath,
        generated_by: pay.recorded_by,
      })
      .select()
      .single();

    if (insertError) {
      if ((insertError as any).code === '23505' || insertError.message?.includes('duplicate key')) {
        this.logger.warn(`Invoice insert conflict for payment ${paymentId} — concurrent duplicate`);
        const { data: race } = await this.supabaseService.client.from(TABLES.INVOICES).select('id').eq('payment_id', paymentId).maybeSingle();
        return race ?? null;
      }
      this.logger.error(`Failed to insert invoice record: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to persist invoice');
    }

    return inserted;
  }

  async sendInvoiceEmail(invoiceId: string, _adminId: string): Promise<{ email_sent_to: string; email_sent_at: string }> {
    const { data: invoice, error } = await this.supabaseService.client
      .from(TABLES.INVOICES)
      .select('*')
      .eq('id', invoiceId)
      .single();
    if (error || !invoice) throw new NotFoundException('Invoice not found');
    const inv = invoice as any;

    if (!inv.storage_path && !inv.pdf_url) {
      throw new BadRequestException('Invoice has no stored document — cannot send');
    }

    // P4 plan-level invoices have payment_id NULL, derive via payment_plan_id
    let student: any = null;
    let courseName: string = inv.course_id ?? 'Course';
    let recipient: string | null = null;

    if (inv.payment_plan_id) {
      const { data: plan } = await this.supabaseService.client
        .from(TABLES.PAYMENT_PLANS)
        .select('*, student:profiles!student_id(*), course:courses!course_id(*)')
        .eq('id', inv.payment_plan_id)
        .single();
      const pl: any = plan;
      student = pl?.student ?? null;
      courseName = pl?.course?.name ?? inv.course_id ?? 'Course';
      recipient = student?.email ?? inv.email_sent_to ?? null;
    } else {
      const { data: payment } = await this.supabaseService.client
        .from(TABLES.PAYMENTS)
        .select('*, student:profiles!student_id(*), course:courses!course_id(*)')
        .eq('id', inv.payment_id)
        .single();
      const pay: any = payment;
      student = pay?.student ?? null;
      courseName = pay?.course?.name ?? inv.course_id ?? 'Course';
      recipient = student?.email ?? inv.email_sent_to ?? null;
    }
    if (!recipient) throw new BadRequestException('Invoice has no recipient email');

    let pdfBuffer: Buffer | null = null;
    let filename = `${inv.invoice_number}.pdf`;

    if (inv.storage_path) {
      const { data: blob, error: dlErr } = await this.supabaseService.client.storage.from('invoices').download(inv.storage_path);
      if (dlErr || !blob) {
        this.logger.error(`Failed to download invoice PDF from storage_path ${inv.storage_path}: ${dlErr?.message}`);
        throw new BadRequestException('Stored invoice PDF not available for sending');
      }
      const ab = await (blob as any).arrayBuffer();
      pdfBuffer = Buffer.from(ab);
    } else {
      try {
        const res = await fetch(inv.pdf_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        pdfBuffer = Buffer.from(ab);
      } catch (e: any) {
        throw new BadRequestException(`Legacy invoice has no storage_path and signed URL is expired/unreachable: ${e.message}`);
      }
    }

    const studentName = student?.name ?? 'Student';
    const html = `<p>Dear ${studentName},</p><p>Please find attached your tax invoice for <strong>${courseName}</strong>.</p><p>Invoice No: <strong>${inv.invoice_number}</strong></p><p>Total Amount: <strong>&#x20B9; ${Number(inv.total_amount).toFixed(2)}</strong></p>`;

    const sent = await this.emailService.sendEmail(recipient, `Tax Invoice — ${inv.invoice_number}`, html, [{ filename, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }]);

    if (!sent) {
      throw new ConflictException('Email not sent — recipient suppressed or email provider rejected the request');
    }

    const now = new Date().toISOString();
    await this.supabaseService.client.from(TABLES.INVOICES).update({ email_sent_at: now, email_sent_to: recipient }).eq('id', inv.id);
    logEntityEvent(this.observabilityService, 'INVOICE_SENT', 'invoice', inv.invoice_number, _adminId, { invoiceId: inv.id, recipient }).catch(() => {});
    return { email_sent_to: recipient, email_sent_at: now };
  }

  /**
   * Create a full-course GST invoice for a COMPLETED payment plan — P4.
   * One invoice per plan (payment_plan_id unique). No email.
   * Uses payment_plans.total_amount snapshot, GST split inclusive 18%.
   */
  async createInvoiceForPlan(planId: string): Promise<any> {
    // Idempotency — one full-course invoice per plan
    const { data: existingPlanInvoice } = await this.supabaseService.client
      .from(TABLES.INVOICES)
      .select('id')
      .eq('payment_plan_id', planId)
      .maybeSingle();
    if (existingPlanInvoice) {
      this.logger.log(`Full-course invoice already exists for plan ${planId} — skipping duplicate`);
      return existingPlanInvoice;
    }

    const { data: plan, error: planErr } = await this.supabaseService.client
      .from(TABLES.PAYMENT_PLANS)
      .select('*, student:profiles!student_id(*), course:courses!course_id(*)')
      .eq('id', planId)
      .single();

    if (planErr || !plan) {
      this.logger.error(`Payment plan ${planId} not found for invoice: ${planErr?.message}`);
      throw new NotFoundException('Payment plan not found');
    }

    const p = plan as any;

    if (p.status !== 'completed') {
      this.logger.warn(`Plan ${planId} status is ${p.status}, not completed — still creating invoice but flagging`);
      // Allow creation for idempotency/testing; in production caller ensures COMPLETED
    }

    // Reconciliation: sum payments for plan vs agreed total (cents)
    const toCents = (n: number) => Math.round(Number(n) * 100);
    const { data: payments } = await this.supabaseService.client
      .from(TABLES.PAYMENTS)
      .select('amount')
      .eq('payment_plan_id', planId);

    const summedCents = (payments ?? []).reduce((s: number, r: any) => s + toCents(Number(r.amount)), 0);
    const totalCents = toCents(Number(p.total_amount));
    if (summedCents !== totalCents) {
      logEntityEvent(
        this.observabilityService,
        'FINANCIAL_MISMATCH',
        'payment_plan',
        planId,
        p.created_by ?? 'system',
        { summedPayments: summedCents / 100, agreedTotal: totalCents / 100, planId },
      ).catch(() => {});
      this.logger.warn(`FINANCIAL_MISMATCH plan ${planId}: sum ${summedCents / 100} vs agreed ${totalCents / 100}`);
    }

    const student = p.student;
    const course = p.course;
    const studentName = student?.name ?? 'Unknown Student';
    const studentEmail = student?.email ?? 'unknown@email.com';
    const courseName = course?.name ?? 'Unknown Course';
    const studentId = student?.id ?? p.student_id ?? 'unknown';
    const courseId = course?.id ?? p.course_id ?? 'unknown';

    const { data: bizCfg } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    const biz = bizCfg as any;
    const totalAmount = Number(p.total_amount);
    const { baseAmount, cgstAmount, sgstAmount } = this.calculateGstSplit(totalAmount);

    const { formatted: invoiceNumber } = await this.getNextDocumentNumber('INVOICE');

    logEntityEvent(
      this.observabilityService,
      'INVOICE_GENERATED',
      'invoice',
      invoiceNumber,
      p.created_by ?? 'system',
      { studentId, courseId, amount: totalAmount, planId, type: 'full_course' },
    ).catch(() => {});

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
      paymentMethod: '—',
      transactionId: undefined,
      baseAmount: baseAmount.toFixed(2),
      cgstAmount: cgstAmount.toFixed(2),
      sgstAmount: sgstAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      businessName: biz?.business_name ?? 'Business Name',
      businessAddress: `${biz?.address_line_1 ?? ''}, ${biz?.city ?? ''}, ${biz?.state ?? ''} ${biz?.pincode ?? ''}`,
      businessGst: biz?.gstin ?? '',
      businessPan: biz?.pan ?? '',
      businessLogo: biz?.logo_url ?? '',
    });

    const pdfBuffer = await this.generatePdf(html);
    const storagePath = `invoices/${studentId}/${invoiceNumber}.pdf`;
    const pdfUrl = await this.uploadPdf(pdfBuffer, storagePath);

    const { baseAmount: subTotal, cgstAmount: cgst, sgstAmount: sgst } = this.calculateGstSplit(totalAmount);

    const { data: inserted, error: insertError } = await this.supabaseService.client
      .from(TABLES.INVOICES)
      .insert({
        invoice_number: invoiceNumber,
        student_id: studentId,
        course_id: courseId,
        payment_id: null,
        payment_plan_id: planId,
        subtotal: subTotal,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: 0,
        total_amount: totalAmount,
        gst_applicable: true,
        issued_on: new Date().toISOString().split('T')[0],
        pdf_url: pdfUrl || null,
        storage_path: storagePath,
        generated_by: p.created_by,
      })
      .select()
      .single();

    if (insertError) {
      if ((insertError as any).code === '23505' || insertError.message?.includes('uq_invoices_payment_plan_id') || insertError.message?.includes('duplicate key')) {
        this.logger.warn(`Full-course invoice insert conflict for plan ${planId} — concurrent duplicate`);
        const { data: race } = await this.supabaseService.client.from(TABLES.INVOICES).select('id').eq('payment_plan_id', planId).maybeSingle();
        return race ?? null;
      }
      this.logger.error(`Failed to insert full-course invoice for plan ${planId}: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to persist full-course invoice');
    }

    return inserted;
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
      if (inv.storage_path) {
        const { data: signed } = await this.supabaseService.client.storage.from('invoices').createSignedUrl(inv.storage_path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) return { url: signed.signedUrl, fileName: `${inv.invoice_number}.pdf` };
      }
      if (inv.pdf_url) {
        return { url: inv.pdf_url, fileName: `${inv.invoice_number}.pdf` };
      }
      throw new BadRequestException('Invoice PDF has not been generated yet');
    }

    // Try receipts
    const { data: receipt } = await this.supabaseService.client
      .from(TABLES.RECEIPTS)
      .select('*')
      .eq('id', id)
      .single();

    if (receipt) {
      const rcp = receipt as any;
      if (rcp.storage_path) {
        const { data: signed } = await this.supabaseService.client.storage.from('invoices').createSignedUrl(rcp.storage_path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) return { url: signed.signedUrl, fileName: `${rcp.receipt_number}.pdf` };
      }
      if (rcp.pdf_url) {
        return { url: rcp.pdf_url, fileName: `${rcp.receipt_number}.pdf` };
      }
      throw new BadRequestException('Receipt PDF has not been generated yet');
    }

    throw new NotFoundException('Invoice or Receipt not found');
  }

  async listReceipts(studentId?: string): Promise<any[]> {
    let q = this.supabaseService.client.from(TABLES.RECEIPTS).select('*').order('created_at', { ascending: false });
    if (studentId) q = q.eq('student_id', studentId);
    const { data, error } = await q;
    if (error) throw new BadRequestException('Failed to list receipts');
    return data ?? [];
  }

  async listInvoices(studentId?: string): Promise<any[]> {
    let q = this.supabaseService.client.from(TABLES.INVOICES).select('*').order('created_at', { ascending: false });
    if (studentId) q = q.eq('student_id', studentId);
    const { data, error } = await q;
    if (error) throw new BadRequestException('Failed to list invoices');
    return data ?? [];
  }

  async getReceiptByPaymentId(paymentId: string): Promise<any | null> {
    const { data } = await this.supabaseService.client.from(TABLES.RECEIPTS).select('*').eq('payment_id', paymentId).maybeSingle();
    return data ?? null;
  }

  async getInvoiceByPaymentId(paymentId: string): Promise<any | null> {
    const { data } = await this.supabaseService.client.from(TABLES.INVOICES).select('*').eq('payment_id', paymentId).maybeSingle();
    return data ?? null;
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

        // Generate the document (P3: creation only, no email)
        if (docType === 'INVOICE') {
          await this.createInvoice((payment as any).id);
        } else {
          await this.createReceipt((payment as any).id);
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
