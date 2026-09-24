/**
 * Central defaults — single source for non-secret business defaults
 *
 * Why this file exists:
 *   - BusinessConfig is the per-client override store (single row per deployment).
 *   - When a BusinessConfig field is absent, services should fall back to these defaults.
 *   - This avoids hardcoded literals scattered across services/templates.
 *
 * How to use (Phase 2 pattern):
 *   import { DEFAULT_BUSINESS_NAME, DEFAULT_CURRENCY } from '@/common/config/defaults';
 *   const businessName = businessConfig.business_name ?? DEFAULT_BUSINESS_NAME;
 *
 * Do NOT import ENV secrets here — secrets belong in .env via ConfigService.
 * This file is for non-secret, client-meaningful defaults only.
 *
 * In Phase 1 we establish the module only; no existing hardcodes are migrated
 * except trivial re-exports that aid documentation. Phase 2 will wire the
 * meaningful business assumptions (FY, tax, locale, theme) to use these.
 */

export const DEFAULT_BUSINESS_NAME = 'LMS Platform' as const;

export const DEFAULT_INVOICE_PREFIX = 'INV' as const;
export const DEFAULT_RECEIPT_PREFIX = 'RCP' as const;

export const DEFAULT_COUNTRY = 'India' as const;
export const DEFAULT_CURRENCY = 'INR' as const;
export const DEFAULT_LOCALE = 'en-IN' as const;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata' as const;

/** Financial year start month (0-indexed JS month). 3 = April (Indian FY). */
export const DEFAULT_FINANCIAL_YEAR_START_MONTH = 3 as const;

export const DEFAULT_TAX_MODE = 'inclusive' as const;
export const DEFAULT_TAX_RATE = 18 as const;

/** Theme defaults match the current compiled Tailwind brand (green/white/black). */
export const DEFAULT_THEME_PRIMARY = '#10b981' as const;
export const DEFAULT_THEME_SIDEBAR_BG = '#064e3b' as const;
export const DEFAULT_THEME_ACCENT = '#f59e0b' as const;

export const DEFAULT_COURSE_NAME = 'Course' as const;

export type Defaults = {
  businessName: typeof DEFAULT_BUSINESS_NAME;
  invoicePrefix: typeof DEFAULT_INVOICE_PREFIX;
  receiptPrefix: typeof DEFAULT_RECEIPT_PREFIX;
  country: typeof DEFAULT_COUNTRY;
  currency: typeof DEFAULT_CURRENCY;
  locale: typeof DEFAULT_LOCALE;
  timezone: typeof DEFAULT_TIMEZONE;
  financialYearStartMonth: typeof DEFAULT_FINANCIAL_YEAR_START_MONTH;
  taxMode: typeof DEFAULT_TAX_MODE;
  taxRate: typeof DEFAULT_TAX_RATE;
  themePrimary: typeof DEFAULT_THEME_PRIMARY;
  themeSidebarBg: typeof DEFAULT_THEME_SIDEBAR_BG;
  themeAccent: typeof DEFAULT_THEME_ACCENT;
};

/** Convenience snapshot of all defaults. */
export const DEFAULTS: Defaults = {
  businessName: DEFAULT_BUSINESS_NAME,
  invoicePrefix: DEFAULT_INVOICE_PREFIX,
  receiptPrefix: DEFAULT_RECEIPT_PREFIX,
  country: DEFAULT_COUNTRY,
  currency: DEFAULT_CURRENCY,
  locale: DEFAULT_LOCALE,
  timezone: DEFAULT_TIMEZONE,
  financialYearStartMonth: DEFAULT_FINANCIAL_YEAR_START_MONTH,
  taxMode: DEFAULT_TAX_MODE,
  taxRate: DEFAULT_TAX_RATE,
  themePrimary: DEFAULT_THEME_PRIMARY,
  themeSidebarBg: DEFAULT_THEME_SIDEBAR_BG,
  themeAccent: DEFAULT_THEME_ACCENT,
} as const;
