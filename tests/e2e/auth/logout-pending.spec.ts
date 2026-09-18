import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { getDb } from '../utils/db-helpers';

const WEB = process.env.WEB_URL || 'http://localhost:3000';

async function createFreshUser(role: 'admin' | 'student') {
  const db = getDb();
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const email = `e2e-logout-${role}-${uniq}@example.com`;
  const password = `Test${uniq}!A1b`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = data.user.id;
  const { error: pErr } = await db.from('profiles').upsert({ id: userId, email, role, name: `${role} ${uniq}`, is_active: true } as any, { onConflict: 'id' });
  if (pErr) console.warn('profile upsert', pErr.message);
  const cleanup = async () => {
    try { await db.from('profiles').delete().eq('id', userId); } catch {}
    try { await db.auth.admin.deleteUser(userId); } catch {}
  };
  return { email, password, userId, cleanup };
}

async function uiLogin(page: any, email: string, password: string, expectedUrl: string) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /Sign in|Signing in/ }).click();
  // Handle SESSION_REPLACED if it appears (should not for fresh user, but handle)
  const again = page.getByRole('button', { name: /Log In Again/ });
  if (await again.isVisible({ timeout: 1500 }).catch(() => false)) {
    await again.click();
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /Sign in|Signing in/ }).click();
  }
  await page.waitForURL(expectedUrl, { timeout: 15000 });
}

function collectErrors(page: any) {
  const errs: string[] = [];
  page.on('pageerror', (e: any) => errs.push(String(e).slice(0,400)));
  page.on('console', (m: any) => {
    if (m.type() === 'error') {
      const t = m.text().slice(0,500);
      if (t.includes('Download the React DevTools')) return;
      if (t.includes('Failed to load resource')) return;
      errs.push(t);
    }
  });
  return errs;
}

