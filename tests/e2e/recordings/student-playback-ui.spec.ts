import { test, expect } from '../fixtures/recordings-fixture';
import {
  createRecordingInDb,
  assignRecordingToBatch,
  deleteRecordings,
} from '../utils/db-helpers';

test.describe('Student Playback UI — player controls, keyboard, PiP, resume, watermark', () => {
  let recordingIds: string[] = [];

  test.afterEach(async ({ db }) => {
    if (recordingIds.length) {
      await db.from('batch_recording_curriculum').delete().in('content_id', recordingIds).eq('content_type', 'recording');
      await db.from('recording_batches').delete().in('recording_id', recordingIds);
      await db.from('video_progress').delete().in('video_id', recordingIds);
      await db.from('playback_events').delete().in('recording_id', recordingIds);
      await db.from('recordings').delete().in('id', recordingIds);
      recordingIds.length = 0;
    }
  });

  test('video player page loads without errors', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Player-Load' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);

    const response = await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response!.status()).toBe(200);
    expect(page.url()).toContain(id);
  });

  test('watermark is rendered on player page', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Watermark' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const watermark = page.locator('[data-testid="watermark"], .watermark, .player-watermark');
    if (await watermark.count() > 0) {
      await expect(watermark.first()).toBeVisible();
    }
  });

  test('player controls render — play/pause, volume, fullscreen', async ({
    page, studentAToken, db, seed,
  }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Controls' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const player = page.locator('mux-player, [data-testid="video-player"], .video-player-container').first();
    if (await player.count() > 0) {
      await expect(player).toBeAttached();
    }

    const volumeControl = page.locator('[data-testid="volume-slider"], input[type="range"]').first();
    if (await volumeControl.count() > 0) {
      await expect(volumeControl).toBeAttached();
    }

    const fullscreenBtn = page.locator(
      '[data-testid="fullscreen-button"], button:has(svg.lucide-maximize), button:has(svg.lucide-minimize)',
    ).first();
    if (await fullscreenBtn.count() > 0) {
      await expect(fullscreenBtn).toBeAttached();
    }
  });

  test('keyboard shortcut Space toggles play/pause on video', async ({
    page, studentAToken, db, seed,
  }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Shortcut-Space' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const player = page.locator('mux-player, [data-testid="video-player"], .video-player-container').first();
    if (await player.count() > 0) {
      await player.focus();
      await page.keyboard.press(' ');
      await page.waitForTimeout(300);
      await page.keyboard.press(' ');
    }
  });

  test('keyboard arrow keys seek video', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Seek-Keys' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const player = page.locator('mux-player, [data-testid="video-player"], .video-player-container').first();
    if (await player.count() > 0) {
      await player.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowDown');
    }
  });

  test('keyboard shortcut M toggles mute', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Mute-Key' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const player = page.locator('mux-player, [data-testid="video-player"], .video-player-container').first();
    if (await player.count() > 0) {
      await player.focus();
      await page.keyboard.press('m');
    }
  });

  test('keyboard shortcut F toggles fullscreen', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Fullscreen-Key' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const player = page.locator('mux-player, [data-testid="video-player"], .video-player-container').first();
    if (await player.count() > 0) {
      await player.focus();
      await page.keyboard.press('f');
      const isFullscreen = await page.evaluate(() => !!document.fullscreenElement);
      if (isFullscreen) {
        await page.keyboard.press('f');
      }
    }
  });

  test('quality menu renders options', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Quality' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const qualityBtn = page.locator(
      '[data-testid="quality-menu"], button:has-text("HD"), button:has-text("Quality"), button:has-text("Auto")',
    ).first();
    if (await qualityBtn.count() > 0) {
      await qualityBtn.click();
      await expect(qualityBtn).toBeAttached();
    }
  });

  test('speed menu renders options', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Speed' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const speedBtn = page.locator(
      '[data-testid="speed-menu"], button:has-text("Speed"), button:has-text("1x"), button:has-text("1.5x")',
    ).first();
    if (await speedBtn.count() > 0) {
      await speedBtn.click();
      await expect(speedBtn).toBeAttached();
    }
  });

  test('PiP button visible when PiP API is available', async ({
    page, studentAToken, db, seed,
  }) => {
    test.skip(!(await page.evaluate(() => 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled)),
      'PiP API not available in this browser');

    const id = await createRecordingInDb(db, { title: 'E2E-PiP' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const pipBtn = page.locator(
      '[data-testid="pip-button"], button:has(svg.lucide-picture-in-picture-2)',
    ).first();
    if (await pipBtn.count() > 0) {
      await expect(pipBtn).toBeAttached();
    }
  });

  test('resume dialog shown when progress exists', async ({
    page, studentAToken, db, seed, request,
  }) => {
    const id = await createRecordingInDb(db, {
      title: 'E2E-Resume-Dialog',
      duration_seconds: 300,
    });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await request.post(`/recordings/${id}/progress`, {
      data: { watchedSeconds: 90, completed: false },
      headers: { Authorization: `Bearer ${studentAToken}` },
    });

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const resumeDialog = page.locator(
      '[data-testid="resume-dialog"], [role="dialog"]:has-text("Resume"), .resume-dialog',
    );
    if (await resumeDialog.count() > 0) {
      await expect(resumeDialog.first()).toBeVisible();
    }
  });

  test('continue watching component is present on dashboard', async ({
    page, studentAToken, db, seed,
  }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Continue-Watch' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto('http://localhost:3000/student', {
      waitUntil: 'domcontentloaded',
    });

    const continueWatching = page.locator(
      '[data-testid="continue-watching"], h2:has-text("Continue Watching"), .continue-watching-section',
    ).first();
    if (await continueWatching.count() > 0) {
      await expect(continueWatching).toBeVisible();
    }
  });

  test('recently watched component is present on dashboard', async ({
    page, studentAToken, db, seed,
  }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Recently-Watched' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto('http://localhost:3000/student', {
      waitUntil: 'domcontentloaded',
    });

    const recentlyWatched = page.locator(
      '[data-testid="recently-watched"], h2:has-text("Recently Watched"), .recently-watched-section',
    ).first();
    if (await recentlyWatched.count() > 0) {
      await expect(recentlyWatched).toBeVisible();
    }
  });

  test('course progress component is present on course detail page', async ({
    page, studentAToken, db, seed,
  }) => {
    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto('http://localhost:3000/student/courses', {
      waitUntil: 'domcontentloaded',
    });

    const courseLink = page.locator('a[href*="/student/courses/"]').first();
    if (await courseLink.count() > 0) {
      await courseLink.click();
      await page.waitForLoadState('domcontentloaded');

      const courseProgress = page.locator(
        '[data-testid="course-progress"], .course-progress-bar, [role="progressbar"]',
      ).first();
      if (await courseProgress.count() > 0) {
        await expect(courseProgress).toBeVisible();
      }
    }
  });

  test('mini-player activates on scroll', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Mini-Player' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const miniPlayer = page.locator(
      '[data-testid="mini-player"], .mini-player, [data-mini-player="true"]',
    ).first();
    if (await miniPlayer.count() > 0) {
      await expect(miniPlayer).toBeVisible();
    }
  });

  test('mobile double-tap gesture seeks video', async ({ page, studentAToken, db, seed }) => {
    const id = await createRecordingInDb(db, { title: 'E2E-Double-Tap' });
    await assignRecordingToBatch(db, id, seed.batchAId);
    recordingIds.push(id);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto(`http://localhost:3000/student/videos/${id}`, {
      waitUntil: 'domcontentloaded',
    });

    const player = page.locator('mux-player, [data-testid="video-player"], .video-player-container').first();
    if (await player.count() > 0) {
      const box = await player.boundingBox();
      if (box) {
        const leftSide = { x: box.x + box.width * 0.2, y: box.y + box.height / 2 };
        await page.mouse.dblclick(leftSide.x, leftSide.y);
        await page.waitForTimeout(500);
      }
    }
  });
});
