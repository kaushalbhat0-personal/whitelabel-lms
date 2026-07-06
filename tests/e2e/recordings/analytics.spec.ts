import { test, expect } from '../fixtures/recordings-fixture';
import { expectOk, expectCreated } from '../utils/assertions';
import { createRecordingDto } from '../utils/factories';
import {
  createPlaybackEvent,
  createPlaybackViolation,
  getPlaybackEvents,
  getPlaybackViolations,
  deleteRecordings,
} from '../utils/db-helpers';

test.describe('Admin Playback Analytics — events, violations, page', () => {
  let recordingId: string;

  test.beforeEach(async ({ request, adminToken, seed }) => {
    const dto = createRecordingDto({
      title: 'E2E-Analytics-Test',
      batchIds: [seed.batchAId],
    });
    const res = await request.post('/admin/recordings', {
      data: dto,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const wrapper = await expectCreated(res);
    recordingId = ((wrapper.data as Record<string, unknown>).recording as Record<string, unknown>).id as string;
  });

  test.afterEach(async ({ db }) => {
    if (recordingId) {
      await db.from('playback_events').delete().eq('recording_id', recordingId);
      await db.from('playback_violations').delete().eq('recording_id', recordingId);
      await db.from('video_progress').delete().eq('video_id', recordingId);
      await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
      await db.from('recording_batches').delete().eq('recording_id', recordingId);
      await db.from('recordings').delete().eq('id', recordingId);
    }
  });

  test('POST /playback/event — logs event successfully', async ({
    request, studentAToken, studentAUserId, db,
  }) => {
    const res = await request.post('/playback/event', {
      data: {
        recordingId,
        eventType: 'play',
        positionSeconds: 10,
      },
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    await expectOk(res);

    const events = await getPlaybackEvents(db, recordingId);
    const matching = events.filter((e: any) => e.user_id === studentAUserId);
    expect(matching.length).toBeGreaterThanOrEqual(1);
    expect(matching[0].event_type).toBe('play');
  });

  test('GET /playback/events — returns list of events', async ({
    request, adminToken, db, studentAUserId,
  }) => {
    await createPlaybackEvent(db, {
      recordingId,
      userId: studentAUserId,
      eventType: 'seek',
      metadata: { from: 0, to: 30 },
    });
    await createPlaybackEvent(db, {
      recordingId,
      userId: studentAUserId,
      eventType: 'pause',
      metadata: { currentTime: 45 },
    });

    const res = await request.get('/playback/events', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const wrapper = await expectOk(res);
    const data = wrapper.data as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test('GET /playback/violations — returns list of violations', async ({
    request, adminToken, db, studentAUserId,
  }) => {
    await createPlaybackViolation(db, {
      recordingId,
      userId: studentAUserId,
      violationType: 'unauthorized_access',
      details: 'Attempted to access play URL without authorize',
    });

    const res = await request.get('/playback/violations', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const wrapper = await expectOk(res);
    const data = wrapper.data as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].violation_type).toBe('unauthorized_access');
  });

  test('GET /playback/violations — rejects student token', async ({ request, studentAToken }) => {
    const res = await request.get('/playback/violations', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('admin analytics page loads — stat cards visible', async ({
    page, adminToken,
  }) => {
    await page.context().addCookies([
      { name: 'access_token', value: adminToken, url: 'http://localhost:3000' },
    ]);
    await page.goto('http://localhost:3000/admin/playback-analytics');

    await expect(page).toHaveURL(/\/admin\/playback-analytics/);
    await page.waitForLoadState('networkidle');
  });

  test('admin analytics page — rejects student', async ({ page, studentAToken }) => {
    await page.context().addCookies([
      { name: 'access_token', value: studentAToken, url: 'http://localhost:3000' },
    ]);
    await page.goto('http://localhost:3000/admin/playback-analytics');

    await expect(page).toHaveURL(/\/student/);
  });
});
