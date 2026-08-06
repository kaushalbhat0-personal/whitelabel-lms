import { test, expect } from '../fixtures/assessments-fixture';
import { authHeader } from '../utils/login-helpers';
import { nextSeq } from '../utils/counter';

/**
 * Question bank CRUD + archive/restore + bulk import.
 */
test.describe('Question Bank', () => {
  const mkQuestion = () => ({
    questionText: `E2E-QB-${String(nextSeq()).padStart(3, '0')}`,
    questionType: 'single_choice',
    options: { options: ['A', 'B', 'C'] },
    correctAnswer: 'A',
    difficulty: 'easy',
  });

  test('create, list, update, archive, unarchive, delete', async ({ request, db, adminToken }) => {
    // Create
    const c = await request.post('/questions', { headers: authHeader(adminToken), data: mkQuestion() });
    expect(c.status()).toBe(201);
    const qid = (await c.json()).data.id;

    // DB verified
    const { data: row } = await db.from('question_bank').select('id,is_archived,question_type').eq('id', qid).single();
    expect(row.question_type).toBe('single_choice');
    expect(row.is_archived).toBe(false);

    // List
    const l = await request.get('/questions?page=1&limit=50', { headers: authHeader(adminToken) });
    expect(l.status()).toBe(200);
    const lj = await l.json();
    expect(lj.data.items.some((q: any) => q.id === qid)).toBe(true);

    // Update
    const u = await request.patch(`/questions/${qid}`, { headers: authHeader(adminToken), data: { questionText: 'E2E-Updated-Q' } });
    expect([200, 201]).toContain(u.status());

    // Archive
    const ar = await request.post(`/questions/${qid}/archive`, { headers: authHeader(adminToken) });
    expect([200, 201]).toContain(ar.status());
    const { data: archived } = await db.from('question_bank').select('is_archived').eq('id', qid).single();
    expect(archived.is_archived).toBe(true);

    // Unarchive
    const un = await request.post(`/questions/${qid}/unarchive`, { headers: authHeader(adminToken) });
    expect([200, 201]).toContain(un.status());
    const { data: unarchived } = await db.from('question_bank').select('is_archived').eq('id', qid).single();
    expect(unarchived.is_archived).toBe(false);

    // Delete
    const d = await request.delete(`/questions/${qid}`, { headers: authHeader(adminToken) });
    expect([200, 201]).toContain(d.status());
    const { data: gone } = await db.from('question_bank').select('id').eq('id', qid).maybeSingle();
    expect(gone).toBeNull();
  });

  test('bulk import creates multiple questions', async ({ request, db, adminToken }) => {
    const bi = await request.post('/questions/bulk-import', {
      headers: authHeader(adminToken),
      data: { questions: [mkQuestion(), mkQuestion(), mkQuestion()] },
    });
    expect(bi.status()).toBe(201);
    const bj = await bi.json();
    expect(bj.data.imported).toBe(3);

    // DB verified + cleanup
    const ids = bj.data.questions.map((q: any) => q.id);
    const { data: rows } = await db.from('question_bank').select('id').in('id', ids);
    expect(rows.length).toBe(3);
    await db.from('question_bank').delete().in('id', ids);
  });

  test('validation rejects missing question text', async ({ request, adminToken }) => {
    const c = await request.post('/questions', { headers: authHeader(adminToken), data: { questionType: 'single_choice' } });
    expect(c.status()).toBe(400);
  });

  test('student cannot access question bank', async ({ request, studentAToken }) => {
    const c = await request.post('/questions', { headers: authHeader(studentAToken), data: mkQuestion() });
    expect(c.status()).toBe(403);
    const l = await request.get('/questions', { headers: authHeader(studentAToken) });
    expect(l.status()).toBe(403);
  });
});
