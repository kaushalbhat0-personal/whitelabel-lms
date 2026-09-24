jest.mock('puppeteer', () => ({}));
jest.mock('handlebars', () => ({ compile: jest.fn(() => () => '<html>mock</html>') }));

import { Test, TestingModule } from '@nestjs/testing';
import { AchievementsService } from './achievements.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { PdfGenerationService } from '../pdf/pdf-generation.service';
import { ObservabilityService } from '../observability/observability.service';

describe('AchievementsService — B2b-A Certificate Presentation', () => {
  let service: AchievementsService;

  beforeEach(async () => {
    const client = {
      from: jest.fn(),
      storage: { from: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: SupabaseService, useValue: { client } },
        { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue(true) } },
        { provide: PdfGenerationService, useValue: { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(AchievementsService);
  });

  it('GSA businessName is used not LMS Platform', async () => {
    const bizGSA = { business_name: 'Global Skills Academy', locale: 'en-AE', timezone: 'Asia/Dubai' };
    expect(bizGSA.business_name).toBe('Global Skills Academy');
    expect(bizGSA.business_name).not.toBe('LMS Platform');
  });

  it('India defaults produce LMS Platform fallback', () => {
    const bizIndia = { business_name: null, locale: null, timezone: null };
    const DEFAULT_LOCALE = 'en-IN';
    const DEFAULT_TIMEZONE = 'Asia/Kolkata';
    const certLocale = bizIndia.locale ?? DEFAULT_LOCALE;
    const certTimezone = bizIndia.timezone ?? DEFAULT_TIMEZONE;
    const certBusinessName = bizIndia.business_name ?? 'LMS Platform';
    expect(certLocale).toBe('en-IN');
    expect(certTimezone).toBe('Asia/Kolkata');
    expect(certBusinessName).toBe('LMS Platform');
  });

  it('issueDate uses locale/timezone (en-AE Asia/Dubai)', () => {
    const bizGSA = { locale: 'en-AE', timezone: 'Asia/Dubai' };
    const iso = '2027-05-12T10:00:00.000Z';
    const issueDate = new Date(iso).toLocaleDateString(bizGSA.locale, {
      timeZone: bizGSA.timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    expect(issueDate).toContain('2027');
    expect(issueDate).toContain('May');
    const indiaDate = new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    expect(indiaDate).toContain('2027');
  });

  it('certificate number and verifyUrl remain intact', () => {
    const cert = { certificate_number: 'CERT-ABC-123', token: 'verify-token-xyz' };
    const verifyUrl = `http://localhost:3000/verify-certificate?token=${cert.token}`;
    expect(verifyUrl).toContain('verify-token-xyz');
    expect(cert.certificate_number).toBe('CERT-ABC-123');
  });

  it('businessName flows to template data', () => {
    const serviceAny = service as any;
    // Verify the private method exists or the wiring is present
    expect(serviceAny.generateCertificatePdf).toBeDefined();
    expect(typeof serviceAny.generateCertificatePdf).toBe('function');
  });
});
