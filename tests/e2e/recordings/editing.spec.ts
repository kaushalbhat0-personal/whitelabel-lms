import { test, expect } from '../fixtures/recordings-fixture';
import { expectOk, expectCreated, expectNotFound, expectBadRequest } from '../utils/assertions';
import { createRecordingDto, updateRecordingDto } from '../utils/factories';
import { findRecordingById } from '../utils/db-helpers';

test.describe('Admin Editing — rename, description, topic', () => {
  let recordingId: string;

  test.beforeEach(async ({ request, adminToken, seed }) => {
    const dto = createRecordingDto({
      title: 'E2E-Edit-Test',
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
      await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
      await db.from('recording_batches').delete().eq('recording_id', recordingId);
      await db.from('recordings').delete().eq('id', recordingId);
    }
  });

  test('renames recording title — updated in DB', async ({ request, adminToken, db }) => {
    const dto = updateRecordingDto({ title: 'E2E-Renamed-Title' });
    const res = await request.patch(`/admin/recordings/${recordingId}`, {
      data: dto,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expectOk(res);

    const dbRec = await findRecordingById(db, recordingId);
    expect(dbRec!.title).toBe('E2E-Renamed-Title');
  });

  test('updates description — updated in DB', async ({ request, adminToken, db }) => {
    const dto = updateRecordingDto({ description: 'E2E-Updated-Description' });
    const res = await request.patch(`/admin/recordings/${recordingId}`, {
      data: dto,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expectOk(res);

    const dbRec = await findRecordingById(db, recordingId);
    expect(dbRec!.description).toBe('E2E-Updated-Description');
  });

  test('rejects empty title — 400 bad request', async ({ request, adminToken }) => {
    const res = await request.patch(`/admin/recordings/${recordingId}`, {
      data: { title: '' },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expectBadRequest(res);
  });

  test('returns error for non-existent recording', async ({ request, adminToken }) => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const res = await request.patch(`/admin/recordings/${fakeId}`, {
      data: { title: 'Nope' },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(400);
  });

  test('rejects unauthenticated request — 401', async ({ request }) => {
    const res = await request.patch(`/admin/recordings/${recordingId}`, {
      data: { title: 'Should-Not-Work' },
    });
    expect(res.status()).toBe(401);
  });

  test('rejects non-admin token — 403', async ({ request, studentAToken }) => {
    const res = await request.patch(`/admin/recordings/${recordingId}`, {
      data: { title: 'Student-Try-Edit' },
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
