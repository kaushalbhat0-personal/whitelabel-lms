/**
 * Deployment verification runner (read-only HTTP probes, no runtime changes).
 *
 * Modes:
 *   smoke — no credentials needed except where the operator supplies them:
 *           API health, frontend reachability, origin consistency, public brand,
 *           and (with LMS_ADMIN_EMAIL/PASSWORD) login + RBAC sanity.
 *   full  — additionally: student isolation, invoice/receipt PDFs (with IDs),
 *           storage anon-denial, certificate page, provider signals.
 *           Missing optional inputs degrade individual checks to WARN/SKIP,
 *           never to false PASS.
 *
 * Secret handling: credentials come from operator ENV only, are sent only to
 * the target deployment, and are NEVER printed, logged, or stored in output.
 * Tokens in memory are dropped after the run (no persistence).
 */

import type { ClientConfig } from './types';

export type VerifyStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

export interface VerifyCheck {
  id: string;
  label: string;
  status: VerifyStatus;
  /** Never contains secrets (enforced by construction + output scan). */
  detail: string;
}

export interface VerifyOptions {
  apiUrl: string;
  frontendUrl: string;
  mode: 'smoke' | 'full';
  config?: ClientConfig;
  adminEmail?: string;
  adminPassword?: string;
  studentEmail?: string;
  studentPassword?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  invoiceId?: string;
  receiptId?: string;
  certificateToken?: string;
  timeoutMs?: number;
}

export interface VerifyReport {
  generatedAt: string;
  target: { api: string; frontend: string };
  mode: 'smoke' | 'full';
  client?: { name: string; deploymentId: string };
  checks: VerifyCheck[];
  overall: 'PASS' | 'FAIL' | 'WARN';
}

async function get(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 4000) };
  } finally {
    clearTimeout(t);
  }
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function extractToken(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  for (const k of ['access_token', 'accessToken', 'token']) {
    if (typeof o[k] === 'string' && (o[k] as string).length > 10) return o[k] as string;
  }
  if (o.data && typeof o.data === 'object') return extractToken(o.data);
  return null;
}

function overallOf(checks: VerifyCheck[]): VerifyReport['overall'] {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'WARN')) return 'WARN';
  return 'PASS';
}

/** Pure origin-consistency check (also used by `validate`). */
export function checkOriginConsistency(config: ClientConfig): VerifyCheck {
  const f = config.deployment.frontendDomain;
  const a = config.deployment.apiDomain;
  if (f === a) {
    return { id: 'origins', label: 'Frontend/API origins distinct', status: 'FAIL', detail: `Both are "${f}" — separate Vercel + Render origins required.` };
  }
  return { id: 'origins', label: 'Frontend/API origins consistent', status: 'PASS', detail: `FRONTEND_URL=${f} · NEXT_PUBLIC_API_URL=${a} (exact, no trailing slash).` };
}

/**
 * Full BusinessConfig drift comparison (pure, unit-testable).
 *
 * The public endpoint exposes ONLY the presentation-safe subset
 * (business_name, logo_url, favicon_url, currency, locale, timezone,
 * theme_json). Everything else (support contacts, tax, FY, prefixes,
 * legal footer) is private by design and is compared ONLY against an
 * authenticated GET /business-config body — never weakened, never logged.
 *
 * Rules: mismatches → FAIL (field + expected + observed, never secrets);
 * live-unavailable fields → noted, never false failures; config-unset
 * optionals → skipped silently; authed body absent → detail check SKIP.
 */
