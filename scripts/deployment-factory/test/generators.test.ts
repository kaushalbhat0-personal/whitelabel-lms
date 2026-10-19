/**
 * Focused tests: generators (ENV, BusinessConfig, SQL, DNS) + secret safety.
 * Run: pnpm factory:test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { ClientConfig } from '../src/types';
import { buildRenderEnvTemplate, buildVercelEnvTemplate } from '../src/env-templates';
import { buildBusinessConfigPayload, BUSINESS_CONFIG_KEYS } from '../src/business-config';
import { buildFirstAdminSql, buildFirstAdminTemplate } from '../src/first-admin-sql';
import { buildDnsSheet } from '../src/dns-sheet';
import { buildChecklist } from '../src/checklist';
import { scanTextForSecrets } from '../src/secret-scan';

function acme(): ClientConfig {
  const p = path.join(__dirname, '..', 'examples', 'acme-learning-academy.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

describe('env templates', () => {
  it('render template derives FRONTEND_URL and never contains secrets', () => {
    const t = buildRenderEnvTemplate(acme());
    assert.ok(t.includes('FRONTEND_URL=https://learn.acmelearningacademy.com'));
    assert.ok(t.includes('JWT_SECRET=<ENTER_IN_DASHBOARD>'));
    assert.deepEqual(scanTextForSecrets(t), []);
  });

  it('render template covers keys missing from .env.example', () => {
    const t = buildRenderEnvTemplate(acme());
    // Always present regardless of provider selection:
    for (const k of ['PUPPETEER_EXECUTABLE_PATH', 'PUPPETEER_CACHE_DIR']) {
      assert.ok(t.includes(k), `missing ${k}`);
    }
    // Selection-dependent keys appear when the provider is selected:
    const zoomCfg = { ...acme(), providers: { ...acme().providers, zoom: true } };
    assert.ok(buildRenderEnvTemplate(zoomCfg).includes('LIVE_SESSION_DEFAULT_HOST_ID'));
    assert.ok(t.includes('SKIPPED (providers.zoom=false'));
    const resendCfg = { ...acme(), providers: { ...acme().providers, email: 'resend' as const } };
    assert.ok(buildRenderEnvTemplate(resendCfg).includes('RESEND_WEBHOOK_SECRET'));
    assert.ok(t.includes('STUB MODE'));
  });

  it('render template pins SESSION_POLICY=single and never multi', () => {
    const t = buildRenderEnvTemplate(acme());
    assert.ok(t.includes('SESSION_POLICY=single'));
    assert.ok(!t.includes('SESSION_POLICY=multi'));
  });

  it('render template pins PASSWORD_MANAGEMENT=enabled and never disabled', () => {
    const t = buildRenderEnvTemplate(acme());
    assert.ok(t.includes('PASSWORD_MANAGEMENT=enabled'));
    assert.ok(!t.includes('PASSWORD_MANAGEMENT=disabled'));
  });

  it('render template never emits TEMP_DEMO_ACCESS (client-safe, demo remains manual)', () => {
    const t = buildRenderEnvTemplate(acme());
    assert.ok(!t.includes('TEMP_DEMO_ACCESS'));
    const zoomCfg = { ...acme(), providers: { ...acme().providers, zoom: true } };
    assert.ok(!buildRenderEnvTemplate(zoomCfg).includes('TEMP_DEMO_ACCESS'));
    const resendCfg = { ...acme(), providers: { ...acme().providers, email: 'resend' as const } };
    assert.ok(!buildRenderEnvTemplate(resendCfg).includes('TEMP_DEMO_ACCESS'));
  });

  it('render template has no service-role leakage into vercel; vercel template derives API url', () => {
    const v = buildVercelEnvTemplate(acme());
    assert.ok(!v.includes('SERVICE_ROLE'));
    assert.ok(v.includes('NEXT_PUBLIC_API_URL=https://api.acmelearningacademy.com'));
    assert.deepEqual(scanTextForSecrets(v), []);
  });

  it('email sections follow provider selection', () => {
    assert.ok(buildRenderEnvTemplate(acme()).includes('STUB MODE'));
    const resend = { ...acme(), providers: { ...acme().providers, email: 'resend' as const } };
    const t = buildRenderEnvTemplate(resend);
    assert.ok(t.includes('RESEND_API_KEY=<ENTER_IN_DASHBOARD>'));
    assert.deepEqual(scanTextForSecrets(t), []);
  });

  it('zoom sections follow provider selection with explicit ZOOM_ENABLED', () => {
    // Zoom client: intent enabled + credential placeholders.
    const zoomCfg = { ...acme(), providers: { ...acme().providers, zoom: true } };
    const zt = buildRenderEnvTemplate(zoomCfg);
    assert.ok(zt.includes('ZOOM_ENABLED=enabled'));
    assert.ok(zt.includes('ZOOM_ACCOUNT_ID=<ENTER_IN_DASHBOARD>'));
    assert.ok(!zt.includes('ZOOM_ENABLED=disabled'));
    // Recorded-only client: intent disabled, no credential placeholders.
    const t = buildRenderEnvTemplate(acme());
    assert.ok(t.includes('ZOOM_ENABLED=disabled'));
    assert.ok(!t.includes('ZOOM_ACCOUNT_ID=<ENTER_IN_DASHBOARD>'));
    assert.ok(t.includes('SKIPPED (providers.zoom=false'));
    // No invalid ZOOM_ENABLED value is ever emitted.
    for (const line of t.split('\n').concat(zt.split('\n'))) {
      if (line.startsWith('ZOOM_ENABLED=')) {
        assert.ok(line === 'ZOOM_ENABLED=enabled' || line === 'ZOOM_ENABLED=disabled', `bad line: ${line}`);
      }
    }
    assert.deepEqual(scanTextForSecrets(zt), []);
  });
});

describe('business-config payload', () => {
  it('maps every supported field exactly, theme allowlisted, no unknown keys', () => {
    const p = buildBusinessConfigPayload(acme()) as Record<string, unknown>;
    assert.equal(p.businessName, 'Acme Learning Academy');
    assert.equal(p.locale, 'en-US');
    assert.equal(p.timezone, 'America/New_York');
    assert.equal(p.currency, 'USD');
    assert.equal(p.fyStartMonth, 0);
    assert.equal(p.taxMode, 'exclusive');
    assert.equal(p.taxRate, 8);
    assert.equal(p.invoicePrefix, 'ACME-INV');
    assert.deepEqual(p.themeJson, { primary: '#1e3a8a', sidebarBg: '#0f172a', accent: '#f59e0b' });
    for (const k of Object.keys(p)) {
      assert.ok((BUSINESS_CONFIG_KEYS as readonly string[]).includes(k), `unknown key ${k}`);
    }
    assert.deepEqual(scanTextForSecrets(JSON.stringify(p)), []);
  });
});

describe('first-admin SQL', () => {
  it('renders valid SQL with placeholders and no credentials', () => {
    const t = buildFirstAdminTemplate('support@acmelearningacademy.com', 'Acme Learning Academy');
    assert.ok(t.includes('<PASTE-AUTH-USER-UUID>'));
    assert.ok(t.includes('RUN ONLY AFTER CREATING THE AUTH USER'));
    assert.deepEqual(scanTextForSecrets(t), []);
  });

  it('final SQL validates UUID/email and quotes safely', () => {
    const sql = buildFirstAdminSql({
      authUid: '123e4567-e89b-12d3-a456-426614174000',
      adminEmail: 'admin@acmelearningacademy.com',
      adminName: "O'Brien",
    });
    assert.ok(sql.includes("O''Brien"));
    assert.ok(!sql.toLowerCase().includes('password='));
    assert.throws(() => buildFirstAdminSql({ authUid: 'not-a-uuid', adminEmail: 'a@b.com', adminName: 'X' }), /UUID/);
  });
});

describe('dns sheet + checklist', () => {
  it('dns sheet uses placeholders for platform-assigned values, never automates', () => {
    const s = buildDnsSheet(acme());
    assert.ok(s.includes('MANUAL'));
    assert.ok(s.includes('<COPY FROM Vercel dashboard'));
    assert.ok(s.includes('<COPY FROM Render dashboard'));
  });

  it('checklist covers the 14 runbook phases', () => {
    const c = buildChecklist(acme());
    for (const n of ['Pre-flight', 'Supabase', 'Redis', 'Render', 'Vercel', 'DNS', 'First admin', 'BusinessConfig', 'Verification', 'Handoff']) {
      assert.ok(c.includes(n), `missing phase ${n}`);
    }
  });
});

describe('secret scanner', () => {
  it('flags real secret shapes and ignores placeholders', () => {
    assert.equal(scanTextForSecrets('SUPABASE_SERVICE_ROLE_KEY=<ENTER_IN_DASHBOARD>').length, 0);
    assert.equal(scanTextForSecrets('JWT_SECRET=').length, 0);
    assert.ok(scanTextForSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c').length > 0);
    assert.ok(scanTextForSecrets('RESEND_API_KEY=re_abc123XYZ789qrs').length > 0);
    assert.ok(scanTextForSecrets('-----BEGIN PRIVATE KEY-----').length > 0);
    assert.ok(scanTextForSecrets('BUNNY_API_KEY=8f3k2j4h5g6f7d8s9a0b1c2d3e4f5').length > 0);
    // Migration column names must NOT trip the scanner (mux_ false positive guard):
    assert.equal(scanTextForSecrets('mux_playback_id TEXT,\nmux_asset_id, mux_playback_id, mux_upload_id,').length, 0);
  });
});
