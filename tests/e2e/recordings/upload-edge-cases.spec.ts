import { test, expect } from '../fixtures/recordings-fixture';
import { expectCreated, expectBadRequest, expectOk } from '../utils/assertions';
import { createRecordingDto } from '../utils/factories';
import { findRecordingById, deleteRecordings } from '../utils/db-helpers';

test.describe('Upload Edge Cases — validation, concurrent, delete-while-processing', () => {
  const recordingIds: string[] = [];

  test.afterEach(async ({ db }) => {
    if (recordingIds.length) {
      await deleteRecordings(db, [...recordingIds]);
      recordingIds.length = 0;
    }
  });

  test('rejects recording with empty title — 400', async ({ request, adminToken, seed }) => {
    const res = await request.post('/admin/recordings', {
      data: { title: '', batchIds: [seed.batchAId] },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expectBadRequest(res);
  });

  test('rejects recording with non-existent batch ID — 400', async ({ request, adminToken }) => {
    const fakeBatchId = '00000000-0000-0000-0000-000000000000';
    const res = await request.post('/admin/recordings', {
      data: { title: 'E2E-Bad-Batch', batchIds: [fakeBatchId] },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(400);
  });

  test('rejects recording with empty batchIds array — 400', async ({ request, adminToken }) => {
    const res = await request.post('/admin/recordings', {
      data: { title: 'E2E-No-Batches', batchIds: [] },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expectBadRequest(res);
  });

  test('creates recording with duplicate title — succeeds (no unique constraint)', async ({
    request, adminToken, seed, db,
  }) => {
    const dto = createRecordingDto({
      title: 'E2E-Duplicate-Title',
      batchIds: [seed.batchAId],
    });
    const res1 = await request.post('/admin/recordings', {
      data: dto,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const wrapper1 = await expectCreated(res1);
    const id1 = ((wrapper1.data as Record<string, unknown>).recording as Record<string, unknown>).id as string;
    recordingIds.push(id1);

    const res2 = await request.post('/admin/recordings', {
      data: { ...dto, title: 'E2E-Duplicate-Title' },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const wrapper2 = await expectCreated(res2);
    const id2 = ((wrapper2.data as Record<string, unknown>).recording as Record<string, unknown>).id as string;
    recordingIds.push(id2);

    expect(id1).not.toBe(id2);

    const dbRec1 = await findRecordingById(db, id1);
    const dbRec2 = await findRecordingById(db, id2);
    expect(dbRec1!.title).toBe('E2E-Duplicate-Title');
    expect(dbRec2!.title).toBe('E2E-Duplicate-Title');
  });

  test('creates multiple recordings concurrently — all succeed', async ({
    request, adminToken, seed,
  }) => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      request.post('/admin/recordings', {
        data: createRecordingDto({
          title: `E2E-Concurrent-${i}`,
          batchIds: [seed.batchAId],
        }),
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
    );

    const responses = await Promise.all(promises);
    for (const res of responses) {
      const wrapper = await expectCreated(res);
      const data = wrapper.data as Record<string, unknown>;
      recordingIds.push(
        ((data.recording as Record<string, unknown>).id as string),
      );
    }
    expect(recordingIds).toHaveLength(5);
  });

  test('deletes recording while still processing — cleanup_pending set', async ({
    request, adminToken, seed, db,
  }) => {
    const dto = createRecordingDto({
      title: 'E2E-Delete-While-Processing',
      batchIds: [seed.batchAId],
    });
    const res = await request.post('/admin/recordings', {
      data: dto,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const wrapper = await expectCreated(res);
    const id = ((wrapper.data as Record<string, unknown>).recording as Record<string, unknown>).id as string;
    recordingIds.push(id);

    const delRes = await request.delete(`/admin/recordings/${id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const result = (await expectOk(delRes)).data as Record<string, unknown>;
    expect(result.deleted).toBe(true);

    const dbRec = await findRecordingById(db, id);
    if (dbRec) {
      expect(dbRec.cleanup_pending).toBe(true);
    }
  });

  test('delete non-existent recording — 404', async ({ request, adminToken }) => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request.delete(`/admin/recordings/${fakeId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(404);
  });
});
