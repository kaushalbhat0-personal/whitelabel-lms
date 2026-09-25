jest.mock('puppeteer', () => ({}));
jest.mock('handlebars', () => ({ compile: jest.fn(() => () => '<html>mock</html>') }));

import { Test, TestingModule } from '@nestjs/testing';
import { AchievementsService } from './achievements.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { EmailService } from '../email/email.service';
import { PdfGenerationService } from '../pdf/pdf-generation.service';
import { ObservabilityService } from '../observability/observability.service';
import { DEFAULT_THEME_PRIMARY, DEFAULT_THEME_SIDEBAR_BG, DEFAULT_THEME_ACCENT } from '../../common/config/defaults';
import * as fs from 'fs';
import * as path from 'path';

describe('AchievementsService — COMM-01B-B1 Certificate Branding', () => {
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

  describe('resolveTheme', () => {
    it('GSA theme returns validated GSA colors', () => {
      const raw = { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' };
      const theme = (service as any).resolveTheme(raw);
      expect(theme.primary).toBe('#2563EB');
      expect(theme.sidebarBg).toBe('#1E3A8A');
      expect(theme.accent).toBe('#60A5FA');
    });

    it('NULL theme returns defaults', () => {
      const theme = (service as any).resolveTheme(null);
      expect(theme.primary).toBe(DEFAULT_THEME_PRIMARY);
      expect(theme.sidebarBg).toBe(DEFAULT_THEME_SIDEBAR_BG);
      expect(theme.accent).toBe(DEFAULT_THEME_ACCENT);
    });

    it('undefined theme returns defaults', () => {
      const theme = (service as any).resolveTheme(undefined);
      expect(theme.primary).toBe(DEFAULT_THEME_PRIMARY);
    });

    it('partial theme falls back independently', () => {
      const theme = (service as any).resolveTheme({ primary: '#2563EB' });
      expect(theme.primary).toBe('#2563EB');
      expect(theme.sidebarBg).toBe(DEFAULT_THEME_SIDEBAR_BG);
      expect(theme.accent).toBe(DEFAULT_THEME_ACCENT);
    });

    it('malformed DB theme falls back per field', () => {
      const raw = { primary: 'rgb(0,0,0)', sidebarBg: '#1E3A8A', accent: 'evil' };
      const theme = (service as any).resolveTheme(raw);
      expect(theme.primary).toBe(DEFAULT_THEME_PRIMARY);
      expect(theme.sidebarBg).toBe('#1E3A8A');
      expect(theme.accent).toBe(DEFAULT_THEME_ACCENT);
    });

    it('rejects short hex, url, var, gradients', () => {
      for (const bad of ['#fff', '#12345', '#1234567', 'url(x)', 'var(--x)', 'linear-gradient(red,blue)', '#GGGGGG', '<red', '#10b981;']) {
        const theme = (service as any).resolveTheme({ primary: bad, sidebarBg: '#1E3A8A', accent: '#60A5FA' });
        expect(theme.primary).toBe(DEFAULT_THEME_PRIMARY);
      }
    });

    it('isValidHex6 rejects non-hex', () => {
      expect((service as any).isValidHex6('rgb(0,0,0)')).toBe(false);
      expect((service as any).isValidHex6('#1E3A8A')).toBe(true);
      expect((service as any).isValidHex6('#1e3a8a')).toBe(true);
      expect((service as any).isValidHex6('#fff')).toBe(false);
      expect((service as any).isValidHex6('#GGGGGG')).toBe(false);
    });
  });

  describe('deriveSealText', () => {
    it('GSA businessName derives GSA', () => {
      expect((service as any).deriveSealText('Global Skills Academy')).toBe('GSA');
    });

    it('LMS Platform fallback returns LMS', () => {
      expect((service as any).deriveSealText('LMS Platform')).toBe('LMS');
      expect((service as any).deriveSealText('')).toBe('LMS');
    });

    it('single word returns first 3 chars', () => {
      expect((service as any).deriveSealText('Academy')).toBe('ACA');
    });

    it('does not return generic LMS for GSA client', () => {
      const seal = (service as any).deriveSealText('Global Skills Academy');
      expect(seal).not.toBe('LMS');
      expect(seal).toBe('GSA');
    });

    it('derives initials for multi-word', () => {
      expect((service as any).deriveSealText('Money Craft Trader')).toBe('MCT');
    });
  });

  describe('certificate template', () => {
    it('template contains Handlebars placeholders for theme', () => {
      const templatePath = path.join(__dirname, 'templates', 'certificate.template.hbs');
      const content = fs.readFileSync(templatePath, 'utf-8');
      expect(content).toContain('{{sidebarBg}}');
      expect(content).toContain('{{accent}}');
      expect(content).toContain('{{sealText}}');
      expect(content).toContain('{{businessName}}');
      // should not contain hardcoded old navy/gold
      expect(content).not.toContain('#1e3a5f');
      expect(content).not.toContain('#f59e0b');
      // should not contain generic LMS literal seal
      expect(content).not.toContain('>LMS<');
    });

    it('template does not contain raw DB JSON or arbitrary CSS', () => {
      const templatePath = path.join(__dirname, 'templates', 'certificate.template.hbs');
      const content = fs.readFileSync(templatePath, 'utf-8');
      expect(content).not.toContain('theme_json');
      expect(content).not.toContain('{{theme_json}}');
    });
  });
});
