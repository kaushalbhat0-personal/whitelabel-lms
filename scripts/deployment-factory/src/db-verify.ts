/**
 * Read-only fresh-database verifier.
 *
 * Why this file exists:
 *   - The SQL-Editor paste is manual; verifying its RESULT should not be.
 *   - Every check mirrors docs/deployment.md §1 verification queries.
 *   - READ-ONLY: only HTTP GET requests are ever issued (asserted in tests).
 *     No writes, no DDL, no deletes, no resets.
 *   - Checks that PostgREST cannot answer (pg_tables/pg_policies live in
 *     pg_catalog, not exposed via REST) return WARN with the exact SQL-Editor
 *     query to run — never a false PASS.
 */

export type DbStatus = 'PASS' | 'FAIL' | 'WARN';

export interface DbCheck {
  id: string;
  label: string;
  status: DbStatus;
  detail: string;
}

/** Must-have tables from the runbook (expect zero missing). */
export const MUST_HAVE_TABLES = [
  'business_config', 'profiles', 'courses', 'batches', 'sessions',
  'recordings', 'live_sessions', 'payments', 'tests', 'test_attempts',
  'certificates', 'achievement_definitions', 'notifications',
];

/** Expected base table count today (grows only when migrations are added). */
export const EXPECTED_TABLE_COUNT = 67;

export interface DbFacts {
  tables: string[] | null;
  tablesError?: string;
  counts: Record<string, number | null>;
  countsErrors: string[];
  businessConfigColumns: string[] | null;
  businessConfigColumnsError?: string;
  buckets: Array<{ id: string; public: boolean }> | null;
  bucketsError?: string;
  rlsProbe: 'unavailable' | 'ok' | 'failed';
  rlsDetail: string;
}

async function restGet(base: string, key: string, p: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${p}`, {
    method: 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}

/** Fetch observable facts via Supabase REST/Storage (GET only). */
export async function fetchDbFacts(supabaseUrl: string, serviceRoleKey: string): Promise<DbFacts> {
  const base = supabaseUrl.replace(/\/$/, '');
  const facts: DbFacts = {
    tables: null, counts: {}, countsErrors: [],
    businessConfigColumns: null, buckets: null,
    rlsProbe: 'unavailable', rlsDetail: '',
  };

  try {
    const res = await restGet(base, serviceRoleKey, 'information_schema.tables?table_schema=eq.public&table_type=eq.BASE%20TABLE&select=table_name');
    if (!res.ok) facts.tablesError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    else facts.tables = ((await res.json()) as Array<{ table_name: string }>).map((r) => r.table_name);
  } catch (e) {
    facts.tablesError = e instanceof Error ? e.message : String(e);
  }

  for (const t of ['business_config', 'profiles', 'courses', 'batches', 'payments', 'invoices', 'receipts', 'achievement_definitions']) {
    try {
      const res = await fetch(`${base}/rest/v1/${t}?select=id&limit=0`, {
        method: 'GET',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Prefer: 'count=exact' },
      });
      if (!res.ok) {
        facts.counts[t] = null;
        facts.countsErrors.push(`${t}: HTTP ${res.status}`);
      } else {
        const cr = res.headers.get('content-range') ?? '';
        const m = cr.match(/\/(\d+)\s*$/);
        facts.counts[t] = m ? parseInt(m[1], 10) : null;
        if (facts.counts[t] === null) facts.countsErrors.push(`${t}: no content-range (got "${cr}")`);
      }
    } catch (e) {
      facts.counts[t] = null;
      facts.countsErrors.push(`${t}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const res = await restGet(base, serviceRoleKey, 'information_schema.columns?table_schema=eq.public&table_name=eq.business_config&select=column_name');
    if (!res.ok) facts.businessConfigColumnsError = `HTTP ${res.status}`;
    else facts.businessConfigColumns = ((await res.json()) as Array<{ column_name: string }>).map((r) => r.column_name);
  } catch (e) {
    facts.businessConfigColumnsError = e instanceof Error ? e.message : String(e);
  }

  try {
    const res = await fetch(`${base}/storage/v1/bucket`, {
      method: 'GET',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!res.ok) facts.bucketsError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    else {
      const arr = (await res.json()) as Array<{ id: string; public: boolean }>;
      facts.buckets = arr.map((b) => ({ id: b.id, public: !!b.public }));
    }
  } catch (e) {
    facts.bucketsError = e instanceof Error ? e.message : String(e);
  }

  // pg_catalog is not exposed via PostgREST — prove it, then defer to SQL Editor.
  try {
    const res = await restGet(base, serviceRoleKey, 'pg_tables?select=tablename&schemaname=eq.public&limit=1');
    if (res.ok) {
      facts.rlsProbe = 'ok';
      facts.rlsDetail = 'pg_tables unexpectedly readable via REST — extend this verifier to check rowsecurity directly.';
    } else {
      facts.rlsProbe = 'unavailable';
      facts.rlsDetail = `pg_tables not exposed via REST (HTTP ${res.status}) — run the runbook RLS queries in SQL Editor.`;
    }
  } catch (e) {
    facts.rlsProbe = 'unavailable';
    facts.rlsDetail = `pg_tables not reachable via REST (${e instanceof Error ? e.message : String(e)}) — run the runbook RLS queries in SQL Editor.`;
  }

  return facts;
}

