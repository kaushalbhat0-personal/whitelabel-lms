import { test, expect } from '../fixtures/assessments-fixture';
import { authHeader } from '../utils/login-helpers';

/**
 * Assessment security — role guards, ownership, batch authorization,
 * answer leakage, cross-user access.
 */
test.describe('Assessment Security', () => {
  test('student cannot access admin assessment endpoints', async ({ request, studentAToken }) => {
    const endpoints = [
      ['get', '/tests'],
      ['post', '/tests'],
      ['get', '/questions'],
      ['post', '/questions'],
      ['get', '/evaluation/review-queue'],
      ['get', '/results/test/some-id'],
    ] as const;
    for (const [method, url] of endpoints) {
      const r = await request[method](url, { headers: authHeader(studentAToken), data: {} });
      expect(r.status()).toBe(403);
    }
  });

  test('cross-user attempt access blocked', async ({ request, db, adminToken, studentAToken, studentBToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const attemptId = (await s.json()).data.id;

    // student B tries to read/save/submit student A's attempt
    const read = await request.get(`/attempts/${attemptId}`, { headers: authHeader(studentBToken) });
    expect(read.status()).toBe(403);

    const save = await request.patch(`/attempts/${attemptId}/answers`, {
      headers: authHeader(studentBToken),
      data: { answers: [], currentQuestionIndex: 0 },
    });
    expect(save.status()).toBe(403);

    const sub = await request.post(`/attempts/${attemptId}/submit`, {
      headers: authHeader(studentBToken), data: { answers: [], timeRemainingSeconds: 0 },
    });
    expect(sub.status()).toBe(403);

    const timer = await request.get(`/attempts/${attemptId}/timer`, { headers: authHeader(studentBToken) });
    expect(timer.status()).toBe(403);
  });

  test('cross-user result access blocked', async ({ request, db, adminToken, studentAToken, studentBToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const attemptId = (await s.json()).data.id;
    await request.post(`/attempts/${attemptId}/submit`, { headers: authHeader(studentAToken), data: { answers: [], timeRemainingSeconds: 0 } });
    await request.post(`/evaluation/${attemptId}/auto-grade`, { headers: authHeader(adminToken) });

    const res = await request.get(`/results/${attemptId}`, { headers: authHeader(studentBToken) });
    expect(res.status()).toBe(403);
  });

  test('student not enrolled in assigned batch cannot start test', async ({ request, db, adminToken, studentBToken, seed }) => {
    // seed assigns test to batchA; studentB is enrolled in batchB
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentBToken), data: {} });
    expect(s.status()).toBe(403);
  });

  test('no correct_answer leaked in start response', async ({ request, adminToken, studentAToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    expect(s.status()).toBe(201);
    const sj = await s.json();
    for (const q of sj.data.questions) {
      expect(q.correct_answer).toBeUndefined();
      expect(q.explanation).toBeUndefined();
    }
  });

  test('cannot save answer for a question not in the test', async ({ request, adminToken, studentAToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const attemptId = (await s.json()).data.id;

    const save = await request.patch(`/attempts/${attemptId}/answers`, {
      headers: authHeader(studentAToken),
      data: { answers: [{ questionId: '00000000-0000-0000-0000-000000000000', questionType: 'single_choice', answer: 'A' }], currentQuestionIndex: 0 },
    });
    expect(save.status()).toBe(403);
  });

  test('admin cannot act as student on results/my', async ({ request, adminToken }) => {
    const r = await request.get('/results/my', { headers: authHeader(adminToken) });
    expect(r.status()).toBe(403);
  });
});
