import { test, expect, request as pwRequest } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { getDb } from '../utils/db-helpers';
import { loginAs } from '../utils/login-helpers';
import * as fs from 'fs';
import * as path from 'path';

const WEB = process.env.WEB_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:3001';

function cacheFor(token: string, userId: string, email: string, role: string, sessionCount: number) {
  return {
    version: 1,
    user: { id: userId, name: role === 'admin' ? 'Admin' : 'Student A', email, role },
    token,
    mustChangePassword: false,
    sessionCount,
    expiresAt: Date.now() + 60 * 60 * 1000,
    updatedAt: Date.now(),
  };
}

async function primeAuth(page: any, token: string, userId: string, email: string, role: string, sessionCount = 1) {
  const cache = cacheFor(token, userId, email, role, sessionCount);
  await page.addInitScript((c: any) => {
    try { localStorage.setItem('session_persistence', JSON.stringify(c)); } catch {}
  }, cache);
  await page.context().addCookies([
    { name: 'access_token', value: token, url: WEB },
    { name: 'must_change_password', value: 'false', url: WEB },
  ]);
}

function collectErrors(page: any) {
  const pageErrors: string[] = [];
  page.on('pageerror', (e: any) => pageErrors.push(String(e).slice(0, 400)));
  page.on('console', (m: any) => {
    if (m.type() === 'error') {
      const txt = m.text().slice(0, 500);
      if (txt.includes('Download the React DevTools')) return;
      if (txt.includes('Failed to load resource')) return;
      pageErrors.push(txt);
    }
  });
  return { pageErrors };
}

async function holdLoginRoute(page: any) {
  let release: () => void = () => {};
  const held = new Promise<void>((res) => { release = res; });
  let heldActive = true;
  await page.context().route('**/login', async (route) => {
    if (heldActive && route.request().resourceType() === 'document') {
      await held;
    }
    await route.continue();
  });
  return () => { heldActive = false; release(); };
}

