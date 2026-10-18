/**
 * Local BusinessConfig push helper (replaces the hand-assembled HTTP PUT).
 *
 * Why this file exists:
 *   - The operator previously had to hand-PUT business-config.payload.json
 *     (curl/UI with a pasted admin token) — a transcription + credential
 *     handling risk on every deployment.
 *   - This helper derives the payload from the SAME validated config +
 *     SAME generator as the artifact, logs in with operator ENV creds only,
 *     and PUTs the complete payload in one call. Re-running is the rollback.
 *
 * Safety guarantees:
 *   - Credentials ONLY from operator ENV (LMS_ADMIN_EMAIL/LMS_ADMIN_PASSWORD).
 *     No --password/--token/--jwt/--secret flags exist and never will.
 *   - Credentials are never written to files, never logged, never echoed.
 *   - Evidence output contains counts/keys/status only — no bodies, no tokens.
 *   - BusinessConfig itself is non-secret (same payload as the artifact).
 *   - Never touches infrastructure APIs — one app-level PUT only.
 */

import type { ClientConfig } from './types';
import { buildBusinessConfigPayload } from './business-config';

export interface PushConfigInput {
  apiUrl: string;
  config: ClientConfig;
  adminEmail?: string;
  adminPassword?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface PushConfigResult {
  generatedAt: string;
  target: { api: string };
  client: { name: string; deploymentId: string };
  /** Payload keys sent (names only — never values, never secrets). */
  fieldsSent: string[];
  fieldCount: number;
  /** HTTP status of the PUT (0 = unreachable). */
  status: number;
  ok: boolean;
  /** Human-readable, secret-free outcome. */
  detail: string;
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

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Validate-derive-login-PUT. Pure except for the two HTTP calls.
 * Throws on missing input; returns ok:false (never throws) for HTTP failures.
 */
export async function pushBusinessConfig(input: PushConfigInput): Promise<PushConfigResult> {
  const at = new Date().toISOString();
  const base = (input.apiUrl ?? '').replace(/\/$/, '');
  const fail = (status: number, detail: string, fieldsSent: string[] = []): PushConfigResult => ({
    generatedAt: at,
    target: { api: base || '(missing api url)' },
    client: { name: input.config.identity.businessName, deploymentId: input.config.client.deploymentId },
    fieldsSent,
    fieldCount: fieldsSent.length,
    status,
    ok: false,
    detail,
  });

  if (!base) throw new Error('apiUrl is required (pass --api https://api.client.com).');
  if (!input.adminEmail || !input.adminPassword) {
    throw new Error('Set LMS_ADMIN_EMAIL + LMS_ADMIN_PASSWORD in the operator environment (never on the command line).');
  }

  const payload = buildBusinessConfigPayload(input.config);
  const fieldsSent = Object.keys(payload);
  const timeoutMs = input.timeoutMs ?? 15000;
  const doFetch = input.fetchFn ?? fetch;

  // 1. Login (admin token stays in memory only).
  let token: string | null = null;
  try {
    const res = await withTimeout(
      doFetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: input.adminEmail, password: input.adminPassword }),
      }),
      timeoutMs,
    );
    let json: unknown = null;
    try {
      json = await (res as Response).json();
    } catch {
      json = null;
    }
    token = extractToken(json);
    if (!token) {
      const hint =
        (res as Response).status === 401 || (res as Response).status === 403
          ? 'Admin credentials rejected — confirm the first-admin user exists and the password is current.'
          : (res as Response).status >= 500
            ? 'Login failed with a server error — re-check JWT_SECRET + Redis + SUPABASE_* on the API before anything else.'
            : 'Login did not return a session token.';
      return fail((res as Response).status, `Login failed (HTTP ${(res as Response).status}). ${hint}`);
    }
  } catch (e) {
    return fail(0, `API unreachable during login: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. PUT the complete payload. The live token travels ONLY in this
  // request header — it is never logged, stored, or placed in evidence.
  // (Evidence carries field names/counts/status, never headers or bodies.)
  try {
    const res = await withTimeout(
      doFetch(`${base}/business-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }),
      timeoutMs,
    );
    const status = (res as Response).status;
    if (status >= 200 && status < 300) {
      return {
        generatedAt: at,
        target: { api: base },
        client: { name: input.config.identity.businessName, deploymentId: input.config.client.deploymentId },
        fieldsSent,
        fieldCount: fieldsSent.length,
        status,
        ok: true,
        detail: `PUT /business-config → ${status}. ${fieldsSent.length} fields applied (${fieldsSent.join(', ')}). Re-run to correct drift.`,
      };
    }
    let hint = 'Check the payload against the API DTO and retry.';
    if (status === 401 || status === 403) hint = 'Token rejected — the admin session may lack the admin role. Re-check the first-admin profile row.';
    else if (status === 400) hint = 'API rejected the payload shape — this is a factory defect if the config passed validation. Report it, do not hand-edit.';
    else if (status >= 500) hint = 'Server error — re-check API logs; do NOT retry blindly more than twice.';
    return fail(status, `PUT /business-config → ${status}. ${hint}`, fieldsSent);
  } catch (e) {
    return fail(0, `API unreachable during PUT: ${e instanceof Error ? e.message : String(e)}`, fieldsSent);
  }
}
