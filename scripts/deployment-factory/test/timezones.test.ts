/**
 * Timezone allowlist regression tests (ISOLATION-02, Step 1 + Step 11).
 *
 * The factory timezone gate must be deterministic across Node/ICU builds.
 * An observed build exposes deprecated Asia/Calcutta but NOT canonical
 * Asia/Kolkata (the product default) — validation must not depend on the
 * runtime ICU database. Run: pnpm factory:test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_TIMEZONES, isSupportedTimezone } from '../src/timezones';
import { validateClientConfig } from '../src/validate';

function baseConfig(timezone: unknown): any {
  return {
    client: { name: 'Tz Test Academy', deploymentId: 'tz-2026-01' },
    identity: {
      businessName: 'Tz Test Academy',
      logoUrl: 'https://learn.tztest.example/brand/logo.png',
      faviconUrl: 'https://learn.tztest.example/brand/favicon.ico',
      supportEmail: 'support@tztest.example',
    },
    admin: { name: 'Tz Admin', email: 'admin@tztest.example' },
    localization: { locale: 'en-IN', timezone, currency: 'INR', fyStartMonth: 3 },
    tax: { mode: 'inclusive', rate: 18 },
    financial: {
      invoicePrefix: 'TZ-INV',
      receiptPrefix: 'TZ-RCP',
      currentFinancialYear: '2026-2027',
    },
    theme: { primary: '#9A3412', sidebarBg: '#1C1917', accent: '#0F766E' },
    legal: { legalFooter: '© 2026 Tz Test Academy.' },
    deployment: {
      frontendDomain: 'https://learn.tztest.example',
      apiDomain: 'https://api.tztest.example',
    },
    providers: { video: 'bunny', email: 'none', zoom: false },
  };
}

describe('timezone allowlist (deterministic, ICU-independent)', () => {
  it('accepts canonical Asia/Kolkata regardless of runtime ICU data', () => {
    assert.equal(isSupportedTimezone('Asia/Kolkata'), true);
    const errs = validateClientConfig(baseConfig('Asia/Kolkata'));
    assert.ok(
      !errs.some((e) => e.field === 'localization.timezone'),
      `Asia/Kolkata must validate, got: ${JSON.stringify(errs)}`,
    );
  });

  it('accepts Asia/Dubai', () => {
    assert.equal(isSupportedTimezone('Asia/Dubai'), true);
    const errs = validateClientConfig(baseConfig('Asia/Dubai'));
    assert.ok(!errs.some((e) => e.field === 'localization.timezone'));
  });

  it('tolerates the legacy Asia/Calcutta alias older ICU builds expose', () => {
    assert.equal(isSupportedTimezone('Asia/Calcutta'), true);
  });

  it('rejects garbage, and non-strings fail', () => {
    for (const bad of ['Mars/Olympus', 'IST', 'GMT+5:30', '', 'asia/kolkata', 'Asia_Kolkata', 5, null, undefined, {}]) {
      assert.equal(isSupportedTimezone(bad), false, `must reject ${JSON.stringify(bad)}`);
      const errs = validateClientConfig(baseConfig(bad));
      assert.ok(
        errs.some((e) => e.field === 'localization.timezone'),
        `validator must flag ${JSON.stringify(bad)}`,
      );
    }
  });

  it('allowlist is a non-empty static set independent of Intl', () => {
    assert.ok(CANONICAL_TIMEZONES.length > 300, `expected a comprehensive list, got ${CANONICAL_TIMEZONES.length}`);
    assert.ok(new Set(CANONICAL_TIMEZONES).size === CANONICAL_TIMEZONES.length, 'no duplicates');
    assert.ok(CANONICAL_TIMEZONES.includes('Asia/Kolkata'));
    assert.ok(CANONICAL_TIMEZONES.includes('UTC'));
  });
});
