import { test, expect } from '../fixtures/recordings-fixture';
import { expectCreated, expectOk } from '../utils/assertions';
import { createRecordingDto, updateProgressDto } from '../utils/factories';
import { findProgress } from '../utils/db-helpers';

test.describe('Playback Progress — Test 6', () => {
  let recordingId: string;

  test.beforeEach(async ({ request, adminToken, seed }) => {
    const dto = createRecordingDto({
      title: 'E2E-Progress-Test',
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
      await db.from('video_progress').delete().eq('video_id', recordingId);
      await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
      await db.from('recording_batches').delete().eq('recording_id', recordingId);
      await db.from('recordings').delete().eq('id', recordingId);
    }
  });

  test('Student watches 30 seconds — progress persists after refresh', async ({
    request, studentAToken, studentBToken, studentAUserId, db,
  }) => {
    const progRes1 = await request.post(`/recordings/${recordingId}/progress`, {
      data: updateProgressDto(30, false),
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    await expectOk(progRes1);

    const dbProgress1 = await findProgress(db, studentAUserId, recordingId);
    expect(dbProgress1).toBeTruthy();
    expect(dbProgress1!.watched_seconds).toBe(30);
    expect(dbProgress1!.completed).toBe(false);

    const progRes2 = await request.post(`/recordings/${recordingId}/progress`, {
      data: updateProgressDto(120, true),
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    await expectOk(progRes2);

    const dbProgress2 = await findProgress(db, studentAUserId, recordingId);
    expect(dbProgress2!.watched_seconds).toBe(120);
    expect(dbProgress2!.completed).toBe(true);
    expect(dbProgress2!.last_watched_at).toBeTruthy();

    const progRes3 = await request.post(`/recordings/${recordingId}/progress`, {
      data: updateProgressDto(5, false),
      headers: { Authorization: `Bearer ${studentBToken}` },
    });

    expect(progRes3.ok()).toBe(true);
  });
});