test.describe('Phase C1 — Logout Pending & Race Hardening', () => {
  test('T1 — Admin normal logout shows pending and navigates to /login', async ({ page }) => {
    const admin = await createFreshUser('admin');
    const errs = collectErrors(page);
    let posts = 0;
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') posts++;
      await r.continue();
    });
    await uiLogin(page, admin.email, admin.password, '**/admin');
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
    expect(posts).toBeLessThanOrEqual(1);
    expect(errs.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    await admin.cleanup();
  });

  test('T2 — Student sidebar logout shows pending and navigates', async ({ page }) => {
    const student = await createFreshUser('student');
    const errs = collectErrors(page);
    let posts = 0;
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') posts++;
      await r.continue();
    });
    await uiLogin(page, student.email, student.password, '**/student');
    await expect(page.locator('body')).toContainText(/Student|Dashboard/i, { timeout: 10000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    const btn = page.getByRole('button', { name: /Sign out|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled && (b.textContent || '').includes('Signing out');
    }, { timeout: 3000 });
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(posts).toBeLessThanOrEqual(1);
    expect(errs.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    await student.cleanup();
  });

  test('T3 — Student profile logout shows pending and navigates', async ({ page }) => {
    const student = await createFreshUser('student');
    const errs = collectErrors(page);
    let posts = 0;
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') posts++;
      await r.continue();
    });
    await uiLogin(page, student.email, student.password, '**/student');
    await page.goto(`${WEB}/student/profile`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(/Logout|Batches|Change Password/i, { timeout: 10000 });
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled;
    }, { timeout: 3000 });
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(posts).toBeLessThanOrEqual(1);
    expect(errs.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    await student.cleanup();
  });

  test('T4 — Double/triple click yields one logical logout and one POST', async ({ page }) => {
    const admin = await createFreshUser('admin');
    let posts = 0;
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') {
        posts++;
        await new Promise(res => setTimeout(res, 1200));
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
      await r.continue();
    });
    await uiLogin(page, admin.email, admin.password, '**/admin');
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const p1 = btn.click({ noWaitAfter: true }).catch(()=>{});
    const p2 = btn.click({ force: true } as any).catch(()=>{});
    const p3 = btn.click({ force: true } as any).catch(()=>{});
    await Promise.allSettled([p1,p2,p3]);
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled;
    }, { timeout: 3000 });
    await page.waitForURL('**/login', { timeout: 8000 });
    await page.waitForTimeout(1500);
    expect(posts).toBeLessThanOrEqual(1);
    await admin.cleanup();
  });

  test('T5 — Slow logout network still shows pending immediately and navigates without waiting', async ({ page }) => {
    const admin = await createFreshUser('admin');
    let release: () => void = () => {};
    const held = new Promise<void>(res => { release = res; });
    let seen = false;
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') {
        seen = true;
        await held;
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
      await r.continue();
    });
    await uiLogin(page, admin.email, admin.password, '**/admin');
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const start = Date.now();
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled;
    }, { timeout: 2000 });
    await page.waitForURL('**/login', { timeout: 4000 });
    const elapsed = Date.now() - start;
    expect(seen).toBe(true);
    expect(elapsed).toBeLessThan(3000);
    release();
    await page.waitForTimeout(600);
    expect(page.url()).toContain('/login');
    await admin.cleanup();
  });

  test('T6 — Logout plus in-flight 401 does not cause second hard redirect', async ({ page }) => {
    const admin = await createFreshUser('admin');
    let posts = 0;
    const navs: string[] = [];
    page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(f.url()); });
    let releaseLogout: () => void = () => {};
    const holdLogout = new Promise<void>(r => { releaseLogout = r; });
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') {
        posts++;
        await holdLogout;
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
      await r.continue();
    });
    await page.route('**/courses/**', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) });
        return;
      }
      await r.continue();
    });
    await uiLogin(page, admin.email, admin.password, '**/admin');
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]') !== null, { timeout: 2000 });
    await page.evaluate(async (api) => {
      fetch(`${api}/courses/my`, { headers: { Authorization: 'Bearer test' } }).catch(()=>{});
    }, process.env.API_URL || 'http://localhost:3001').catch(()=>{});
    await page.waitForURL('**/login', { timeout: 6000 });
    expect(navs.filter(u => u.includes('/login')).length).toBeLessThanOrEqual(2);
    expect(posts).toBeLessThanOrEqual(1);
    releaseLogout();
    await page.waitForTimeout(400);
    expect(page.url()).toContain('/login');
    await admin.cleanup();
  });

  test('T7 — Expired/takeover overlay logout does not POST unnecessarily', async ({ page }) => {
    const admin = await createFreshUser('admin');
    let posts = 0;
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method() === 'POST') posts++;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    // Expire the session by clearing Redis via logout? Instead, use an invalid token via direct LS
    const expiredCache = {
      version: 1,
      user: { id: admin.userId, name: 'Admin', email: admin.email, role: 'admin' },
      token: 'expired.invalid.token',
      mustChangePassword: false,
      sessionCount: 5,
      expiresAt: Date.now() - 10000,
      updatedAt: Date.now() - 20000,
    };
    await page.addInitScript((c:any)=>{ try{localStorage.setItem('session_persistence', JSON.stringify(c))}catch{} }, expiredCache);
    await page.context().addCookies([{ name: 'access_token', value: 'expired.invalid.token', url: WEB }, { name: 'must_change_password', value: 'false', url: WEB }]);
    await page.route('**/auth/validate-session', async (r) => {
      await r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) });
    });
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Go to Login|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled;
    }, { timeout: 2000 });
    await page.waitForURL('**/login', { timeout: 8000 });
    expect(posts).toBe(0);
    await admin.cleanup();
  });

  test('T8 — UnauthorizedPage without auth shows Go to Login with pending', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => { try{localStorage.removeItem('session_persistence')}catch{} });
    await page.route('**/auth/validate-session', async (r) => {
      await r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) });
    });
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /Go to Login|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Session Expired|Unauthorized|Access Denied/i, { timeout: 4000 });
    let posts = 0;
    await page.unroute('**/auth/logout');
    await page.route('**/auth/logout', async (r) => {
      if (r.request().method()==='POST') posts++;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled;
    }, { timeout: 2000 });
    await page.waitForURL('**/login', { timeout: 6000 });
    expect(posts).toBe(0);
  });

  test('T9 — Older logout broadcast must not destroy newer session (multi-context race)', async ({ page }) => {
    const admin2 = await createFreshUser('admin');
    // Use real login to get a valid session, then manipulate sessionCount
    await uiLogin(page, admin2.email, admin2.password, '**/admin');
    await expect(page.locator('body')).toContainText(/Admin/i, { timeout: 10000 });
    // Bump sessionCount to 5 to simulate newer session
    await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('session_persistence');
        if (raw) {
          const p = JSON.parse(raw);
          p.sessionCount = 5;
          p.expiresAt = Date.now() + 3600000;
          localStorage.setItem('session_persistence', JSON.stringify(p));
        }
      } catch {}
    });
    const newerCount = 5;
    const olderCount = 3;
    const kept = await page.evaluate(async (older) => {
      const raw = localStorage.getItem('session_persistence');
      if (!raw) return false;
      const p = JSON.parse(raw);
      return typeof p.sessionCount === 'number' && p.sessionCount > older;
    }, olderCount);
    expect(kept).toBe(true);
    await page.evaluate(async (older) => {
      const bc = new BroadcastChannel('mct-auth-channel');
      bc.postMessage({ type: 'auth:logout', sessionCount: older });
      bc.close();
      await new Promise(r => setTimeout(r, 400));
    }, olderCount);
    const after = await page.evaluate(() => {
      const raw = localStorage.getItem('session_persistence');
      if (!raw) return null;
      try { return JSON.parse(raw).sessionCount; } catch { return null; }
    });
    expect(after).toBe(newerCount);
    expect(page.url()).toContain('/admin');
    await admin2.cleanup();
  });

  test('T10 — Mobile 375x812 logout CTA meets 44px and no overflow', async ({ page }) => {
    const admin = await createFreshUser('admin');
    await page.setViewportSize({ width: 375, height: 812 });
    await uiLogin(page, admin.email, admin.password, '**/admin');
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]') !== null, { timeout: 2000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    await page.waitForURL('**/login', { timeout: 8000 });
    await admin.cleanup();
  });

  test('T11 — Mobile 390x844 logout CTA meets 44px', async ({ page }) => {
    const admin = await createFreshUser('admin');
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, admin.email, admin.password, '**/admin');
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]') !== null, { timeout: 2000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    await page.waitForURL('**/login', { timeout: 8000 });
    await admin.cleanup();
  });

  test('T12 — Reduced motion still shows accessible pending', async ({ page }) => {
    const admin = await createFreshUser('admin');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await uiLogin(page, admin.email, admin.password, '**/admin');
    const btn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click({ noWaitAfter: true });
    await page.waitForFunction(() => {
      const b = document.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
      return b !== null && b.disabled && (b.textContent || '').includes('Signing out');
    }, { timeout: 2000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    await page.waitForURL('**/login', { timeout: 8000 });
    await admin.cleanup();
  });

  test('T13 — Axe accessibility on logout surfaces', async ({ page }) => {
    const admin = await createFreshUser('admin');
    const student = await createFreshUser('student');
    await uiLogin(page, admin.email, admin.password, '**/admin');
    await expect(page.locator('body')).toContainText(/Admin/i, { timeout: 10000 });
    await new AxeBuilder({ page }).include('button').analyze().then(r => {
      expect(r.violations.filter((v:any)=>v.id!=='color-contrast'), 'admin button axe').toEqual([]);
    });
    const adminBtn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await adminBtn.click({ noWaitAfter: true });
    await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]') !== null, { timeout: 2000 });
    await new AxeBuilder({ page }).include('button[aria-busy="true"]').analyze().then(r => {
      expect(r.violations.filter((v:any)=>v.id!=='color-contrast'), 'pending axe').toEqual([]);
    });
    await page.waitForURL('**/login', { timeout: 8000 });

    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.locator('#email').fill(student.email);
    await page.locator('#password').fill(student.password);
    await page.getByRole('button', { name: /Sign in/ }).click();
    await page.waitForURL('**/student', { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Student/i, { timeout: 10000 });
    await new AxeBuilder({ page }).include('nav').analyze().then(r => {
      expect(r.violations.filter((v:any)=>v.id!=='color-contrast' && v.id!=='landmark-one-main'), 'nav axe').toEqual([]);
    });
    await page.goto(`${WEB}/student/profile`, { waitUntil: 'networkidle' });
    const profileBtn = page.getByRole('button', { name: /Logout|Signing out/ }).first();
    await expect(profileBtn).toBeVisible({ timeout: 8000 });
    await profileBtn.click({ noWaitAfter: true });
    await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]') !== null, { timeout: 2000 });
    await new AxeBuilder({ page }).include('button[aria-busy="true"]').analyze().then(r => {
      expect(r.violations.filter((v:any)=>v.id!=='color-contrast'), 'profile pending axe').toEqual([]);
    });
    await page.waitForURL('**/login', { timeout: 8000 });
    await admin.cleanup();
    await student.cleanup();
  });
});