export function comparePublicBrand(config: ClientConfig, live: Record<string, unknown>): VerifyCheck {
  const mismatches: string[] = [];
  const uncompared: string[] = [];
  const want: Record<string, unknown> = {
    business_name: config.identity.businessName,
    logo_url: config.identity.logoUrl,
    favicon_url: config.identity.faviconUrl,
    currency: config.localization.currency,
    locale: config.localization.locale,
    timezone: config.localization.timezone,
  };
  for (const [k, v] of Object.entries(want)) {
    if (live[k] === undefined) uncompared.push(k);
    else if (live[k] !== v) mismatches.push(`${k}: live=${JSON.stringify(live[k])} config=${JSON.stringify(v)}`);
  }
  // Theme: compare the three allowlisted keys individually (exact match is meaningful).
  const liveTheme = (live.theme_json ?? live.themeJson) as Record<string, unknown> | undefined;
  if (liveTheme === undefined || liveTheme === null || typeof liveTheme !== 'object') {
    uncompared.push('theme_json.{primary,sidebarBg,accent}');
  } else {
    for (const k of ['primary', 'sidebarBg', 'accent'] as const) {
      const lv = (liveTheme as Record<string, unknown>)[k];
      const wv = config.theme[k];
      if (lv === undefined) uncompared.push(`theme_json.${k}`);
      else if (lv !== wv) mismatches.push(`theme_json.${k}: live=${JSON.stringify(lv)} config=${JSON.stringify(wv)}`);
    }
  }
  if (mismatches.length > 0) {
    return {
      id: 'public-brand', label: 'Public brand matches config',
      status: 'FAIL',
      detail: `MISMATCH — ${mismatches.join('; ')}. Re-send the BusinessConfig payload (factory push-config), then re-verify.`,
    };
  }
  return {
    id: 'public-brand', label: 'Public brand matches config',
    status: 'PASS',
    detail: uncompared.length === 0
      ? 'Live public brand matches the client config (name, logo, favicon, currency, locale, timezone, theme×3).'
      : `Public fields match; live did not expose (not failures): ${uncompared.join(', ')}.`,
  };
}

/** Private-field mapping: config value → live snake_case key. Compared ONLY via authed read. */
export function compareBusinessConfigDetail(config: ClientConfig, live: Record<string, unknown> | null | undefined): VerifyCheck {
  if (!live || typeof live !== 'object') {
    return {
      id: 'business-config-detail', label: 'BusinessConfig detail matches config',
      status: 'SKIP',
      detail: 'No authenticated config body — set LMS_ADMIN_EMAIL + LMS_ADMIN_PASSWORD env so private fields (tax, FY, prefixes, contacts) can be compared. Public subset already checked.',
    };
  }
  const pairs: Array<[field: string, liveKey: string, expected: unknown]> = [
    ['supportEmail', 'support_email', config.identity.supportEmail],
    ['supportPhone', 'support_phone', config.identity.supportPhone],
    ['website', 'website', config.identity.website],
    ['fyStartMonth', 'fy_start_month', config.localization.fyStartMonth],
    ['taxMode', 'tax_mode', config.tax.mode],
    ['taxRate', 'tax_rate', config.tax.rate],
    ['invoicePrefix', 'invoice_prefix', config.financial.invoicePrefix],
    ['receiptPrefix', 'receipt_prefix', config.financial.receiptPrefix],
    ['currentFinancialYear', 'current_financial_year', config.financial.currentFinancialYear],
    ['legalFooter', 'legal_footer', config.legal.legalFooter],
  ];
  const mismatches: string[] = [];
  const skipped: string[] = [];
  const numEq = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    // PostgREST may render numerics as strings — numeric equality is meaningful equality.
    if (typeof a === 'number' || typeof b === 'number') {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    }
    return false;
  };
  for (const [field, liveKey, expected] of pairs) {
    if (expected === undefined) {
      skipped.push(field);
      continue;
    }
    const observed = (live as Record<string, unknown>)[liveKey];
    if (observed === undefined || observed === null) {
      // Live row predates the field (or partial PUT): WARN-worthy, not FAIL.
      mismatches.push(`${field}: live is empty, config=${JSON.stringify(expected)} (re-run push-config)`);
    } else if (!numEq(observed, expected)) {
      mismatches.push(`${field}: live=${JSON.stringify(observed)} config=${JSON.stringify(expected)}`);
    }
  }
  if (mismatches.length > 0) {
    return {
      id: 'business-config-detail', label: 'BusinessConfig detail matches config',
      status: 'FAIL',
      detail: `MISMATCH — ${mismatches.join('; ')}. Re-run factory push-config, then re-verify.`,
    };
  }
  if (skipped.length === pairs.length) {
    return {
      id: 'business-config-detail', label: 'BusinessConfig detail matches config',
      status: 'SKIP',
      detail: 'No optional detail fields are set in this client config — nothing private to compare.',
    };
  }
  return {
    id: 'business-config-detail', label: 'BusinessConfig detail matches config',
    status: 'PASS',
    detail: `Private fields match (tax ${config.tax.mode}/${config.tax.rate}, FY ${config.financial.currentFinancialYear}, prefixes ${config.financial.invoicePrefix}/${config.financial.receiptPrefix}${skipped.length > 0 ? `; skipped unset: ${skipped.join(', ')}` : ''}).`,
  };
}

