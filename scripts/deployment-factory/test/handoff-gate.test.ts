/**
 * P0-3 + P1 tests: handoff evidence gate, intake skeleton, domain safety.
 * Run: pnpm factory:test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ClientConfig } from '../src/types';
import { validateClientConfig } from '../src/validate';
import { evaluateHandoff, buildHandoffReport } from '../src/handoff-report';
import { buildIntakeSkeleton } from '../src/intake';
import { collectKnownDomains, knownDomainsExcluding } from '../src/known-domains';
import { supabaseHostOf, buildDbEvidence, evaluateDbFacts } from '../src/db-verify';

function acme(): ClientConfig {
  const p = path.join(__dirname, '..', 'examples', 'acme-learning-academy.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const V = (deploymentId = 'acme-2026-01') => ({
  checks: [{ id: 'api-health', label: 'API health', status: 'PASS' as const, detail: 'ok' }],
  overall: 'PASS',
  generatedAt: '2026-01-01T00:00:00.000Z',
  client: { name: 'Acme Learning Academy', deploymentId },
  target: { api: 'https://api.acmelearningacademy.com', frontend: 'https://learn.acmelearningacademy.com' },
});

const D = (deploymentId = 'acme-2026-01') => ({
  checks: [{ id: 'tables', label: 'Must-have tables present', status: 'PASS' as const, detail: 'ok' }],
  overall: 'PASS',
  generatedAt: '2026-01-01T00:00:00.000Z',
  client: { name: 'Acme Learning Academy', deploymentId },
  target: { supabaseHost: 'xyz.supabase.co' },
});

const BASE = { config: acme(), repoHead: 'abc', backupAcknowledged: true, verifiedBy: 'Op' };

describe('handoff evidence gate', () => {
  it('READY requires verification + db + backup + verifier + identity match', () => {
    assert.equal(evaluateHandoff({ ...BASE, verification: V(), db: D() }).ready, true);
  });

  it('missing verification → NOT READY, never silent READY', () => {
    const ev = evaluateHandoff({ ...BASE, db: D() });
    assert.equal(ev.ready, false);
    assert.ok(ev.gateProblems.some((p) => p.includes('verification')));
  });

  it('missing db → NOT READY', () => {
    const ev = evaluateHandoff({ ...BASE, verification: V() });
    assert.equal(ev.ready, false);
    assert.ok(ev.gateProblems.some((p) => p.includes('DB')));
  });

  it('missing backup ack / verifier → NOT READY', () => {
    assert.equal(evaluateHandoff({ ...BASE, verification: V(), db: D(), backupAcknowledged: false }).ready, false);
    assert.equal(evaluateHandoff({ ...BASE, verification: V(), db: D(), verifiedBy: '' }).ready, false);
  });

  it('verification for another deploymentId → NOT READY', () => {
    const ev = evaluateHandoff({ ...BASE, verification: V('other-2026-01'), db: D() });
    assert.equal(ev.ready, false);
    assert.ok(ev.gateProblems.some((p) => p.includes('other-2026-01')));
  });

  it('db evidence without client identity → NOT READY', () => {
    const db = D();
    delete (db as Record<string, unknown>).client;
    const ev = evaluateHandoff({ ...BASE, verification: V(), db });
    assert.equal(ev.ready, false);
    assert.ok(ev.gateProblems.some((p) => p.includes('no client identity')));
  });

  it('target mismatch → NOT READY (wrong-env evidence)', () => {
    const v = V();
    v.target.api = 'https://api.evil.io';
    const ev = evaluateHandoff({ ...BASE, verification: v, db: D() });
    assert.equal(ev.ready, false);
  });

  it('FAIL checks block READY', () => {
    const v = V();
    v.checks = [{ id: 'x', label: 'API health', status: 'FAIL', detail: 'down' }];
    v.overall = 'FAIL';
    assert.equal(evaluateHandoff({ ...BASE, verification: v, db: D() }).ready, false);
  });

  it('WARN blocks unless acked with --ack-warn', () => {
    const v = V();
    v.checks = [...v.checks, { id: 'rls', label: 'RLS default-deny (67/67)', status: 'WARN' as const, detail: 'sql editor' }];
    v.overall = 'WARN';
    assert.equal(evaluateHandoff({ ...BASE, verification: v, db: D() }).ready, false);
    const acked = evaluateHandoff({ ...BASE, verification: v, db: D(), ackedWarns: ['RLS default-deny'] });
    assert.equal(acked.ready, true);
    assert.ok(acked.ackedWarnings.some((w) => w.includes('RLS')));
  });

  it('--no-verification --reason → EXCEPTIONAL, recorded, never READY', () => {
    const ev = evaluateHandoff({ ...BASE, db: D(), noVerificationReason: 'Client sign-off pending; verification scheduled Friday.' });
    assert.equal(ev.exceptional, true);
    assert.equal(ev.ready, false);
    const r = buildHandoffReport({ ...BASE, db: D(), noVerificationReason: 'Client sign-off pending; verification scheduled Friday.' });
    assert.ok(r.includes('EXCEPTIONAL'));
    assert.ok(r.includes('Client sign-off pending'));
    assert.ok(r.includes('NOT READY'));
    assert.ok(!r.includes('READY FOR HANDOFF'));
  });
});

describe('db evidence metadata', () => {
  it('embeds non-secret host + client identity, never keys', () => {
    const ev = buildDbEvidence('https://xyzcompany.supabase.co', { name: 'Acme', deploymentId: 'acme-2026-01' }, []);
    assert.equal(ev.target.supabaseHost, 'xyzcompany.supabase.co');
    assert.equal(ev.client?.deploymentId, 'acme-2026-01');
    assert.ok(!JSON.stringify(ev).includes('service'));
  });

  it('supabaseHostOf never throws on junk', () => {
    assert.equal(typeof supabaseHostOf('not a url'), 'string');
  });

  it('evaluateDbFacts still usable for evidence (RLS stays WARN by design)', () => {
    const counts: Record<string, number | null> = {
      business_config: 0, profiles: 0, courses: 0, batches: 0,
      payments: 0, invoices: 0, receipts: 0, achievement_definitions: 5,
    };
    const checks = evaluateDbFacts({
      tables: ['business_config', 'profiles'], counts, countsErrors: [],
      businessConfigColumns: ['theme_json'], buckets: [{ id: 'uploads', public: false }, { id: 'invoices', public: false }],
      rlsProbe: 'unavailable', rlsDetail: 'x',
    });
    assert.ok(checks.some((c) => c.id === 'rls' && c.status === 'WARN'));
  });
});

describe('intake skeleton + admin/ownership schema', () => {
  it('skeleton parses and deliberately FAILS validation (never shippable unedited)', () => {
    const raw = JSON.parse(buildIntakeSkeleton('northstar-2026-01'));
    assert.equal(raw.client.deploymentId, 'northstar-2026-01');
    assert.ok(raw.admin?.name && raw.admin?.email);
    assert.ok(raw.ownership?.supabaseOwner);
    const errors = validateClientConfig(raw);
    assert.ok(errors.length > 0, 'skeleton must fail validation until filled');
    assert.ok(errors.some((e) => e.field.includes('guard')), 'expected guard failures (.invalid domains)');
  });

  it('real admin + ownership sections validate clean', () => {
    const cfg = acme();
    assert.ok(cfg.admin?.email);
    assert.ok(cfg.ownership?.supabaseOwner);
    assert.deepEqual(validateClientConfig(cfg), []);
  });

  it('admin.email gets placeholder/reserved guards; password field rejected', () => {
    const bad = acme() as unknown as Record<string, unknown>;
    (bad.admin as Record<string, unknown>).email = 'admin@example.com';
    assert.ok(validateClientConfig(bad).some((e) => e.field.includes('guard')));
    const pw = acme() as unknown as Record<string, unknown>;
    (pw.admin as Record<string, unknown>).password = 'nope';
    assert.ok(validateClientConfig(pw).some((e) => e.field === 'admin.password'));
  });
});

describe('cross-client domain safety (local output scan, no registry)', () => {
  function seed(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-out-'));
    for (const [id, front, api] of [
      ['acme-2026-01', 'https://learn.acmelearningacademy.com', 'https://api.acmelearningacademy.com'],
      ['other-2026-01', 'https://learn.other.io', 'https://api.other.io'],
    ]) {
      const d = path.join(dir, id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(
        path.join(d, 'client-config.validated.json'),
        JSON.stringify({ client: { name: id, deploymentId: id }, deployment: { frontendDomain: front, apiDomain: api } }),
      );
    }
    return dir;
  }

  it('discovers prior domains and excludes self (no false positive on regen)', () => {
    const dir = seed();
    const entries = collectKnownDomains(dir);
    assert.equal(entries.length, 2);
    const forSelf = knownDomainsExcluding(entries, 'acme-2026-01');
    assert.ok(!forSelf.some((d) => d.includes('acmelearningacademy')));
    assert.ok(forSelf.some((d) => d.includes('other.io')));
    // Reuse of another client's domain is flagged by the existing guard path.
    const north = acme();
    (north as unknown as Record<string, unknown>).client = { name: 'Northstar', deploymentId: 'northstar-2026-01' };
    north.deployment.frontendDomain = 'https://learn.other.io';
    const errors = validateClientConfig(north, { knownDomains: knownDomainsExcluding(entries, 'northstar-2026-01') });
    assert.ok(errors.some((e) => e.field.includes('DOMAIN_REUSE')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('missing dir → empty (no crash, no registry created)', () => {
    assert.deepEqual(collectKnownDomains(path.join(os.tmpdir(), 'no-such-dir-xyz')), []);
  });
});
