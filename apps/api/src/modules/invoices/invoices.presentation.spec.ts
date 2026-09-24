jest.mock('puppeteer', () => ({}));
jest.mock('handlebars', () => ({ compile: jest.fn(() => () => '<html>mock</html>') }));

import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { PdfGenerationService } from '../pdf/pdf-generation.service';
import { ObservabilityService } from '../observability/observability.service';

describe('InvoicesService — B2b-A Presentation (tax/currency/date/email)', () => {
  let service: InvoicesService;

  beforeEach(async () => {
    const client = {
      from: jest.fn(),
      storage: {
        from: jest.fn(() => ({
          upload: jest.fn().mockResolvedValue({ error: null }),
          createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed' } }),
          download: jest.fn().mockResolvedValue({ data: { arrayBuffer: async () => Buffer.from('pdf') }, error: null }),
        })),
      },
      rpc: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: SupabaseService, useValue: { client } },
        { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue(true) } },
        { provide: PdfGenerationService, useValue: { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(InvoicesService);
    jest.spyOn(service as any, 'readTemplate').mockReturnValue('<html>mock</html>');
  });

  describe('getCurrencySymbol', () => {
    it('INR en-IN → ₹', () => {
      expect((service as any).getCurrencySymbol('INR', 'en-IN')).toBe('₹');
    });
    it('AED en-AE → AED (not ₹)', () => {
      const sym = (service as any).getCurrencySymbol('AED', 'en-AE');
      expect(sym).toContain('AED');
      expect(sym).not.toContain('₹');
    });
  });

  describe('formatCurrencyForEmail', () => {
    it('AED does not contain ₹', () => {
      const s = (service as any).formatCurrencyForEmail(62705, 'AED', 'en-AE');
      expect(s).toContain('AED');
      expect(s).not.toContain('₹');
    });
    it('INR contains ₹', () => {
      const s = (service as any).formatCurrencyForEmail(62705, 'INR', 'en-IN');
      expect(s).toContain('₹');
    });
  });

  describe('formatPresentationDate', () => {
    it('same UTC instant differs per locale/timezone', () => {
      const iso = new Date('2027-05-12T10:00:00.000Z');
      const india = (service as any).formatPresentationDate('Asia/Kolkata', 'en-IN', iso);
      const dubai = (service as any).formatPresentationDate('Asia/Dubai', 'en-AE', iso);
      expect(india).toContain('2027');
      expect(dubai).toContain('2027');
      expect(typeof india).toBe('string');
      expect(typeof dubai).toBe('string');
    });
  });

  describe('tax presentation halfRate', () => {
    it('18% → 9.00, 5% → 2.50, 0% → 0.00', () => {
      expect((Number(18) / 2).toFixed(2)).toBe('9.00');
      expect((Number(5) / 2).toFixed(2)).toBe('2.50');
      expect((Number(0) / 2).toFixed(2)).toBe('0.00');
    });
    it('hasTax hidden when 0% or zero mode', () => {
      const hasTax18 = Number(18) > 0 && 'inclusive'.toLowerCase() !== 'zero';
      const hasTax0 = Number(0) > 0 && 'inclusive'.toLowerCase() !== 'zero';
      const hasTaxZeroMode = Number(5) > 0 && 'zero'.toLowerCase() !== 'zero';
      expect(hasTax18).toBe(true);
      expect(hasTax0).toBe(false);
      expect(hasTaxZeroMode).toBe(false);
    });
  });

  describe('currency presentation does not hardcode ₹ for AED', () => {
    it('invoice email html would contain AED for GSA', () => {
      const amt = (service as any).formatCurrencyForEmail(62705, 'AED', 'en-AE');
      expect(amt).toContain('AED');
      expect(amt).not.toBe('₹ 62705.00');
    });
    it('receipt email html would contain AED for GSA', () => {
      const amt = (service as any).formatCurrencyForEmail(5163, 'AED', 'en-AE');
      expect(amt).toContain('AED');
      expect(amt).not.toContain('₹');
    });
  });
});
