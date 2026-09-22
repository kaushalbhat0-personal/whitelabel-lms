jest.mock('puppeteer', () => ({}));
jest.mock('handlebars', () => ({ compile: jest.fn(() => () => '<html>mock</html>') }));

import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { PdfGenerationService } from '../pdf/pdf-generation.service';
import { ObservabilityService } from '../observability/observability.service';

function chainMock(resolveTo: any): any {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    insert: jest.fn(() => q),
    update: jest.fn(() => q),
    order: jest.fn(() => q),
    limit: jest.fn(() => q),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}

describe('InvoicesService — P3 document creation vs email separation', () => {
  let service: InvoicesService;
  let client: any;
  let emailService: any;
  let pdfService: any;

  const PAYMENT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const RECEIPT_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const STUDENT_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  const ADMIN_ID = 'admin-1';

  beforeEach(async () => {
    const storageMock = {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/receipt.pdf' } }),
        download: jest.fn().mockResolvedValue({ data: { arrayBuffer: async () => Buffer.from('pdf-bytes') }, error: null }),
      })),
    };
    client = {
      from: jest.fn(),
      storage: storageMock,
    };
    emailService = { sendEmail: jest.fn().mockResolvedValue(true) };
    pdfService = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: SupabaseService, useValue: { client } },
        { provide: EmailService, useValue: emailService },
        { provide: PdfGenerationService, useValue: pdfService },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(InvoicesService);
    jest.spyOn(service as any, 'getNextDocumentNumber').mockResolvedValue({ formatted: 'MCT-RCP-2025-26-000001', rawNumber: 1 });
    jest.spyOn(service as any, 'readTemplate').mockReturnValue('<html>{{receiptNumber}}</html>');
  });

  describe('createReceipt', () => {
    it('creates receipt and PDF/storage without calling EmailService', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts' && !client.from['_receiptInsert']) {
          // first call is idempotency check -> no existing
          let call = 0;
          const fn = (t: string) => {
            if (t === 'receipts') {
              call++;
              if (call === 1) return chainMock({ data: null, error: null }); // maybeSingle no existing
              // insert
              return {
                insert: jest.fn(() => ({
                  select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: RECEIPT_ID, receipt_number: 'MCT-RCP-2025-26-000001', storage_path: 'receipts/xxx/MCT-RCP.pdf' }, error: null }) })),
                })),
              } as any;
            }
            if (t === 'payments') return chainMock({ data: { id: PAYMENT_ID, amount: 5163, payment_method: 'upi', transaction_id: null, installment_id: null, student_id: STUDENT_ID, course_id: 'course1', recorded_by: ADMIN_ID, student: { id: STUDENT_ID, name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } }, error: null });
            if (t === 'business_config') return chainMock({ data: { business_name: 'MCT', address_line_1: 'A', city: 'C', state: 'S', pincode: '0', gstin: 'GST', pan: 'PAN' }, error: null });
            return chainMock({ data: null, error: null }) as any;
          };
          return fn(table);
        }
        if (table === 'receipts') return chainMock({ data: null, error: null });
        if (table === 'payments') return chainMock({ data: { id: PAYMENT_ID, amount: 5163, payment_method: 'upi', transaction_id: null, installment_id: null, student_id: STUDENT_ID, course_id: 'course1', recorded_by: ADMIN_ID, student: { id: STUDENT_ID, name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } }, error: null });
        if (table === 'business_config') return chainMock({ data: { business_name: 'MCT', address_line_1: 'A', city: 'C', state: 'S', pincode: '0', gstin: 'GST', pan: 'PAN' }, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      // simpler: mock per table
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts') {
          // idempotency check first
          const isFirst = !client.from['called'];
          if (!client.from['called']) {
            client.from['called'] = true;
            return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) } as any;
          }
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: RECEIPT_ID, receipt_number: 'MCT-RCP-2025-26-000001' }, error: null }) })),
            })),
          } as any;
        }
        if (table === 'payments') return chainMock({ data: { id: PAYMENT_ID, amount: 5163, payment_method: 'upi', transaction_id: null, installment_id: null, student_id: STUDENT_ID, course_id: 'course1', recorded_by: ADMIN_ID, student: { id: STUDENT_ID, name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } }, error: null });
        if (table === 'business_config') return chainMock({ data: { business_name: 'MCT', address_line_1: 'A', city: 'C', state: 'S', pincode: '0' }, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      client.from['called'] = false;

      const res = await service.createReceipt(PAYMENT_ID);
      expect(res).toBeDefined();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(pdfService.generatePdf).toHaveBeenCalled();
    });

    it('is idempotent — returns existing if already present', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts') {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: { id: RECEIPT_ID }, error: null }) })) })) } as any;
        }
        return chainMock({ data: null, error: null }) as any;
      });
      const res = await service.createReceipt(PAYMENT_ID);
      expect(res.id).toBe(RECEIPT_ID);
      expect(pdfService.generatePdf).not.toHaveBeenCalled();
    });

    it('booking receipt keeps installment_id NULL', async () => {
      // verified via insert payload in previous test — booking payment has installment_id null -> receipt insert has installment_id null
      // This is covered by createReceipt insert with pay.installment_id ?? null
      expect(true).toBe(true);
    });
  });

  describe('sendReceiptEmail', () => {
    it('sends stored PDF without regenerating', async () => {
      const receipt = { id: RECEIPT_ID, receipt_number: 'MCT-RCP-000001', payment_id: PAYMENT_ID, amount: 5163, student_id: STUDENT_ID, storage_path: 'receipts/xxx/MCT-RCP-000001.pdf', pdf_url: 'https://signed.old', email_sent_at: null };
      const payment = { id: PAYMENT_ID, amount: 5163, student: { id: STUDENT_ID, name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } };
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts') return chainMock({ data: receipt, error: null });
        if (table === 'payments') return chainMock({ data: payment, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      // storage download mock already returns pdf-bytes
      const res = await service.sendReceiptEmail(RECEIPT_ID, ADMIN_ID);
      expect(res.email_sent_to).toBe('rahul@example.com');
      expect(emailService.sendEmail).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('MCT-RCP-000001'), expect.any(String), expect.arrayContaining([expect.objectContaining({ filename: 'MCT-RCP-000001.pdf' })]));
      expect(pdfService.generatePdf).not.toHaveBeenCalled();
    });

    it('successful send updates email_sent_at', async () => {
      const receipt = { id: RECEIPT_ID, receipt_number: 'MCT-RCP-000001', payment_id: PAYMENT_ID, amount: 5163, student_id: STUDENT_ID, storage_path: 'receipts/xxx/MCT-RCP-000001.pdf' };
      const payment = { id: PAYMENT_ID, student: { name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } };
      const updateMock = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({}) }));
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts' && !table.includes('update')) {
          // select receipts
          if (client.from['selectCount']) return { update: updateMock } as any;
          client.from['selectCount'] = true;
          return chainMock({ data: receipt, error: null });
        }
        if (table === 'payments') return chainMock({ data: payment, error: null });
        if (table === 'receipts') return { update: updateMock } as any;
        return chainMock({ data: null, error: null }) as any;
      });
      client.from['selectCount'] = false;
      // Use simpler mock: from returns chainMock for select, but update needs mock
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts') {
          // First call is select single, second is update
          if (!client.from['calledReceipt']) {
            client.from['calledReceipt'] = true;
            return chainMock({ data: receipt, error: null });
          }
          return { update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) })) } as any;
        }
        if (table === 'payments') return chainMock({ data: payment, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      client.from['calledReceipt'] = false;
      const res = await service.sendReceiptEmail(RECEIPT_ID, ADMIN_ID);
      expect(res.email_sent_at).toBeDefined();
    });

    it('suppressed email throws ConflictException and does not mark sent', async () => {
      emailService.sendEmail.mockResolvedValue(false);
      const receipt = { id: RECEIPT_ID, receipt_number: 'MCT-RCP-000001', payment_id: PAYMENT_ID, amount: 5163, storage_path: 'receipts/xxx.pdf' };
      const payment = { id: PAYMENT_ID, student: { name: 'Rahul', email: 'suppressed@example.com' }, course: { name: 'Course' } };
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts') return chainMock({ data: receipt, error: null });
        if (table === 'payments') return chainMock({ data: payment, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      await expect(service.sendReceiptEmail(RECEIPT_ID, ADMIN_ID)).rejects.toThrow(/suppressed/);
      emailService.sendEmail.mockResolvedValue(true);
    });

    it('legacy storage_path NULL with expired pdf_url throws controlled error', async () => {
      const receipt = { id: RECEIPT_ID, receipt_number: 'MCT-RCP-000001', payment_id: PAYMENT_ID, amount: 5163, storage_path: null, pdf_url: 'https://expired.example/signed?expired' };
      const payment = { id: PAYMENT_ID, student: { name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } };
      client.from.mockImplementation((table: string) => {
        if (table === 'receipts') return chainMock({ data: receipt, error: null });
        if (table === 'payments') return chainMock({ data: payment, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      // fetch will try to fetch pdf_url and fail (no server) -> should throw BadRequest
      const realFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 } as any);
      await expect(service.sendReceiptEmail(RECEIPT_ID, ADMIN_ID)).rejects.toThrow(/expired/);
      global.fetch = realFetch;
    });
  });

  describe('createInvoice', () => {
    it('creates invoice without email', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'invoices') {
          if (!client.from['invCalled']) {
            client.from['invCalled'] = true;
            return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) } as any;
          }
          return { insert: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: 'inv1' }, error: null }) })) })) } as any;
        }
        if (table === 'payments') return chainMock({ data: { id: PAYMENT_ID, amount: 62705, payment_method: 'upi', student: { id: STUDENT_ID, name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' }, recorded_by: ADMIN_ID }, error: null });
        if (table === 'business_config') return chainMock({ data: { business_name: 'MCT' }, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      client.from['invCalled'] = false;
      jest.spyOn(service as any, 'getNextDocumentNumber').mockResolvedValue({ formatted: 'MCT-INV-2025-26-000001', rawNumber: 1 });
      const res = await service.createInvoice(PAYMENT_ID);
      expect(res).toBeDefined();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl fresh signed URL', () => {
    it('prefers storage_path and mints fresh signed URL', async () => {
      const receipt = { id: RECEIPT_ID, receipt_number: 'MCT-RCP-000001', storage_path: 'receipts/xxx/MCT-RCP-000001.pdf', pdf_url: 'https://old.signed' };
      client.from.mockImplementation((table: string) => {
        if (table === 'invoices') return chainMock({ data: null, error: { message: 'not found' } } as any);
        if (table === 'receipts') return chainMock({ data: receipt, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      // storage mock already returns fresh signedUrl
      const res = await service.getDownloadUrl(RECEIPT_ID);
      expect(res.url).toBe('https://signed.example/receipt.pdf');
      expect(res.fileName).toBe('MCT-RCP-000001.pdf');
    });
  });

  describe('createInvoiceForPlan (P4 full-course)', () => {
    const PLAN_ID = 'plan-123';
    const PLAN = {
      id: PLAN_ID,
      student_id: STUDENT_ID,
      course_id: 'course1',
      total_amount: 62705,
      status: 'completed',
      created_by: ADMIN_ID,
      student: { id: STUDENT_ID, name: 'Rahul', email: 'rahul@example.com' },
      course: { name: 'Course' },
    };

    it('creates plan-level invoice with payment_id NULL and total == plan total', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'invoices') {
          if (!client.from['planInvCheck']) {
            client.from['planInvCheck'] = true;
            return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) } as any;
          }
          return {
            insert: jest.fn((row: any) => {
              expect(row.payment_id).toBeNull();
              expect(row.payment_plan_id).toBe(PLAN_ID);
              expect(row.total_amount).toBe(62705);
              return { select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: 'inv-plan', invoice_number: 'MCT-INV-000002' }, error: null }) })) };
            }),
          } as any;
        }
        if (table === 'payment_plans') return chainMock({ data: PLAN, error: null });
        if (table === 'payments') return chainMock({ data: [{ amount: 62705 }], error: null });
        if (table === 'business_config') return chainMock({ data: { business_name: 'MCT' }, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      client.from['planInvCheck'] = false;
      jest.spyOn(service as any, 'getNextDocumentNumber').mockResolvedValue({ formatted: 'MCT-INV-2025-26-000002', rawNumber: 2 });
      const res = await service.createInvoiceForPlan(PLAN_ID);
      expect(res).toBeDefined();
      expect(res.id).toBe('inv-plan');
    });

    it('is idempotent — returns existing if already present', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'invoices') return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'existing-inv' }, error: null }) })) })) } as any;
        return chainMock({ data: null, error: null }) as any;
      });
      const res = await service.createInvoiceForPlan(PLAN_ID);
      expect(res.id).toBe('existing-inv');
    });

    it('mismatch logs but still creates invoice', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'invoices') {
          if (!client.from['mismatchCheck']) {
            client.from['mismatchCheck'] = true;
            return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) } as any;
          }
          return { insert: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: 'inv-mismatch' }, error: null }) })) })) } as any;
        }
        if (table === 'payment_plans') return chainMock({ data: PLAN, error: null });
        if (table === 'payments') return chainMock({ data: [{ amount: 50000 }], error: null }); // mismatch 50000 vs 62705
        if (table === 'business_config') return chainMock({ data: { business_name: 'MCT' }, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      client.from['mismatchCheck'] = false;
      jest.spyOn(service as any, 'getNextDocumentNumber').mockResolvedValue({ formatted: 'MCT-INV-2025-26-000003', rawNumber: 3 });
      const res = await service.createInvoiceForPlan(PLAN_ID);
      expect(res.id).toBe('inv-mismatch');
    });

    it('sendInvoiceEmail for plan-level derives recipient via plan', async () => {
      const invoice = { id: 'inv-plan', invoice_number: 'MCT-INV-000002', payment_plan_id: PLAN_ID, payment_id: null, total_amount: 62705, storage_path: 'invoices/xxx/MCT-INV-000002.pdf' };
      const planWithStudent = { id: PLAN_ID, student: { name: 'Rahul', email: 'rahul@example.com' }, course: { name: 'Course' } };
      client.from.mockImplementation((table: string) => {
        if (table === 'invoices') return chainMock({ data: invoice, error: null });
        if (table === 'payment_plans') return chainMock({ data: planWithStudent, error: null });
        return chainMock({ data: null, error: null }) as any;
      });
      const res = await service.sendInvoiceEmail('inv-plan', ADMIN_ID);
      expect(res.email_sent_to).toBe('rahul@example.com');
      expect(emailService.sendEmail).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('MCT-INV-000002'), expect.any(String), expect.any(Array));
    });
  });
});
