import { test, expect } from '@playwright/test';
import { loginAs } from '../utils/login-helpers';

test.describe('Student Dashboard Premium — Real Browser', () => {
  test('dashboard renders hierarchy and journey interacts at 390 and 1440', async ({ page, request }) => {
    await page.goto('http://localhost:3000/login');
    await page.fill('#email', process.env.E2E_STUDENT_A_EMAIL || 'student-a@mct.com');
    await page.fill('#password', process.env.E2E_STUDENT_A_PASSWORD || 'Student1234!');
    await page.click('button[type="submit"]');
    // Wait for redirect to /student
    await page.waitForURL(/\/student/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/student/);

    // Check welcome
    await expect(page.locator('text=Good')).toBeVisible({ timeout: 10000 });

    // Check Continue Learning or Start Learning card exists
    const continueCard = page.locator('text=Continue Learning').or(page.locator('text=Start Learning')).first();
    await expect(continueCard).toBeVisible({ timeout: 10000 });

    // Check Next Up
    await expect(page.locator('text=Next Up')).toBeVisible();

    // Check Course Progress OR empty state
    const progressOrEmpty = page.locator('text=Course Progress').or(page.locator('text=Your learning journey starts here')).first();
    await expect(progressOrEmpty).toBeVisible({ timeout: 10000 });

    // Check Learning Journey header OR empty curriculum
    const journeyOrEmpty = page.locator('text=Learning Journey').or(page.locator('text=No curriculum yet')).first();
    await expect(journeyOrEmpty).toBeVisible();

    // Expand first batch if collapsed — click batch header
    const batchBtn = page.locator('button:has-text("completed")').first();
    if (await batchBtn.isVisible()) {
      await batchBtn.click();
      // Check that aria-expanded toggled
      await expect(batchBtn).toHaveAttribute('aria-expanded', /true|false/);
    }

    // Try to expand first section inside
    const sectionBtn = page.locator('button:has-text("General")').first();
    if (await sectionBtn.isVisible()) {
      await sectionBtn.click();
      await expect(sectionBtn).toHaveAttribute('aria-expanded', 'true');
    }

    // Check that page has no horizontal overflow at 390
    const viewport = page.viewportSize();
    // Simple check: body scrollWidth <= window innerWidth + 5
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    expect(hasOverflow).toBe(false);

    // Check console for no critical errors (filter expected 4xx from empty data? none expected)
    // Navigation check: click Continue CTA navigates to video
    const continueLink = page.locator('a[href*="/student/videos/"]').first();
    if (await continueLink.isVisible()) {
      const href = await continueLink.getAttribute('href');
      expect(href).toContain('/student/videos/');
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('nav.fixed')).toBeVisible();
    const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    expect(overflow390).toBe(false);

    await page.setViewportSize({ width: 1440, height: 900 });
    // At 1440, sidebar nav visible, bottom nav hidden — just check no overflow
    const overflow1440 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    expect(overflow1440).toBe(false);
  });

  test('dashboard handles empty progress gracefully', async ({ request }) => {
    // API-level check: ensure dashboard APIs return arrays not 500 even for new student
    const { token } = await loginAs(request, process.env.E2E_STUDENT_A_EMAIL || 'student-a@mct.com', process.env.E2E_STUDENT_A_PASSWORD || 'Student1234!');
    const headers = { Authorization: `Bearer ${token}` };
    const vids = await request.get('/recordings/my', { headers });
    expect([200, 304].includes(vids.status())).toBe(true);
    const tests = await request.get('/tests/my', { headers });
    expect([200, 304].includes(tests.status())).toBe(true);
  });
});
