import { test, expect } from '../fixtures/assessments-fixture';
import { authHeader } from '../utils/login-helpers';

/**
 * Attempt lifecycle e2e — covers the P0/P1 fixes:
 * fresh start, save, submit, auto-grade, publish, result.
 */
test.describe('Assessment Attempt Lifecycle', () => {
  test('full lifecycle: start -> save -> submit -> auto-grade -> published result', async ({
    request, db, adminToken, studentAToken, seed,
  }) => {
    // Publish the test
    const pub = await request.patch(`/tests/${seed.testId}/status`, {
      headers: authHeader(adminToken), data: { status: 'published' },
    });
    expect(pub.ok()).toBeTruthy();

    // 1. Fresh start (was P0: 500 on sort_order)
    const start = await request.post(`/attempts/tests/${seed.testId}/start`, {
      headers: authHeader(studentAToken), data: {},
    });
    expect(start.status()).toBe(201);
    const sj = await start.json();
    const attemptId = sj.data.id;
    expect(sj.data.status).toBe('in_progress');
    expect(sj.data.questions.length).toBeGreaterThan(0);

    // DB: attempt row exists, in_progress
    const { data: attemptRow } = await db.from('test_attempts').select('id,status').eq('id', attemptId).single();
    expect(attemptRow.status).toBe('in_progress');

    // 2. Save answers (was broken: updated_at on test_attempts)
    const qs = sj.data.questions;
    const answers = qs.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: 'A' }));
    const save = await request.patch(`/attempts/${attemptId}/answers`, {
      headers: authHeader(studentAToken), data: { answers, currentQuestionIndex: 0, timeRemainingSeconds: 1700 },
    });
    expect(save.status()).toBe(200);

    // DB: answers persisted
    const { data: ansRows } = await db.from('test_answers').select('id').eq('attempt_id', attemptId);
    expect(ansRows.length).toBe(qs.length);

    // 3. Submit
    const sub = await request.post(`/attempts/${attemptId}/submit`, {
      headers: authHeader(studentAToken), data: { answers, timeRemainingSeconds: 1700 },
    });
    expect(sub.status()).toBe(201);
    const { data: submittedRow } = await db.from('test_attempts').select('status,submitted_at').eq('id', attemptId).single();
    expect(submittedRow.status).toBe('submitted');
    expect(submittedRow.submitted_at).not.toBeNull();

    // 4. Auto-grade (was P0: 500 on updated_at)
    const grade = await request.post(`/evaluation/${attemptId}/auto-grade`, {
      headers: authHeader(adminToken),
    });
    expect(grade.status()).toBe(201);
    const gj = await grade.json();
    expect(gj.data.summary.autoGraded).toBeGreaterThan(0);

    // 5. Result published + DB verified
    const res = await request.get(`/results/${attemptId}`, { headers: authHeader(studentAToken) });
    expect(res.status()).toBe(200);
    const rj = await res.json();
    expect(rj.data.passed).toBeDefined();
    expect(rj.data.obtained_marks).toBeGreaterThanOrEqual(0);

    const { data: resultRow } = await db.from('test_results').select('id,attempt_id,rank').eq('attempt_id', attemptId).single();
    expect(resultRow.attempt_id).toBe(attemptId);
    expect(resultRow.rank).toBeGreaterThanOrEqual(1);
  });

  test('resume returns the in-progress attempt without creating a duplicate', async ({
    request, db, adminToken, studentAToken, studentAUserId, seed,
  }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    const s1 = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    expect(s1.status()).toBe(201);
    const attemptId = (await s1.json()).data.id;

    const s2 = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    expect(s2.status()).toBe(201);
    expect((await s2.json()).data.id).toBe(attemptId);

    // DB: only one in_progress attempt
    const { data: rows } = await db.from('test_attempts').select('id').eq('test_id', seed.testId).eq('user_id', studentAUserId).eq('status', 'in_progress');
    expect(rows.length).toBe(1);
  });

  test('max attempts enforced', async ({ request, db, adminToken, studentAToken, seed }) => {
    // set max_attempts=1 and publish
    await db.from('tests').update({ max_attempts: 1 }).eq('id', seed.testId);
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    const s1 = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    expect(s1.status()).toBe(201);
    const attemptId = (await s1.json()).data.id;

    // submit it
    await request.post(`/attempts/${attemptId}/submit`, { headers: authHeader(studentAToken), data: { answers: [], timeRemainingSeconds: 0 } });

    // second attempt should be blocked
    const s2 = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    expect(s2.status()).toBe(403);
  });

  test('cannot start a draft test', async ({ request, adminToken, studentAToken, seed }) => {
    // test is draft by default
    const start = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    expect(start.status()).toBe(403);
  });
});