test.describe('Phase C1 — Logout Pending & Race Hardening', () => {
  let admin: { email: string; password: string; token: string; userId: string; cleanup: () => Promise<void> };
  let student: { email: string; password: string; token: string; userId: string; cleanup: () => Promise<void> };

  test.beforeAll(async () => {
    // Reset rate limiter to allow fresh logins
    try {
      const envPath = path.resolve(__dirname, '../../apps/api/.env');
      let redisUrl = process.env.REDIS_URL || '';
      if (!redisUrl && fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const m = content.match(/REDIS_URL\s*=\s*"?([^"\n]+)"?/);
        if (m) redisUrl = m[1].trim().replace(/^"|"$/g, '');
      }
      if (redisUrl) {
        const Redis = (await import('ioredis')).default;
        const redis: any = new Redis(redisUrl);
        const keys: string[] = await redis.keys('ratelimit:login:*');
        if (keys.length) await redis.del(...keys);
        await redis.quit();
        console.log(`[beforeAll] cleared ${keys.length} rate-limit keys`);
      }
    } catch (e) { console.log('rate limit reset failed', String(e).slice(0,200)); }

    const db = getDb();
    async function ensureUser(role: 'admin' | 'student'): Promise<{ email: string; password: string; token: string; userId: string; cleanup: () => Promise<void> }> {
      const uniq = `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      const email = `e2e-logout-${role}-${uniq}@example.com`;
      const password = `Test${uniq}!A1b`;
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } });
      if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
      const userId = data.user.id;
      const { error: pErr } = await db.from('profiles').upsert({ id: userId, email, role, name: `${role} ${uniq}`, is_active: true } as any, { onConflict: 'id' });
      if (pErr) console.warn('profile upsert', pErr.message);
      // Do not login here — let the test do UI login as first login to avoid SESSION_REPLACED
      const cleanup = async () => {
        try { await db.from('profiles').delete().eq('id', userId); } catch {}
        try { await db.auth.admin.deleteUser(userId); } catch {}
      };
      return { email, password, token: '', userId, cleanup };
    }
    admin = await ensureUser('admin');
    student = await ensureUser('student');
    console.log(`[beforeAll] admin ${admin.email} student ${student.email}`);
  });

  test.afterAll(async () => {
    await admin?.cleanup().catch(()=>{});
    await student?.cleanup().catch(()=>{});
  });

  test('T1 — Admin normal logout shows pending and navigates to /login', async ({ page }) => {
    const { pageErrors } = collectErrors(page);
    let logoutPosts = 0;
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') logoutPosts++;
      await route.continue();
    });
    // UI login to ensure real session and Redis entry
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.locator('#email').fill(admin.email);
    await page.locator('#password').fill(admin.password);
    await page.getByRole('button', { name: /Sign in|Signing in/ }).click();
    await page.waitForURL('**/admin', { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Admin|Command Center/i, { timeout: 10000 });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled && (b.textContent || '').includes('Signing out');
    }, { timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('button[aria-busy="true"] svg[aria-hidden="true"]') !== null, { timeout: 2000 });
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(page.url()).toContain('/login');
    expect(logoutPosts).toBeLessThanOrEqual(1);
    expect(pageErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('T2 — Student sidebar logout shows pending and navigates', async ({ page }) => {
    const { pageErrors } = collectErrors(page);
    let logoutPosts = 0;
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') logoutPosts++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, student.token, student.userId, student.email, 'student', 1);
    await page.goto(`${WEB}/student`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(/Student|Dashboard/i, { timeout: 10000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    const btn = page.getByRole('button', { name: /Sign out|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(btn).toBeDisabled({ timeout: 2000 });
    await expect(btn).toContainText(/Signing out/i, { timeout: 2000 });
    await expect(btn.locator('svg[aria-hidden="true"]')).toBeVisible({ timeout: 2000 });
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(logoutPosts).toBeLessThanOrEqual(1);
    expect(pageErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('T3 — Student profile logout shows pending and navigates', async ({ page }) => {
    const { pageErrors } = collectErrors(page);
    let logoutPosts = 0;
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') logoutPosts++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, student.token, student.userId, student.email, 'student', 1);
    await page.goto(`${WEB}/student/profile`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(/Logout|Batches|Change Password/i, { timeout: 10000 });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(btn).toBeDisabled({ timeout: 2000 });
    await expect(btn).toContainText(/Signing out/i, { timeout: 2000 });
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(logoutPosts).toBeLessThanOrEqual(1);
    expect(pageErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('T4 — Double/triple click yields one logical logout and one POST', async ({ page }) => {
    let postCount = 0;
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') {
        postCount++;
        await new Promise((r) => setTimeout(r, 1200));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
      await route.continue();
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 1);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const p1 = btn.click().catch(() => {});
    const p2 = btn.click({ force: true }).catch(() => {});
    const p3 = btn.click({ force: true }).catch(() => {});
    await Promise.allSettled([p1, p2, p3]);
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(btn).toBeDisabled({ timeout: 2000 });
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
    await page.waitForTimeout(1500);
    expect(postCount).toBeLessThanOrEqual(1);
  });

  test('T5 — Slow logout network still shows pending immediately and navigates without waiting', async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((res) => { release = res; });
    let logoutSeen = false;
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') {
        logoutSeen = true;
        await held;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
      await route.continue();
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 1);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const navStart = Date.now();
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 1500 });
    await expect(btn).toBeDisabled({ timeout: 1500 });
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 4000 });
    const elapsed = Date.now() - navStart;
    expect(logoutSeen).toBe(true);
    expect(elapsed).toBeLessThan(3000);
    release();
    await page.waitForTimeout(600);
    expect(page.url()).toContain('/login');
  });

  test('T6 — Logout plus in-flight 401 does not cause second hard redirect', async ({ page }) => {
    let logoutPosts = 0;
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    let releaseLogout: () => void = () => {};
    const holdLogout = new Promise<void>((r) => { releaseLogout = r; });
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') {
        logoutPosts++;
        await holdLogout;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
      await route.continue();
    });
    await page.context().route('**/courses/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) });
        return;
      }
      await route.continue();
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 2);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await page.evaluate(async (api) => {
      fetch(`${api}/courses/my`, { headers: { Authorization: `Bearer test` } }).catch(() => {});
    }, API).catch(() => {});
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 6000 });
    const loginNavs = navigations.filter((u) => u.includes('/login'));
    expect(loginNavs.length).toBeLessThanOrEqual(2);
    expect(logoutPosts).toBeLessThanOrEqual(1);
    releaseLogout();
    await page.waitForTimeout(400);
    expect(page.url()).toContain('/login');
  });

  test('T7 — Expired/takeover overlay logout does not POST unnecessarily', async ({ page }) => {
    let logoutPosts = 0;
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') logoutPosts++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    const expiredCache = {
      version: 1,
      user: { id: admin.userId, name: 'Admin', email: admin.email, role: 'admin' },
      token: 'expired.invalid.token',
      mustChangePassword: false,
      sessionCount: 5,
      expiresAt: Date.now() - 10_000,
      updatedAt: Date.now() - 20_000,
    };
    await page.addInitScript((c: any) => {
      try { localStorage.setItem('session_persistence', JSON.stringify(c)); } catch {}
    }, expiredCache);
    await page.context().addCookies([
      { name: 'access_token', value: 'expired.invalid.token', url: WEB },
      { name: 'must_change_password', value: 'false', url: WEB },
    ]);
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const overlayBtn = page.getByRole('button', { name: /Go to Login|Signing out/ }).first();
    await expect(overlayBtn).toBeVisible({ timeout: 10000 });
    await overlayBtn.click({ noWaitAfter: true });
    await expect(overlayBtn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(overlayBtn).toBeDisabled({ timeout: 2000 });
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(logoutPosts).toBe(0);
  });

  test('T8 — UnauthorizedPage without auth shows Go to Login with pending', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => {
      try { localStorage.removeItem('session_persistence'); } catch {}
    });
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Go to Login|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Session Expired|Unauthorized|Access Denied/i, { timeout: 4000 });
    let logoutPosts = 0;
    await page.context().unroute('**/auth/logout');
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') logoutPosts++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(btn).toBeDisabled({ timeout: 2000 });
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 6000 });
    expect(logoutPosts).toBe(0);
  });

  test('T9 — Older logout broadcast must not destroy newer session (multi-context race)', async ({ page }) => {
    const newerCount = 5;
    const olderCount = 3;
    const newerCache = cacheFor(admin.token, admin.userId, admin.email, 'admin', newerCount);
    await page.addInitScript((c: any) => {
      try { localStorage.setItem('session_persistence', JSON.stringify(c)); } catch {}
    }, newerCache);
    await page.context().addCookies([
      { name: 'access_token', value: admin.token, url: WEB },
      { name: 'must_change_password', value: 'false', url: WEB },
    ]);
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
    });
    await page.context().route('**/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: admin.userId, email: admin.email, role: 'admin' } }) });
    });
    await page.context().route('http://localhost:3001/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/')) await route.continue();
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(/Admin/i, { timeout: 10000 });
    const clearResult = await page.evaluate(async (older) => {
      const raw = localStorage.getItem('session_persistence');
      if (!raw) return { kept: false };
      const parsed = JSON.parse(raw);
      if (typeof parsed.sessionCount === 'number' && parsed.sessionCount > older) {
        return { kept: true, current: parsed.sessionCount };
      }
      return { kept: false };
    }, olderCount);
    expect(clearResult.kept).toBe(true);
    const stillThere = await page.evaluate(() => {
      const raw = localStorage.getItem('session_persistence');
      if (!raw) return false;
      try { return JSON.parse(raw).sessionCount === 5; } catch { return false; }
    });
    expect(stillThere).toBe(true);
    await page.evaluate(async (older) => {
      const bc = new BroadcastChannel('mct-auth-channel');
      bc.postMessage({ type: 'auth:logout', sessionCount: older });
      bc.close();
      await new Promise((r) => setTimeout(r, 400));
    }, olderCount);
    const afterBroadcast = await page.evaluate(() => {
      const raw = localStorage.getItem('session_persistence');
      if (!raw) return null;
      try { return JSON.parse(raw).sessionCount; } catch { return null; }
    });
    expect(afterBroadcast).toBe(newerCount);
    expect(page.url()).toContain('/admin');
  });

  test('T10 — Mobile 375x812 logout CTA meets 44px and no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
      else await route.continue();
    });
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
    });
    await page.context().route('**/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: admin.userId, email: admin.email, role: 'admin' } }) });
    });
    await page.context().route('http://localhost:3001/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/')) await route.continue();
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 1);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
  });

  test('T11 — Mobile 390x844 logout CTA meets 44px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
      else await route.continue();
    });
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
    });
    await page.context().route('**/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: admin.userId, email: admin.email, role: 'admin' } }) });
    });
    await page.context().route('http://localhost:3001/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/')) await route.continue();
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 1);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
  });

  test('T12 — Reduced motion still shows accessible pending', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
      else await route.continue();
    });
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
    });
    await page.context().route('**/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: admin.userId, email: admin.email, role: 'admin' } }) });
    });
    await page.context().route('http://localhost:3001/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/')) await route.continue();
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    const releaseLogin = await holdLoginRoute(page);
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 1);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await expect(btn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(btn).toBeDisabled({ timeout: 2000 });
    await expect(btn).toContainText(/Signing out/i, { timeout: 2000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    releaseLogin();
    await page.waitForURL('**/login', { timeout: 8000 });
  });

  test('T13 — Axe accessibility on logout surfaces', async ({ page }) => {
    await page.context().route('**/auth/validate-session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
    });
    await page.context().route('**/auth/me', async (route) => {
      if (page.url().includes('/student')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: student.userId, email: student.email, role: 'student' } }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: admin.userId, email: admin.email, role: 'admin' } }) });
      }
    });
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
      else await route.continue();
    });
    await page.context().route('http://localhost:3001/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/')) await route.continue();
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    await primeAuth(page, admin.token, admin.userId, admin.email, 'admin', 1);
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(/Admin/i, { timeout: 10000 });
    await new AxeBuilder({ page }).include('button').analyze().then((r) => {
      const btnViolations = r.violations.filter((v: any) => v.id !== 'color-contrast');
      expect(btnViolations, 'logout button axe').toEqual([]);
    });
    const adminBtn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    let releaseAxe: () => void = () => {};
    const holdAxe = new Promise<void>((r) => { releaseAxe = r; });
    await page.context().unroute('**/auth/logout');
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await holdAxe;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    const holdLogin = await holdLoginRoute(page);
    await adminBtn.click({ noWaitAfter: true });
    await expect(adminBtn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await new AxeBuilder({ page }).include('button[aria-busy="true"]').analyze().then((r) => {
      const v = r.violations.filter((x: any) => x.id !== 'color-contrast');
      expect(v).toEqual([]);
    });
    releaseAxe();
    holdLogin();
    await page.context().unroute('**/auth/logout');
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
      else await route.continue();
    });
    await page.waitForURL('**/login', { timeout: 8000 });
    await primeAuth(page, student.token, student.userId, student.email, 'student', 1);
    await page.goto(`${WEB}/student`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(/Student/i, { timeout: 10000 });
    await new AxeBuilder({ page }).include('nav').analyze().then((r) => {
      const v = r.violations.filter((x: any) => x.id !== 'color-contrast' && x.id !== 'landmark-one-main');
      expect(v).toEqual([]);
    });
    await page.goto(`${WEB}/student/profile`, { waitUntil: 'networkidle' });
    const profileBtn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(profileBtn).toBeVisible({ timeout: 8000 });
    let release2: () => void = () => {};
    const hold2 = new Promise<void>((r) => { release2 = r; });
    await page.context().unroute('**/auth/logout');
    await page.context().route('**/auth/logout', async (route) => {
      if (route.request().method() === 'POST') await hold2;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    const holdLogin2 = await holdLoginRoute(page);
    await profileBtn.click({ noWaitAfter: true });
    await expect(profileBtn).toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await new AxeBuilder({ page }).include('button[aria-busy="true"]').analyze().then((r) => {
      const v = r.violations.filter((x: any) => x.id !== 'color-contrast');
      expect(v).toEqual([]);
    });
    release2();
    holdLogin2();
    await page.context().unroute('**/auth/logout');
    await page.waitForURL('**/login', { timeout: 8000 });
  });
});



