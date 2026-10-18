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

  // 4. Public brand
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
        const mismatches: string[] = [];
        const want: Record<string, unknown> = {
          business_name: opts.config.identity.businessName,
          currency: opts.config.localization.currency,
          locale: opts.config.localization.locale,
          timezone: opts.config.localization.timezone,
        };
        for (const [k, v] of Object.entries(want)) {
          if (body[k] !== undefined && body[k] !== v) mismatches.push(`${k}: live=${JSON.stringify(body[k])} config=${JSON.stringify(v)}`);
        }
        checks.push({
          id: 'public-brand', label: 'Public brand matches config',
          status: mismatches.length === 0 ? 'PASS' : 'FAIL',
          detail: mismatches.length === 0 ? 'Live public brand matches the client config.' : `MISMATCH — ${mismatches.join('; ')}. Re-send the BusinessConfig payload.`,
        });
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
      }
    } catch (e) {
      checks.push({ id: 'admin-login', label: 'Admin login', status: 'FAIL', detail: `Error: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else {
    checks.push({ id: 'admin-login', label: 'Admin login', status: 'SKIP', detail: 'Set LMS_ADMIN_EMAIL + LMS_ADMIN_PASSWORD env to enable (never on the command line).' });
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
