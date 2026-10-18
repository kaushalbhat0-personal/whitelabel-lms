/**
 * Focused tests: DB verification (pure evaluation + GET-only network),
 * origin checks, provider probes, handoff secret exclusion.
 * Run: pnpm factory:test
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { ClientConfig } from '../src/types';
import {
  evaluateDbFacts, fetchDbFacts, dbOverall, MUST_HAVE_TABLES, type DbFacts,
} from '../src/db-verify';
import { checkOriginConsistency } from '../src/deploy-verify';
import { probeProviders } from '../src/provider-probes';
import { buildHandoffReport } from '../src/handoff-report';

function acme(): ClientConfig {
  const p = path.join(__dirname, '..', 'examples', 'acme-learning-academy.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function freshFacts(): DbFacts {
  const counts: Record<string, number | null> = {
    business_config: 0, profiles: 0, courses: 0, batches: 0,
    payments: 0, invoices: 0, receipts: 0, achievement_definitions: 5,
  };
  return {
    tables: [...MUST_HAVE_TABLES, ...Array.from({ length: 67 - MUST_HAVE_TABLES.length }, (_, i) => `extra_table_${i}`)],
    counts, countsErrors: [],
    businessConfigColumns: ['id', 'business_name', 'theme_json'],
    buckets: [{ id: 'uploads', public: false }, { id: 'invoices', public: false }],
    rlsProbe: 'unavailable', rlsDetail: 'pg_tables not exposed via REST — runbook SQL-Editor queries required.',
  };
}

describe('db verification', () => {
  it('PASS on a fresh canonical DB (RLS stays WARN by design)', () => {
    const checks = evaluateDbFacts(freshFacts());
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    assert.equal(byId['tables'].status, 'PASS');
    assert.equal(byId['table-count'].status, 'PASS');
    assert.equal(byId['fresh-rows'].status, 'PASS');
    assert.equal(byId['reference-data'].status, 'PASS');
    assert.equal(byId['theme-column'].status, 'PASS');
    assert.equal(byId['buckets'].status, 'PASS');
    assert.equal(byId['rls'].status, 'WARN');
    assert.equal(dbOverall(checks), 'WARN');
  });

  it('FAILs on live/dirty data, missing tables, public buckets, missing theme column', () => {
    const dirty = freshFacts();
    dirty.counts['profiles'] = 3;
    assert.equal(evaluateDbFacts(dirty).find((c) => c.id === 'fresh-rows')!.status, 'FAIL');

    const missing = freshFacts();
    missing.tables = missing.tables!.filter((t) => t !== 'payments');
    assert.equal(evaluateDbFacts(missing).find((c) => c.id === 'tables')!.status, 'FAIL');

    const pub = freshFacts();
    pub.buckets = [{ id: 'uploads', public: true }, { id: 'invoices', public: false }];
    assert.equal(evaluateDbFacts(pub).find((c) => c.id === 'buckets')!.status, 'FAIL');

    const noTheme = freshFacts();
    noTheme.businessConfigColumns = ['id', 'business_name'];
    assert.equal(evaluateDbFacts(noTheme).find((c) => c.id === 'theme-column')!.status, 'FAIL');
  });

  it('WARNs (not PASS) on table-count drift', () => {
    const drift = freshFacts();
    drift.tables = [...drift.tables!, 'new_feature_table'];
    assert.equal(evaluateDbFacts(drift).find((c) => c.id === 'table-count')!.status, 'WARN');
  });

  it('issues GET requests only (network purity)', async () => {
    const methods: string[] = [];
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init: any) => {
      methods.push(String(init?.method ?? 'GET').toUpperCase());
      const u = String(url);
      const json = async () => {
        if (u.includes('information_schema.tables')) return MUST_HAVE_TABLES.map((table_name) => ({ table_name }));
        if (u.includes('information_schema.columns')) return [{ column_name: 'id' }, { column_name: 'theme_json' }];
        if (u.includes('/storage/v1/bucket')) return [{ id: 'uploads', public: false }, { id: 'invoices', public: false }];
        return [];
      };
      const headers = new Headers();
      if (u.includes('rest/v1/') && !u.includes('information_schema') && !u.includes('pg_tables')) headers.set('content-range', '*/0');
      return { ok: true, status: 200, json, text: async () => '[]', headers } as unknown as Response;
    };
    try {
      const facts = await fetchDbFacts('https://xyz.supabase.co', 'service-role-key');
      assert.ok(methods.length > 0);
      assert.ok(methods.every((m) => m === 'GET'), `non-GET issued: ${methods.join(',')}`);
      assert.equal(facts.counts['profiles'], 0);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});

describe('origin consistency', () => {
  it('passes for distinct exact origins, fails when equal', () => {
    assert.equal(checkOriginConsistency(acme()).status, 'PASS');
    const same = acme();
    same.deployment.apiDomain = same.deployment.frontendDomain;
    assert.equal(checkOriginConsistency(same).status, 'FAIL');
  });
});

describe('provider probes', () => {
  it('reports Acme declared/dormant/stub states honestly', () => {
    const states = Object.fromEntries(probeProviders(acme()).map((p) => [p.provider, p.state]));
    assert.equal(states.bunny, 'DECLARED');
    assert.equal(states.mux, 'DORMANT');
    assert.equal(states.resend, 'STUB');
    assert.equal(states.zoom, 'NOT_CONFIGURED');
  });

  it('flags contradictions from live evidence', () => {
    const states = Object.fromEntries(probeProviders(acme(), { uploadProbeStatus: 503 }).map((p) => [p.provider, p.state]));
    assert.equal(states.bunny, 'CONTRADICTION');
  });
});

describe('handoff report', () => {
  it('is secret-free and marks NOT READY without backup ack', () => {
    const r = buildHandoffReport({
      config: acme(), repoHead: 'abc123',
      verifyChecks: [{ id: 'x', label: 'API health', status: 'PASS', detail: 'ok' }],
      verifyOverall: 'PASS',
      providers: probeProviders(acme()),
      backupAcknowledged: false,
      unresolvedWarnings: [],
    });
    assert.ok(r.includes('NOT READY'));
    assert.ok(!r.includes('SERVICE_ROLE') && !r.includes('SECRET'));
  });

  it('marks READY FOR HANDOFF when gates pass', () => {
    const r = buildHandoffReport({
      config: acme(), repoHead: 'abc123',
      dbChecks: evaluateDbFacts(freshFacts()).filter((c) => c.id !== 'rls'),
      verifyChecks: [{ id: 'x', label: 'API health', status: 'PASS', detail: 'ok' }],
      verifyOverall: 'PASS',
      providers: probeProviders(acme()),
      backupAcknowledged: true,
      unresolvedWarnings: [],
    });
    assert.ok(r.includes('READY FOR HANDOFF'));
  });
});

afterEach(() => {
  // Safety: never leak a mocked fetch between test files in the same process.
  if ((globalThis as any).fetch && (globalThis as any).fetch.isFactoryMock) {
    delete (globalThis as any).fetch;
  }
});
