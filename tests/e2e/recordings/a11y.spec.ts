import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { getDb } from '../utils/db-helpers';

const WEB = process.env.WEB_URL || 'http://localhost:3000';

function filterAxeViolations(violations: { id: string }[]) {
  return violations.filter((v) => v.id !== 'color-contrast' && v.id !== 'landmark-one-main');
}

async function createFreshUser(role: 'admin' | 'student') {
  const db = getDb();
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `e2e-a11y-${role}-${uniq}@example.com`;
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
  const again = page.getByRole('button', { name: /Log In Again/ });
  if (await again.isVisible({ timeout: 1500 }).catch(() => false)) {
    await again.click();
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /Sign in|Signing in/ }).click();
  }
  await page.waitForURL(expectedUrl, { timeout: 15000 });
}

test.describe('Accessibility — Axe automated checks (recordings fixture)', () => {
  test('student dashboard has no serious axe violations', async ({ page }) => {
    const student = await createFreshUser('student');
    try {
      await uiLogin(page, student.email, student.password, '**/student');
      const heading = page.locator('text=Learning Momentum').or(page.locator('text=Your learning journey starts here')).first();
      await expect(heading).toBeVisible({ timeout: 15000 });
      const results = await new AxeBuilder({ page }).analyze();
      const filtered = filterAxeViolations(results.violations as unknown as { id: string }[]);
      expect(filtered, `axe violations on /student: ${JSON.stringify(filtered, null, 2)}`).toEqual([]);
    } finally {
      await student.cleanup();
    }
  });

  test('student recordings library has no serious axe violations', async ({ page }) => {
    const student = await createFreshUser('student');
    try {
      await uiLogin(page, student.email, student.password, '**/student');
      await page.goto(`${WEB}/student/videos`, { waitUntil: 'networkidle' });
      const content = page.locator('text=Recordings').or(page.locator('text=Videos')).or(page.locator('text=No recordings')).or(page.locator('input[placeholder*="Search"]')).or(page.locator('h1')).first();
      await expect(content).toBeVisible({ timeout: 15000 });
      const results = await new AxeBuilder({ page }).analyze();
      const filtered = filterAxeViolations(results.violations as unknown as { id: string }[]);
      expect(filtered, `axe violations on /student/videos: ${JSON.stringify(filtered, null, 2)}`).toEqual([]);
    } finally {
      await student.cleanup();
    }
  });

  test('admin recordings has no serious axe violations', async ({ page }) => {
    const admin = await createFreshUser('admin');
    try {
      await uiLogin(page, admin.email, admin.password, '**/admin');
      await page.goto(`${WEB}/admin/recordings`, { waitUntil: 'networkidle' });
      const heading = page.locator('text=Admin Recordings').or(page.locator('text=Recordings')).or(page.locator('h1')).first();
      await expect(heading).toBeVisible({ timeout: 15000 });
      const results = await new AxeBuilder({ page }).analyze();
      const filtered = filterAxeViolations(results.violations as unknown as { id: string }[]);
      expect(filtered, `axe violations on /admin/recordings: ${JSON.stringify(filtered, null, 2)}`).toEqual([]);
    } finally {
      await admin.cleanup();
    }
  });
});
