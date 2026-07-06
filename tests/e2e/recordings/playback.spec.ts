import { test, expect } from '../fixtures/recordings-fixture';
import { expectOk } from '../utils/assertions';
import { createRecordingInDb, assignRecordingToBatch } from '../utils/db-helpers';

test.describe('Playback Authorization — Test 5', () => {
  let recordingId: string;

  test.beforeEach(async ({ db, seed }) => {
    recordingId = await createRecordingInDb(db, {
      title: 'E2E-Playback-Test',
      status: 'ready',
    });
    await assignRecordingToBatch(db, recordingId, seed.batchAId);
  });

  test.afterEach(async ({ db }) => {
    if (recordingId) {
      await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
      await db.from('recording_batches').delete().eq('recording_id', recordingId);
      await db.from('recordings').delete().eq('id', recordingId);
    }
  });

  test('Student A (assigned to Batch A) gets playback URL — 200', async ({
    request, studentAToken,
  }) => {
    const authRes = await request.post(`/recordings/${recordingId}/authorize`, {
      data: {},
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const authData = (await expectOk(authRes)).data as Record<string, unknown>;
    const token = authData.token as string;

    const playRes = await request.get(`/recordings/${recordingId}/play`, {
      params: { token },
      headers: { Authorization: `Bearer ${studentAToken}` },
    });

    expect(playRes.status()).not.toBe(403);
    expect(playRes.status()).not.toBe(404);
    expect(playRes.status()).not.toBe(500);
  });
});
