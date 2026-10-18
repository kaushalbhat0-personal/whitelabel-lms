/**
 * P0-2 regression tests: full BusinessConfig live comparison.
 * Run: pnpm factory:test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { ClientConfig } from '../src/types';
import { comparePublicBrand, compareBusinessConfigDetail } from '../src/deploy-verify';
import { buildBusinessConfigPayload } from '../src/business-config';
import { scanTextForSecrets } from '../src/secret-scan';

function acme(): ClientConfig {
  const p = path.join(__dirname, '..', 'examples', 'acme-learning-academy.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/** Live bodies shaped like the real API (public subset + authed snake_case row). */
function liveBodies(cfg: ClientConfig): { pub: Record<string, unknown>; authed: Record<string, unknown> } {
  const payload = buildBusinessConfigPayload(cfg) as Record<string, unknown>;
  const snake = (camel: string): string => camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const authed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'themeJson') authed.theme_json = v;
    else authed[snake(k)] = v;
  }
  const pub: Record<string, unknown> = {
    business_name: cfg.identity.businessName,
    logo_url: cfg.identity.logoUrl,
    favicon_url: cfg.identity.faviconUrl,
    currency: cfg.localization.currency,
    locale: cfg.localization.locale,
    timezone: cfg.localization.timezone,
    theme_json: { ...(payload.themeJson as Record<string, unknown>) },
  };
  return { pub, authed };
}

describe('full BusinessConfig comparison', () => {
  it('exact matching config → PASS (public + detail)', () => {
    const cfg = acme();
    const { pub, authed } = liveBodies(cfg);
    assert.equal(comparePublicBrand(cfg, pub).status, 'PASS');
    assert.equal(compareBusinessConfigDetail(cfg, authed).status, 'PASS');
  });

  it('currency mismatch → FAIL', () => {
    const cfg = acme();
    const { pub } = liveBodies(cfg);
    assert.equal(comparePublicBrand(cfg, { ...pub, currency: 'EUR' }).status, 'FAIL');
  });

  it('tax mode mismatch → FAIL', () => {
    const cfg = acme();
    const { authed } = liveBodies(cfg);
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, tax_mode: 'inclusive' }).status, 'FAIL');
  });

  it('tax rate mismatch → FAIL', () => {
    const cfg = acme();
    const { authed } = liveBodies(cfg);
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, tax_rate: 18 }).status, 'FAIL');
  });

  it('FY mismatch → FAIL', () => {
    const cfg = acme();
    const { authed } = liveBodies(cfg);
    const c = compareBusinessConfigDetail(cfg, { ...authed, current_financial_year: '2025-2026' });
    assert.equal(c.status, 'FAIL');
    assert.ok(c.detail.includes('currentFinancialYear'));
  });

  it('invoice + receipt prefix mismatch → FAIL', () => {
    const cfg = acme();
    const { authed } = liveBodies(cfg);
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, invoice_prefix: 'WRONG' }).status, 'FAIL');
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, receipt_prefix: 'WRONG' }).status, 'FAIL');
  });

  it('theme mismatch → FAIL (per-key)', () => {
    const cfg = acme();
    const { pub } = liveBodies(cfg);
    const bad = { ...pub, theme_json: { primary: '#000000', sidebarBg: '#0f172a', accent: '#f59e0b' } };
    const c = comparePublicBrand(cfg, bad);
    assert.equal(c.status, 'FAIL');
    assert.ok(c.detail.includes('theme_json.primary'));
  });

  it('mismatch detail names field + expected + observed, never secrets', () => {
    const cfg = acme();
    const { authed } = liveBodies(cfg);
    const c = compareBusinessConfigDetail(cfg, { ...authed, tax_rate: 18 });
    assert.ok(c.detail.includes('taxRate'));
    assert.ok(c.detail.includes('live='));
    assert.ok(c.detail.includes('config='));
    assert.deepEqual(scanTextForSecrets(JSON.stringify(c)), []);
  });

  it('optional absent field → skipped, not failed', () => {
    const cfg = acme();
    delete (cfg.identity as Record<string, unknown>).website;
    delete (cfg.legal as Record<string, unknown>).legalFooter;
    const { authed } = liveBodies(acme());
    const c = compareBusinessConfigDetail(cfg, authed);
    assert.equal(c.status, 'PASS');
    assert.ok(c.detail.includes('skipped unset'));
  });

  it('missing authed body → SKIP (public check unaffected)', () => {
    const cfg = acme();
    const { pub } = liveBodies(cfg);
    assert.equal(compareBusinessConfigDetail(cfg, undefined).status, 'SKIP');
    assert.equal(compareBusinessConfigDetail(cfg, null).status, 'SKIP');
    assert.equal(comparePublicBrand(cfg, pub).status, 'PASS');
  });

  it('supportEmail + website + legalFooter drift → FAIL', () => {
    const cfg = acme();
    const { authed } = liveBodies(cfg);
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, support_email: 'other@x.io' }).status, 'FAIL');
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, website: 'https://other.io' }).status, 'FAIL');
    assert.equal(compareBusinessConfigDetail(cfg, { ...authed, legal_footer: 'other' }).status, 'FAIL');
  });

  it('no secret values appear in comparison evidence', () => {
    const cfg = acme();
    const { pub, authed } = liveBodies(cfg);
    for (const c of [comparePublicBrand(cfg, pub), compareBusinessConfigDetail(cfg, authed)]) {
      assert.deepEqual(scanTextForSecrets(JSON.stringify(c)), []);
      assert.ok(!JSON.stringify(c).toLowerCase().includes('password'));
      assert.ok(!JSON.stringify(c).toLowerCase().includes('bearer'));
    }
  });
});
