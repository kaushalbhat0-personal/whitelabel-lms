import { test, expect } from '../fixtures/assessments-fixture';
import { authHeader } from '../utils/login-helpers';
import { nextSeq } from '../utils/counter';

/**
 * Test CRUD: create, duplicate, list, publish, archive, delete.
 */
test.describe('Test Management', () => {
  test('admin creates a test with questions + batch assignment', async ({ request, db, adminToken, seed }) => {
    const c = await request.post('/tests', {
      headers: authHeader(adminToken),
      data: {
        title: `E2E-Create-${String(nextSeq()).padStart(3, '0')}`,
        description: 'created test',
        durationMinutes: 45,
        totalMarks: 10,
        passingMarks: 4,
        maxAttempts: 2,
        sections: [{ title: 'Section 1' }],
        questions: [{ questionBankId: seed.questionId, marks: 5 }],
        batches: [{ batchId: seed.batchAId }],
      },
    });
    expect(c.status()).toBe(201);
    const cj = await c.json();
    expect(cj.data.id).toBeTruthy();

    // DB verified
    const { data: row } = await db.from('tests').select('id,status,total_marks,max_attempts').eq('id', cj.data.id).single();
    expect(row.status).toBe('draft');
    expect(row.max_attempts).toBe(2);
    const { data: tqb } = await db.from('test_question_bank').select('id').eq('test_id', cj.data.id);
    expect(tqb.length).toBe(1);

    // cleanup
    await db.from('test_batches').delete().eq('test_id', cj.data.id);
    await db.from('test_question_bank').delete().eq('test_id', cj.data.id);
    await db.from('test_sections').delete().eq('test_id', cj.data.id);
    await db.from('tests').delete().eq('id', cj.data.id);
  });

  test('duplicate creates a copy', async ({ request, db, adminToken, seed }) => {
    const dup = await request.post(`/tests/${seed.testId}/duplicate`, { headers: authHeader(adminToken) });
    expect(dup.status()).toBe(201);
    const dj = await dup.json();
    expect(dj.data.title).toContain('(Copy)');

    // DB: copy has same question links
    const { data: tqb } = await db.from('test_question_bank').select('question_bank_id').eq('test_id', dj.data.id);
    expect(tqb.length).toBe(seed.qIds.length);

    // cleanup
    await db.from('test_batches').delete().eq('test_id', dj.data.id);
    await db.from('test_question_bank').delete().eq('test_id', dj.data.id);
    await db.from('test_sections').delete().eq('test_id', dj.data.id);
    await db.from('tests').delete().eq('id', dj.data.id);
  });

  test('publish + archive status transitions', async ({ request, db, adminToken, seed }) => {
    // draft -> published
    const pub = await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    expect([200, 201]).toContain(pub.status());
    const { data: pubRow } = await db.from('tests').select('status').eq('id', seed.testId).single();
    expect(pubRow.status).toBe('published');

    // published -> archived
    const arc = await request.post(`/tests/${seed.testId}/archive`, { headers: authHeader(adminToken) });
    expect([200, 201]).toContain(arc.status());
    const { data: arcRow } = await db.from('tests').select('status').eq('id', seed.testId).single();
    expect(arcRow.status).toBe('archived');
  });

  test('delete removes the test and relations', async ({ request, db, adminToken }) => {
    // create a throwaway test
    const c = await request.post('/tests', {
      headers: authHeader(adminToken),
      data: { title: `E2E-Del-${String(nextSeq()).padStart(3, '0')}`, totalMarks: 5, passingMarks: 2, durationMinutes: 30 },
    });
    const testId = (await c.json()).data.id;

    const d = await request.delete(`/tests/${testId}`, { headers: authHeader(adminToken) });
    expect([200, 201]).toContain(d.status());
    const { data: gone } = await db.from('tests').select('id').eq('id', testId).maybeSingle();
    expect(gone).toBeNull();
  });

  test('validation rejects test without title/marks', async ({ request, adminToken }) => {
    const c = await request.post('/tests', { headers: authHeader(adminToken), data: { description: 'no title' } });
    expect(c.status()).toBe(400);
  });

  test('student can see only tests for their batches', async ({ request, db, adminToken, studentAToken, studentAUserId, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    // create a second test assigned to a batch studentA is NOT in
    const other = await request.post('/tests', {
      headers: authHeader(adminToken),
      data: { title: `E2E-Other-${String(nextSeq()).padStart(3, '0')}`, totalMarks: 5, passingMarks: 2, durationMinutes: 30, batches: [{ batchId: seed.batchBId }] },
    });
    const otherId = (await other.json()).data.id;
    await request.patch(`/tests/${otherId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    const my = await request.get('/tests/my', { headers: authHeader(studentAToken) });
    const myj = await my.json();
    const visibleIds = myj.data.items.map((t: any) => t.id);
    expect(visibleIds).toContain(seed.testId);
    expect(visibleIds).not.toContain(otherId);

    // cleanup
    await db.from('test_batches').delete().eq('test_id', otherId);
    await db.from('tests').delete().eq('id', otherId);
  });
});

