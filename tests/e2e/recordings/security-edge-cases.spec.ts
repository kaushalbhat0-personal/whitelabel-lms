import { test, expect } from '../fixtures/recordings-fixture';
import { expectForbidden, expectOk } from '../utils/assertions';
import {
  createRecordingInDb,
  assignRecordingToBatch,
  deleteRecordings,
} from '../utils/db-helpers';

test.describe('Security Edge Cases — expired token, multi-tab, refresh, logout', () => {
  let recordingId: string;

  test.beforeEach(async ({ db, seed }) => {
    recordingId = await createRecordingInDb(db, {
      title: 'E2E-Security-Test',
      status: 'ready',
    });
    await assignRecordingToBatch(db, recordingId, seed.batchAId);
  });

  test.afterEach(async ({ db }) => {
    if (recordingId) {
      await db.from('video_progress').delete().eq('video_id', recordingId);
      await db.from('playback_events').delete().eq('recording_id', recordingId);
      await db.from('playback_violations').delete().eq('recording_id', recordingId);
      await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
      await db.from('recording_batches').delete().eq('recording_id', recordingId);
      await db.from('recordings').delete().eq('id', recordingId);
    }
  });

  test('expired JWT — authorize returns 401', async ({ request }) => {
    const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InN0dWRlbnQiLCJleHAiOjE1MTYyMzkwMjJ9.4Adcj3UFYzPUVW4RryoGKTq3fF2Y6N2L1mYTXxXxY';
    const res = await request.post(`/recordings/${recordingId}/authorize`, {
      data: {},
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status()).toBe(401);
  });

  test('invalid JWT — authorize returns 401', async ({ request }) => {
    const fakeToken = 'this-is-not-a-valid-jwt';
    const res = await request.post(`/recordings/${recordingId}/authorize`, {
      data: {},
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status()).toBe(401);
  });

  test('Student A in same batch as Student B — both can access', async ({
    request, studentAToken, studentBToken, studentBUserId, seed, db,
  }) => {
    await db.from('batch_students').insert({
      user_id: studentBUserId,
      batch_id: seed.batchAId,
    });

    const authA = await request.post(`/recordings/${recordingId}/authorize`, {
      data: {},
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    await expectOk(authA);

    const authB = await request.post(`/recordings/${recordingId}/authorize`, {
      data: {},
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    await expectOk(authB);
  });

  test('recordings not yet assigned to any batch — no student sees it', async ({
    request, adminToken, seed, db, studentAToken,
  }) => {
    const unassignedId = await createRecordingInDb(db, {
      title: 'E2E-Unassigned',
      status: 'ready',
    });

    const authRes = await request.post(`/recordings/${unassignedId}/authorize`, {
      data: {},
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    await expectForbidden(authRes);

    await db.from('recordings').delete().eq('id', unassignedId);
  });

  test('refresh during playback — page reloads without error', async ({
    page, studentAToken, db, seed,
  }) => {
    const uiRecordingId = await createRecordingInDb(db, {
      title: 'E2E-Refresh-Test',
      status: 'ready',
    });
    await assignRecordingToBatch(db, uiRecordingId, seed.batchAId);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);

    await page.goto(`http://localhost:3000/student/videos/${uiRecordingId}`);
    await page.waitForLoadState('domcontentloaded');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const url = page.url();
    expect(url).toContain(uiRecordingId);

    await db.from('batch_recording_curriculum').delete().eq('content_id', uiRecordingId).eq('content_type', 'recording');
    await db.from('recording_batches').delete().eq('recording_id', uiRecordingId);
    await db.from('recordings').delete().eq('id', uiRecordingId);
  });

  test('logout while on video player — redirected to login', async ({
    page, studentAToken, db, seed,
  }) => {
    const uiRecordingId = await createRecordingInDb(db, {
      title: 'E2E-Logout-Test',
      status: 'ready',
    });
    await assignRecordingToBatch(db, uiRecordingId, seed.batchAId);

    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);

    await page.goto(`http://localhost:3000/student/videos/${uiRecordingId}`);
    await page.waitForLoadState('domcontentloaded');

    await page.context().clearCookies();
    await page.goto(`http://localhost:3000/student/videos/${uiRecordingId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/login/);

    await db.from('batch_recording_curriculum').delete().eq('content_id', uiRecordingId).eq('content_type', 'recording');
    await db.from('recording_batches').delete().eq('recording_id', uiRecordingId);
    await db.from('recordings').delete().eq('id', uiRecordingId);
  });

  test('open same recording in two tabs — both load', async ({
    context, studentAToken, db, seed,
  }) => {
    const uiRecordingId = await createRecordingInDb(db, {
      title: 'E2E-MultiTab-Test',
      status: 'ready',
    });
    await assignRecordingToBatch(db, uiRecordingId, seed.batchAId);

    await context.addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);

    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto(`http://localhost:3000/student/videos/${uiRecordingId}`);
    await page2.goto(`http://localhost:3000/student/videos/${uiRecordingId}`);

    await page1.waitForLoadState('domcontentloaded');
    await page2.waitForLoadState('domcontentloaded');

    expect(page1.url()).toContain(uiRecordingId);
    expect(page2.url()).toContain(uiRecordingId);

    await page1.close();
    await page2.close();

    await db.from('batch_recording_curriculum').delete().eq('content_id', uiRecordingId).eq('content_type', 'recording');
    await db.from('recording_batches').delete().eq('recording_id', uiRecordingId);
    await db.from('recordings').delete().eq('id', uiRecordingId);
  });
});
