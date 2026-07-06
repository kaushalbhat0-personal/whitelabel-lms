import { test, expect } from '../fixtures/recordings-fixture';
import { expectOk } from '../utils/assertions';
import { updateCurriculumDto } from '../utils/factories';
import { findCurriculumEntries, createRecordingInDb, assignRecordingToBatch } from '../utils/db-helpers';

test.describe('Curriculum Customization — Test 4', () => {
  let recordingId: string;

  test.beforeEach(async ({ db, seed }) => {
    recordingId = await createRecordingInDb(db, {
      title: 'E2E-Curriculum-Test',
      status: 'ready',
    });
    await assignRecordingToBatch(db, recordingId, seed.batchAId);
    await assignRecordingToBatch(db, recordingId, seed.batchBId);
  });

  test.afterEach(async ({ db }) => {
    if (recordingId) {
      await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
      await db.from('recording_batches').delete().eq('recording_id', recordingId);
      await db.from('recordings').delete().eq('id', recordingId);
    }
  });

  test('customizes curriculum per batch — section, sort order, visibility', async ({
    request, adminToken, db, seed, studentAToken, studentBToken,
  }) => {
    const dto = updateCurriculumDto([
      {
        batchId: seed.batchAId,
        sectionName: 'Swing Trading',
        sortOrder: 1,
        isVisible: true,
        assigned: true,
      },
      {
        batchId: seed.batchBId,
        sectionName: 'Advanced',
        sortOrder: 8,
        isVisible: false,
        assigned: true,
      },
    ]);

    const res = await request.patch(`/admin/recordings/${recordingId}/batch-curriculum`, {
      data: dto,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expectOk(res);

    const entries = await findCurriculumEntries(db, recordingId);
    expect(entries).toHaveLength(2);

    const batchAEntry = entries.find((e: any) => e.batch_id === seed.batchAId);
    expect(batchAEntry).toBeTruthy();
    expect(batchAEntry!.category_name).toBe('Swing Trading');
    expect(batchAEntry!.sort_order).toBe(1);
    expect(batchAEntry!.is_published).toBe(true);

    const batchBEntry = entries.find((e: any) => e.batch_id === seed.batchBId);
    expect(batchBEntry).toBeTruthy();
    expect(batchBEntry!.category_name).toBe('Advanced');
    expect(batchBEntry!.sort_order).toBe(8);
    expect(batchBEntry!.is_published).toBe(false);

    const groupResA = await request.get('/recordings/my/grouped', {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const groupA = (await expectOk(groupResA)).data as any[];

    const batchAGroup = groupA.find((g: any) => g.batchId === seed.batchAId);
    expect(batchAGroup).toBeTruthy();
    const swingSection = batchAGroup!.sections.find(
      (s: any) => s.sectionName === 'Swing Trading',
    );
    expect(swingSection).toBeTruthy();
    const recordingInSectionA = swingSection.recordings.find(
      (r: any) => r.id === recordingId,
    );
    expect(recordingInSectionA).toBeTruthy();

    const groupResB = await request.get('/recordings/my/grouped', {
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    const groupB = (await expectOk(groupResB)).data as any[];

    const batchBGroup = groupB.find((g: any) => g.batchId === seed.batchBId);
    if (batchBGroup) {
      const recordingInSwingSection = batchBGroup.sections.some(
        (s: any) => s.sectionName === 'Swing Trading' &&
          s.recordings.some((r: any) => r.id === recordingId),
      );
      expect(recordingInSwingSection).toBe(false);
    }
  });
});