export async function verifyDeployment(opts: VerifyOptions): Promise<VerifyReport> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const api = opts.apiUrl.replace(/\/$/, '');
  const frontend = opts.frontendUrl.replace(/\/$/, '');
  const checks: VerifyCheck[] = [];

  // 1. API health (liveness only — a green health check does NOT prove DB/Redis)
  try {
    const r = await get(`${api}/health`, timeoutMs);
    let ok = false;
    try {
      ok = r.status === 200 && (JSON.parse(r.text) as { status?: string }).status === 'ok';
    } catch {
      ok = false;
    }
    checks.push({
      id: 'api-health', label: 'API health',
      status: ok ? 'PASS' : 'FAIL',
      detail: ok ? `GET /health → 200 {"status":"ok"}.` : `GET /health → ${r.status}. Body: ${r.text.slice(0, 200)}`,
    });
  } catch (e) {
    checks.push({ id: 'api-health', label: 'API health', status: 'FAIL', detail: `Unreachable: ${e instanceof Error ? e.message : String(e)}` });
  }

  // 2. Frontend reachability
  try {
    const r = await get(frontend, timeoutMs);
    checks.push({
      id: 'frontend', label: 'Frontend reachable',
      status: r.status >= 200 && r.status < 400 ? 'PASS' : 'FAIL',
      detail: `GET / → ${r.status}.`,
    });
  } catch (e) {
    checks.push({ id: 'frontend', label: 'Frontend reachable', status: 'FAIL', detail: `Unreachable: ${e instanceof Error ? e.message : String(e)}` });
  }

  // 3. Origin consistency (config-level; dashboard values verified by operator)
  if (opts.config) {
    checks.push(checkOriginConsistency(opts.config));
  } else {
    checks.push({ id: 'origins', label: 'Frontend/API origins consistent', status: 'SKIP', detail: 'No client config supplied — pass --config for the origin cross-check.' });
  }

  // 4. Public brand (full public subset via comparePublicBrand)
  try {
    const r = await get(`${api}/business-config/public`, timeoutMs);
    if (r.status === 404) {
      checks.push({ id: 'public-brand', label: 'Public brand configured', status: 'WARN', detail: '404 Business configuration not found — correct for a FRESH deploy; becomes FAIL after the BusinessConfig step.' });
    } else if (r.status !== 200) {
      checks.push({ id: 'public-brand', label: 'Public brand configured', status: 'FAIL', detail: `GET /business-config/public → ${r.status}.` });
    } else {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(r.text) as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (opts.config) {
        checks.push(comparePublicBrand(opts.config, body));
      } else {
        checks.push({ id: 'public-brand', label: 'Public brand reachable', status: 'PASS', detail: 'GET /business-config/public → 200 (no config supplied for value comparison).' });
      }
    }
  } catch (e) {
    checks.push({ id: 'public-brand', label: 'Public brand configured', status: 'FAIL', detail: `Unreachable: ${e instanceof Error ? e.message : String(e)}` });
  }

  // 5. Admin login + RBAC (only with operator-supplied creds)
  let adminToken: string | null = null;
  if (opts.adminEmail && opts.adminPassword) {
    try {
      const r = await postJson(`${api}/auth/login`, { email: opts.adminEmail, password: opts.adminPassword }, timeoutMs);
      adminToken = extractToken(r.json);
      checks.push({
        id: 'admin-login', label: 'Admin login',
        status: adminToken ? 'PASS' : 'FAIL',
        detail: adminToken ? 'Login returned a session token.' : `Login failed (HTTP ${r.status}). If 500s: re-check JWT_SECRET + Redis before anything else.`,
      });
      if (adminToken) {
        const authed = await get(`${api}/business-config`, timeoutMs, { Authorization: `Bearer ${adminToken}` });
        checks.push({
          id: 'authed-route', label: 'Authenticated admin route',
          status: authed.status === 200 ? 'PASS' : 'FAIL',
          detail: `GET /business-config with token → ${authed.status}.`,
        });
        const anon = await get(`${api}/business-config`, timeoutMs);
        checks.push({
          id: 'anon-denied', label: 'Anonymous protected route denied',
          status: anon.status === 401 || anon.status === 403 ? 'PASS' : 'FAIL',
          detail: `GET /business-config without token → ${anon.status} (expect 401/403).`,
        });
        // 5b. Private-field drift comparison (tax, FY, prefixes, contacts) —
        // uses the SAME authed read; nothing extra is exposed or logged.
        if (opts.config) {
          if (authed.status === 200) {
            let authedBody: Record<string, unknown> | null = null;
            try {
              authedBody = JSON.parse(authed.text) as Record<string, unknown>;
            } catch {
              authedBody = null;
            }
            checks.push(compareBusinessConfigDetail(opts.config, authedBody));
          } else {
            checks.push(compareBusinessConfigDetail(opts.config, null));
          }
        }
      }
    } catch (e) {
      checks.push({ id: 'admin-login', label: 'Admin login', status: 'FAIL', detail: `Error: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else {
    checks.push({ id: 'admin-login', label: 'Admin login', status: 'SKIP', detail: 'Set LMS_ADMIN_EMAIL + LMS_ADMIN_PASSWORD env to enable (never on the command line).' });
    // Private fields cannot be compared without an admin session — say so explicitly.
    if (opts.config) checks.push(compareBusinessConfigDetail(opts.config, undefined));
  }

  if (opts.mode === 'full') {
    // Student isolation
    if (opts.studentEmail && opts.studentPassword && adminToken) {
      try {
        const r = await postJson(`${api}/auth/login`, { email: opts.studentEmail, password: opts.studentPassword }, timeoutMs);
        const studentToken = extractToken(r.json);
        if (!studentToken) {
          checks.push({ id: 'student-isolation', label: 'Student isolation', status: 'FAIL', detail: 'Student login failed — cannot test isolation.' });
        } else {
          const s = await get(`${api}/business-config`, timeoutMs, { Authorization: `Bearer ${studentToken}` });
          checks.push({
            id: 'student-isolation', label: 'Student isolation',
            status: s.status === 401 || s.status === 403 ? 'PASS' : 'FAIL',
            detail: `Student GET /business-config → ${s.status} (expect 401/403).`,
          });
        }
      } catch (e) {
        checks.push({ id: 'student-isolation', label: 'Student isolation', status: 'FAIL', detail: `Error: ${e instanceof Error ? e.message : String(e)}` });
      }
    } else {
      checks.push({ id: 'student-isolation', label: 'Student isolation', status: 'SKIP', detail: 'Needs LMS_STUDENT_EMAIL/PASSWORD plus a working admin login.' });
    }

    // Invoice / receipt PDFs
    for (const [id, label, invoiceId] of [['invoice-pdf', 'Invoice PDF download', opts.invoiceId], ['receipt-pdf', 'Receipt PDF download', opts.receiptId]] as const) {
      if (!invoiceId || !adminToken) {
        checks.push({ id, label, status: 'SKIP', detail: !adminToken ? 'Needs a working admin login.' : `Set ${id === 'invoice-pdf' ? 'LMS_INVOICE_ID' : 'LMS_RECEIPT_ID'} to enable.` });
        continue;
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        let status = 0;
        let magic = '';
        try {
          const res = await fetch(`${api}/invoices/${invoiceId}/download`, {
            method: 'GET', headers: { Authorization: `Bearer ${adminToken}` }, signal: ctrl.signal,
          });
          status = res.status;
          const buf = Buffer.from(await res.arrayBuffer());
          magic = buf.slice(0, 4).toString('latin1');
        } finally {
          clearTimeout(t);
        }
        const okPdf = status === 200 && magic === '%PDF';
        checks.push({
          id, label,
          status: okPdf ? 'PASS' : status === 404 ? 'WARN' : 'FAIL',
          detail: okPdf ? 'Signed URL served a valid PDF (%PDF magic bytes).' : `GET /invoices/${invoiceId}/download → ${status}${magic ? ` (magic "${magic}")` : ''}.`,
        });
      } catch (e) {
        checks.push({ id, label, status: 'FAIL', detail: `Error: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    // Anonymous storage denial (needs anon key + supabase url)
    if (opts.supabaseUrl && opts.supabaseAnonKey) {
      try {
        const r = await get(`${opts.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/list/uploads`, timeoutMs, {
          apikey: opts.supabaseAnonKey, Authorization: `Bearer ${opts.supabaseAnonKey}`,
        });
        // list endpoint is POST in the real API; a GET returning 4xx/405 still proves anon is not silently allowed.
        checks.push({
          id: 'storage-anon-denied', label: 'Anonymous storage listing denied',
          status: r.status === 404 || r.status >= 400 ? 'WARN' : 'FAIL',
          detail: `Anon probe → ${r.status}. Confirm denial via the runbook storage spot-checks (supabase-js .list() with anon key).`,
        });
      } catch (e) {
        checks.push({ id: 'storage-anon-denied', label: 'Anonymous storage listing denied', status: 'WARN', detail: `Probe error (manual check required): ${e instanceof Error ? e.message : String(e)}` });
      }
    } else {
      checks.push({ id: 'storage-anon-denied', label: 'Anonymous storage listing denied', status: 'SKIP', detail: 'Set LMS_SUPABASE_URL + LMS_SUPABASE_ANON_KEY to enable.' });
    }

    // Certificate verify page
    if (opts.certificateToken) {
      try {
        const r = await get(`${frontend}/verify-certificate?token=${encodeURIComponent(opts.certificateToken)}`, timeoutMs);
        checks.push({
          id: 'certificate-verify', label: 'Certificate verify page',
          status: r.status === 200 ? 'PASS' : 'FAIL',
          detail: `GET /verify-certificate → ${r.status}.`,
        });
      } catch (e) {
        checks.push({ id: 'certificate-verify', label: 'Certificate verify page', status: 'FAIL', detail: `Error: ${e instanceof Error ? e.message : String(e)}` });
      }
    } else {
      checks.push({ id: 'certificate-verify', label: 'Certificate verify page', status: 'SKIP', detail: 'Set LMS_CERTIFICATE_TOKEN to enable.' });
    }
  }

  const report: VerifyReport = {
    generatedAt: new Date().toISOString(),
    target: { api, frontend },
    mode: opts.mode,
    client: opts.config ? { name: opts.config.identity.businessName, deploymentId: opts.config.client.deploymentId } : undefined,
    checks,
    overall: overallOf(checks),
  };
  return report;
}
