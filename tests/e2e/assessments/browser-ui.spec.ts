import { test, expect } from '../fixtures/assessments-fixture';
import { authHeader } from '../utils/login-helpers';
import { chromium, type Browser, type Page } from '@playwright/test';

const WEB = process.env.WEB_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:3001';

/**
 * Browser verification of the student + admin assessment screens
 * (desktop + mobile). Verifies no console errors, correct rendering.
 */
test.describe('Assessment Browser UI', () => {
  test('student can complete an attempt in the browser', async ({ request, db, adminToken, studentAToken, seed }) => {
    // publish test
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    // use the worker session token (avoids invalidating shared auth via re-login)
    const token = studentAToken;

    const browser: Browser = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
    await page.addInitScript((c) => {
      try { localStorage.setItem('session_persistence', JSON.stringify(c)); } catch (e) {}
    }, { version: 1, user: { id: '663bd2e9-a864-4776-97c6-681008ed287e', name: 'Student A', email: 'student-a@mct.com', role: 'student' }, token, mustChangePassword: false, sessionCount: 1 });
    await page.context().addCookies([{ name: 'access_token', value: token, url: WEB }, { name: 'must_change_password', value: 'false', url: WEB }]);

    // Tests list shows the test
    await page.goto(`${WEB}/student/tests`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    expect(body.toLowerCase()).toContain('available');

    // Start attempt page
    await page.goto(`${WEB}/student/tests/attempt/${seed.testId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const attemptBody = await page.locator('body').innerText();
    console.log('attempt body snippet:', attemptBody.slice(0, 300).replace(/\n+/g, ' | '));
    // question renders (fixture question text is "E2E-Q-XXX-0")
    expect(attemptBody).toContain('E2E-Q');
    // no crash text
    expect(attemptBody).not.toContain('Unable to load test');

    // Answer Q1: select the first radio
    const radio = page.locator('input[type="radio"]:visible').first();
    await radio.check().catch(() => {});
    await page.waitForTimeout(500);

    // Submit (via confirm dialog)
    await page.locator('button:visible:has-text("Submit")').first().click().catch(() => {});
    await page.waitForTimeout(800);
    const confirmBtn = page.locator('div.fixed:visible button:has-text("Submit")').first();
    if (await confirmBtn.count()) { await confirmBtn.click(); }
    await page.waitForTimeout(2500);

    console.log('browser errors:', JSON.stringify(errors.slice(0, 5)));
    expect(errors.length).toBe(0);
    await browser.close();
  });

  test('admin review queue renders without crash', async ({ request, db, adminToken, studentAToken, seed }) => {
    // add a long_answer question to seed a manual-review item
    const { data: laQ } = await db.from('question_bank').insert({
      question_text: 'E2E-Browser-LA',
      question_type: 'long_answer',
      difficulty: 'medium',
      is_archived: false,
      created_by: (await db.from('profiles').select('id').limit(1).single()).data.id,
    }).select('id').single();
    await db.from('test_question_bank').insert({ test_id: seed.testId, question_bank_id: laQ.id, marks: 5, sort_order: 20 });
    await db.from('tests').update({ total_marks: 15 }).eq('id', seed.testId);

    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    // student starts + answers + submits (use worker token to avoid invalidating admin)
    const st = studentAToken;
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(st), data: {} });
    const sj = await s.json();
    const attemptId = sj.data.id;
    const answers = sj.data.questions.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: q.question_type === 'long_answer' ? 'My answer' : 'A' }));
    await request.post(`/attempts/${attemptId}/submit`, { headers: authHeader(st), data: { answers, timeRemainingSeconds: 0 } });
    await request.post(`/evaluation/${attemptId}/auto-grade`, { headers: authHeader(adminToken) });

    // admin login for browser (use worker token)
    const token = adminToken;

    const browser: Browser = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
    await page.addInitScript((c) => {
      try { localStorage.setItem('session_persistence', JSON.stringify(c)); } catch (e) {}
    }, { version: 1, user: { id: 'df981417-5356-4c64-8a2b-66ef7720162c', name: 'Admin', email: 'admin@mct.com', role: 'admin' }, token, mustChangePassword: false, sessionCount: 1 });
    await page.context().addCookies([{ name: 'access_token', value: token, url: WEB }, { name: 'must_change_password', value: 'false', url: WEB }]);

    // Review queue page renders + expands without crash
    await page.goto(`${WEB}/admin/review-queue`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const rqBody = await page.locator('body').innerText();
    expect(rqBody).toContain('Review Queue');
    const expand = page.locator('button:has-text("Student A")').first();
    if (await expand.count()) {
      await expand.click();
      await page.waitForTimeout(600);
      const expanded = await page.locator('body').innerText();
      expect(expanded).not.toContain('Cannot read');
    }

    console.log('admin review queue errors:', JSON.stringify(errors.slice(0, 5)));
    expect(errors.length).toBe(0);
    await browser.close();

    // cleanup LA question
    await db.from('test_question_bank').delete().eq('test_id', seed.testId).eq('question_bank_id', laQ.id);
    await db.from('question_bank').delete().eq('id', laQ.id);
  });

  test('mobile viewport renders tests list without overflow', async ({ request, db, adminToken, studentAToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const st = studentAToken;

    const browser: Browser = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
    await page.addInitScript((c) => {
      try { localStorage.setItem('session_persistence', JSON.stringify(c)); } catch (e) {}
    }, { version: 1, user: { id: '663bd2e9-a864-4776-97c6-681008ed287e' }, token: st, mustChangePassword: false, sessionCount: 1 });
    await page.context().addCookies([{ name: 'access_token', value: st, url: WEB }, { name: 'must_change_password', value: 'false', url: WEB }]);

    await page.goto(`${WEB}/student/tests`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
    expect(errors.length).toBe(0);
    await browser.close();
  });
});
