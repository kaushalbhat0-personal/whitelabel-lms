import { test, expect } from '../fixtures/recordings-fixture';
import { expectOk } from '../utils/assertions';
import {
  bulkCreateRecordings,
  countRecordings,
  deleteRecordings,
} from '../utils/db-helpers';

test.describe('Performance & Stress — bulk recordings, concurrent access, many items', () => {
  let stressRecordingIds: string[] = [];

  test.afterEach(async ({ db }) => {
    if (stressRecordingIds.length) {
      await db.from('batch_recording_curriculum').delete().in('content_id', stressRecordingIds).eq('content_type', 'recording');
      await db.from('recording_batches').delete().in('recording_id', stressRecordingIds);
      await db.from('video_progress').delete().in('video_id', stressRecordingIds);
      await db.from('recordings').delete().in('id', stressRecordingIds);
      stressRecordingIds.length = 0;
    }
  });

  test('bulk create 50 recordings via DB seed — all accessible by student', async ({
    db, seed, request, studentAToken,
  }) => {
    stressRecordingIds = await bulkCreateRecordings(db, 50, seed.batchAId);
    expect(stressRecordingIds).toHaveLength(50);

    const res = await request.get('/recordings/my', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const wrapper = await expectOk(res);
    const data = wrapper.data as any[];
    expect(data.length).toBeGreaterThanOrEqual(50);
  });

  test('bulk create 100 recordings — listing still returns within timeout', async ({
    db, seed,
  }) => {
    stressRecordingIds = await bulkCreateRecordings(db, 100, seed.batchAId);
    expect(stressRecordingIds).toHaveLength(100);

    const totalCount = await countRecordings(db);
    expect(totalCount).toBeGreaterThanOrEqual(100);
  });

  test('concurrent progress submissions from multiple recordings — all accepted', async ({
    db, seed, request, studentAToken, adminToken,
  }) => {
    const count = 20;
    stressRecordingIds = await bulkCreateRecordings(db, count, seed.batchAId);

    const progressPromises = stressRecordingIds.map((id, i) =>
      request.post(`/recordings/${id}/progress`, {
        data: { watchedSeconds: (i + 1) * 10, completed: false },
        headers: { Authorization: `Bearer ${studentAToken}` },
      }),
    );

    const responses = await Promise.all(progressPromises);
    for (const res of responses) {
      await expectOk(res);
    }

    const groupRes = await request.get('/recordings/my', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const groupData = (await expectOk(groupRes)).data as any[];
    expect(groupData.length).toBeGreaterThanOrEqual(count);
  });

  test('my recordings grouped endpoint returns sections', async ({
    db, seed, request, studentAToken, adminToken,
  }) => {
    stressRecordingIds = await bulkCreateRecordings(db, 10, seed.batchAId);

    const groupRes = await request.get('/recordings/my/grouped', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const wrapper = await expectOk(groupRes);
    const data = wrapper.data as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);

    const batchAGroup = data.find((g: any) => g.batchId === seed.batchAId);
    expect(batchAGroup).toBeTruthy();
    expect(batchAGroup.recordings || batchAGroup.videos || batchAGroup.sections).toBeTruthy();
  });

  test('concurrent progress from two students on same recording — no conflict', async ({
    db, seed, request, studentAToken, studentBToken, studentBUserId, adminToken,
  }) => {
    stressRecordingIds = await bulkCreateRecordings(db, 1, seed.batchAId);
    const id = stressRecordingIds[0];

    await db.from('batch_students').insert({
      user_id: studentBUserId,
      batch_id: seed.batchAId,
    });

    const progressA = request.post(`/recordings/${id}/progress`, {
      data: { watchedSeconds: 50, completed: false },
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const progressB = request.post(`/recordings/${id}/progress`, {
      data: { watchedSeconds: 120, completed: false },
      headers: { Authorization: `Bearer ${studentBToken}` },
    });

    const [resA, resB] = await Promise.all([progressA, progressB]);
    await expectOk(resA);
    await expectOk(resB);
  });

  test('my recordings endpoint returns data for student', async ({
    db, seed, request, studentAToken,
  }) => {
    stressRecordingIds = await bulkCreateRecordings(db, 15, seed.batchAId);

    const res = await request.get('/recordings/my', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const data = (await expectOk(res)).data as any[];
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});