const SQL_RLS_FALLBACK = [
  "SELECT count(*) AS rls_off_tables FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'pg_%' AND NOT rowsecurity; -- expect 0",
  "SELECT count(*) AS open_policies FROM pg_policies WHERE schemaname='public' AND (qual LIKE '%true%' OR with_check LIKE '%true%'); -- expect 0",
  "SELECT id, public FROM storage.buckets WHERE id IN ('uploads','invoices'); -- expect false,false",
].join('\n');

/** Pure evaluation of fetched facts → checks. Fully unit-testable. */
export function evaluateDbFacts(facts: DbFacts): DbCheck[] {
  const checks: DbCheck[] = [];

  if (facts.tables === null) {
    checks.push({ id: 'tables', label: 'Public tables readable', status: 'FAIL', detail: facts.tablesError ?? 'unknown error' });
  } else {
    const missing = MUST_HAVE_TABLES.filter((t) => !facts.tables!.includes(t));
    checks.push({
      id: 'tables', label: 'Must-have tables present',
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      detail: missing.length === 0 ? `${facts.tables.length} base tables; all ${MUST_HAVE_TABLES.length} must-haves present.` : `MISSING: ${missing.join(', ')} — STOP, do not overwrite; escalate.`,
    });
    checks.push({
      id: 'table-count', label: 'Table count matches boundary',
      status: facts.tables.length === EXPECTED_TABLE_COUNT ? 'PASS' : 'WARN',
      detail: `Found ${facts.tables.length}, expected ${EXPECTED_TABLE_COUNT}. Drift is OK only if migrations were added (then update EXPECTED_TABLE_COUNT + runbook).`,
    });
  }

  const zeroTables = ['business_config', 'profiles', 'courses', 'batches', 'payments', 'invoices', 'receipts'];
  const nonZero = zeroTables.filter((t) => facts.counts[t] !== 0);
  const unreadable = zeroTables.filter((t) => facts.counts[t] === null || facts.counts[t] === undefined);
  if (unreadable.length === zeroTables.length && facts.countsErrors.length > 0) {
    checks.push({ id: 'fresh-rows', label: 'Fresh state (0 app rows)', status: 'FAIL', detail: `Counts unreadable: ${facts.countsErrors.join('; ')}` });
  } else if (nonZero.length > 0) {
    const detail = nonZero.map((t) => `${t}=${facts.counts[t]}`).join(', ');
    checks.push({ id: 'fresh-rows', label: 'Fresh state (0 app rows)', status: 'FAIL', detail: `Non-zero application rows: ${detail}. Expected a FRESH database — STOP and escalate (possible overwrite of live data).` });
  } else {
    checks.push({ id: 'fresh-rows', label: 'Fresh state (0 app rows)', status: 'PASS', detail: `All zero: ${zeroTables.join(', ')}. No demo/client data present.${unreadable.length > 0 ? ` (unreadable, treated as 0-risk pending: ${unreadable.join(', ')})` : ''}` });
  }

  const ach = facts.counts['achievement_definitions'];
  checks.push({
    id: 'reference-data', label: 'Reference data (achievement_definitions=5)',
    status: ach === 5 ? 'PASS' : ach === null || ach === undefined ? 'FAIL' : 'FAIL',
    detail: ach === 5 ? '5 reference rows from migration 017.' : `Expected 5, got ${ach === null || ach === undefined ? 'unreadable' : ach}. ${facts.countsErrors.join('; ')}`,
  });

  if (facts.businessConfigColumns === null) {
    checks.push({ id: 'theme-column', label: 'business_config.theme_json exists', status: 'FAIL', detail: facts.businessConfigColumnsError ?? 'unreadable' });
  } else {
    checks.push({
      id: 'theme-column', label: 'business_config.theme_json exists',
      status: facts.businessConfigColumns.includes('theme_json') ? 'PASS' : 'FAIL',
      detail: facts.businessConfigColumns.includes('theme_json') ? 'theme_json column present (migration 039).' : 'theme_json MISSING — migration 039 not applied correctly.',
    });
  }

  if (facts.buckets === null) {
    checks.push({ id: 'buckets', label: 'Storage buckets private', status: 'FAIL', detail: facts.bucketsError ?? 'unreadable' });
  } else {
    const need = ['uploads', 'invoices'];
    const missing = need.filter((b) => !facts.buckets!.some((x) => x.id === b));
    const pub = facts.buckets!.filter((x) => need.includes(x.id) && x.public);
    checks.push({
      id: 'buckets', label: 'Storage buckets private',
      status: missing.length === 0 && pub.length === 0 ? 'PASS' : 'FAIL',
      detail: missing.length > 0
        ? `MISSING buckets: ${missing.join(', ')} — apply migration 040 section; never hand-create public buckets.`
        : pub.length > 0
          ? `PUBLIC buckets (must be private): ${pub.map((b) => b.id).join(', ')}.`
          : 'uploads + invoices both present and private.',
    });
  }

  checks.push({
    id: 'rls', label: 'RLS default-deny (67/67)',
    status: 'WARN',
    detail: `${facts.rlsDetail} Run in SQL Editor:\n${SQL_RLS_FALLBACK}`,
  });

  return checks;
}

export function dbOverall(checks: DbCheck[]): DbCheck['status'] {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'WARN')) return 'WARN';
  return 'PASS';
}
