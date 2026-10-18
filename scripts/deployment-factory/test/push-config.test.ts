/**
 * P0-1 tests: local BusinessConfig push helper (mocked network only).
 * Run: pnpm factory:test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { ClientConfig } from '../src/types';
import { pushBusinessConfig } from '../src/push-config';
import { scanTextForSecrets } from '../src/secret-scan';

function acme(): ClientConfig {
  const p = path.join(__dirname, '..', 'examples', 'acme-learning-academy.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const TOKEN = 'mock-admin-token-0123456789abcdef';

function mockFetch(routes: Record<string, { status: number; json: unknown }>) {
  return (async (url: string, _init: unknown) => {
    const u = String(url);
    const key = u.includes('/auth/login') ? 'login' : u.includes('/business-config') ? 'put' : 'other';
    const r = routes[key] ?? { status: 404, json: null };
    return { status: r.status, json: async () => r.json } as unknown as Response;
  }) as unknown as typeof fetch;
}

const CRED = { adminEmail: 'admin@acmelearningacademy.com', adminPassword: 's3cret-op-env-only' };

describe('push-config', () => {
  it('throws on missing API URL', async () => {
    await assert.rejects(() => pushBusinessConfig({ apiUrl: '', config: acme(), ...CRED }), /apiUrl/);
  });

  it('throws on missing credentials (never CLI — env only)', async () => {
    await assert.rejects(
      () => pushBusinessConfig({ apiUrl: 'https://api.x.io', config: acme(), adminPassword: 'x' }),
      /LMS_ADMIN_EMAIL/,
    );
    await assert.rejects(
      () => pushBusinessConfig({ apiUrl: 'https://api.x.io', config: acme(), adminEmail: 'a@b.io' }),
      /LMS_ADMIN_PASSWORD/,
    );
  });

  it('reports unreachable API without throwing', async () => {
    const failing = (() => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    const r = await pushBusinessConfig({ apiUrl: 'https://api.x.io', config: acme(), ...CRED, fetchFn: failing });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.ok(r.detail.includes('unreachable'));
  });

  it('fails clearly on 401 login', async () => {
    const r = await pushBusinessConfig({
      apiUrl: 'https://api.x.io', config: acme(), ...CRED,
      fetchFn: mockFetch({ login: { status: 401, json: { message: 'Unauthorized' } } }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.ok(r.detail.includes('first-admin'));
  });

  it('fails clearly on 403 login', async () => {
    const r = await pushBusinessConfig({
      apiUrl: 'https://api.x.io', config: acme(), ...CRED,
      fetchFn: mockFetch({ login: { status: 403, json: { message: 'Forbidden' } } }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  it('fails clearly on 400 PUT (shape rejected)', async () => {
    const r = await pushBusinessConfig({
      apiUrl: 'https://api.x.io', config: acme(), ...CRED,
      fetchFn: mockFetch({
        login: { status: 200, json: { access_token: TOKEN } },
        put: { status: 400, json: { message: 'Bad Request' } },
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.ok(r.detail.includes('factory defect'));
  });

  it('fails clearly on 500 PUT', async () => {
    const r = await pushBusinessConfig({
      apiUrl: 'https://api.x.io', config: acme(), ...CRED,
      fetchFn: mockFetch({
        login: { status: 200, json: { access_token: TOKEN } },
        put: { status: 500, json: null },
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  });

  it('succeeds on 2xx with field counts, no credentials in evidence', async () => {
    const seen: string[] = [];
    const spy = (async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      seen.push(String(url));
      if (String(url).includes('/business-config')) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.businessName, 'Acme Learning Academy');
        assert.equal(body.taxMode, 'exclusive');
        // Auth header carries the live token (in memory only — never in evidence).
        assert.ok(String(init.headers?.Authorization ?? '').startsWith('Bearer '));
      }
      if (String(url).includes('/auth/login')) return { status: 200, json: async () => ({ access_token: TOKEN }) };
      return { status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const r = await pushBusinessConfig({ apiUrl: 'https://api.x.io/', config: acme(), ...CRED, fetchFn: spy });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.ok(r.fieldCount > 10);
    assert.ok(r.fieldsSent.includes('businessName') && r.fieldsSent.includes('themeJson'));
    assert.equal(r.client.deploymentId, 'acme-2026-01');
    assert.deepEqual(seen.length, 2);
    // Evidence must never carry the password, the token, or request bodies.
    const ev = JSON.stringify(r);
    assert.ok(!ev.includes(CRED.adminPassword));
    assert.ok(!ev.includes(TOKEN));
    assert.deepEqual(scanTextForSecrets(ev), []);
  });

  it('is reversible by re-running (idempotent PUT shape)', async () => {
    const putBodies: string[] = [];
    const spy = (async (url: string, init: { body?: string }) => {
      if (String(url).includes('/business-config')) putBodies.push(String(init.body));
      if (String(url).includes('/auth/login')) return { status: 200, json: async () => ({ access_token: TOKEN }) };
      return { status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const a = await pushBusinessConfig({ apiUrl: 'https://api.x.io', config: acme(), ...CRED, fetchFn: spy });
    const b = await pushBusinessConfig({ apiUrl: 'https://api.x.io', config: acme(), ...CRED, fetchFn: spy });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(putBodies[0], putBodies[1]);
  });
});
