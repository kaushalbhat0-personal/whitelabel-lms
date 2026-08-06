import { test, expect } from '../fixtures/assessments-fixture';
import { authHeader } from '../utils/login-helpers';
import { nextSeq } from '../utils/counter';

/**
 * Results + review queue + manual grading + DB state transitions.
 */
test.describe('Assessment Results & Review', () => {
  test('manual review flow: pending -> review -> published result', async ({ request, db, adminToken, studentAToken, seed }) => {
    // Add a long_answer question to force manual review
    const { data: laQ } = await db.from('question_bank').insert({
      question_text: `E2E-LA-${String(nextSeq()).padStart(3, '0')}`,
      question_type: 'long_answer',
      difficulty: 'medium',
      is_archived: false,
      created_by: (await db.from('profiles').select('id').limit(1).single()).data.id,
    }).select('id').single();
    await db.from('test_question_bank').insert({ test_id: seed.testId, question_bank_id: laQ.id, marks: 5, sort_order: 10 });
    await db.from('tests').update({ total_marks: 15 }).eq('id', seed.testId);

    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const sj = await s.json();
    const attemptId = sj.data.id;
    const answers = sj.data.questions.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: q.question_type === 'long_answer' ? 'My answer' : 'A' }));
    await request.post(`/attempts/${attemptId}/submit`, { headers: authHeader(studentAToken), data: { answers, timeRemainingSeconds: 0 } });

    // auto-grade routes long_answer to review queue
    await request.post(`/evaluation/${attemptId}/auto-grade`, { headers: authHeader(adminToken) });

    // DB: review queue has pending item
    const { data: queue } = await db.from('test_review_queue').select('id,status').eq('attempt_id', attemptId).eq('status', 'pending');
    expect(queue.length).toBeGreaterThan(0);

    // assign + review the first pending item
    const reviewId = queue[0].id;
    const assign = await request.patch(`/evaluation/review-queue/${reviewId}/assign`, { headers: authHeader(adminToken) });
    expect([200, 201]).toContain(assign.status());

    const review = await request.patch(`/evaluation/review-queue/${reviewId}/review`, {
      headers: authHeader(adminToken), data: { marksAwarded: 4, feedback: 'Good work' },
    });
    expect(review.status()).toBe(200);

    // DB: review queue item reviewed
    const { data: reviewed } = await db.from('test_review_queue').select('status').eq('id', reviewId).single();
    expect(reviewed.status).toBe('reviewed');

    // Result now published (all manual reviews complete)
    const res = await request.get(`/results/${attemptId}`, { headers: authHeader(studentAToken) });
    expect(res.status()).toBe(200);
    const rj = await res.json();
    expect(rj.data.obtained_marks).toBeGreaterThanOrEqual(4);

    // cleanup the added long_answer question
    await db.from('test_question_bank').delete().eq('test_id', seed.testId).eq('question_bank_id', laQ.id);
    await db.from('question_bank').delete().eq('id', laQ.id);
  });

  test('results list + detail return published data', async ({ request, db, adminToken, studentAToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const attemptId = (await s.json()).data.id;
    const qs = (await s.json()).data.questions;
    const answers = qs.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: 'A' }));
    await request.post(`/attempts/${attemptId}/submit`, { headers: authHeader(studentAToken), data: { answers, timeRemainingSeconds: 0 } });
    await request.post(`/evaluation/${attemptId}/auto-grade`, { headers: authHeader(adminToken) });

    const my = await request.get('/results/my', { headers: authHeader(studentAToken) });
    expect(my.status()).toBe(200);
    const myj = await my.json();
    expect(myj.data.items.some((r: any) => r.attempt_id === attemptId)).toBe(true);

    const detail = await request.get(`/results/${attemptId}`, { headers: authHeader(studentAToken) });
    expect(detail.status()).toBe(200);
    const dj = await detail.json();
    expect(dj.data.obtained_marks).toBeDefined();
  });

  test('test-level results and analytics for admin', async ({ request, db, adminToken, studentAToken, seed }) => {
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });
    const s = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const sj = await s.json();
    const attemptId = sj.data.id;
    const qs = sj.data.questions;
    const answers = qs.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: 'A' }));
    await request.post(`/attempts/${attemptId}/submit`, { headers: authHeader(studentAToken), data: { answers, timeRemainingSeconds: 0 } });
    await request.post(`/evaluation/${attemptId}/auto-grade`, { headers: authHeader(adminToken) });

    const tr = await request.get(`/results/test/${seed.testId}`, { headers: authHeader(adminToken) });
    expect(tr.status()).toBe(200);
    const trj = await tr.json();
    expect(trj.data.items.length).toBeGreaterThanOrEqual(1);

    // calculate + fetch analytics (retry briefly — snapshot is written async)
    await request.post(`/evaluation/tests/${seed.testId}/analytics`, { headers: authHeader(adminToken) });
    let taj: any = null;
    for (let i = 0; i < 5; i++) {
      const ta = await request.get(`/results/test/${seed.testId}/analytics`, { headers: authHeader(adminToken) });
      if (ta.status() === 200) { taj = await ta.json(); break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(taj).not.toBeNull();
    expect(taj.data.total_attempts).toBeGreaterThanOrEqual(1);

    // DB: analytics snapshot exists
    const { data: snap } = await db.from('test_analytics_snapshots').select('id,total_attempts').eq('test_id', seed.testId).order('calculated_at', { ascending: false }).limit(1).maybeSingle();
    expect(snap).not.toBeNull();
  });

  test('rank computed correctly for multiple attempts', async ({ request, db, adminToken, studentAToken, studentBToken, studentBUserId, seed }) => {
    // student B must be in the same batch as the test (batchA)
    await db.from('batch_students').insert({ user_id: studentBUserId, batch_id: seed.batchAId });
    await request.patch(`/tests/${seed.testId}/status`, { headers: authHeader(adminToken), data: { status: 'published' } });

    // student A gets all correct
    const sa = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentAToken), data: {} });
    const saj = await sa.json();
    const qsA = saj.data.questions;
    const ansA = qsA.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: 'A' }));
    await request.post(`/attempts/${saj.data.id}/submit`, { headers: authHeader(studentAToken), data: { answers: ansA, timeRemainingSeconds: 0 } });
    await request.post(`/evaluation/${saj.data.id}/auto-grade`, { headers: authHeader(adminToken) });

    // student B gets wrong answers
    const sb = await request.post(`/attempts/tests/${seed.testId}/start`, { headers: authHeader(studentBToken), data: {} });
    const sbj = await sb.json();
    const qsB = sbj.data.questions;
    const ansB = qsB.map((q: any) => ({ questionId: q.id, questionType: q.question_type, answer: 'B' }));
    await request.post(`/attempts/${sbj.data.id}/submit`, { headers: authHeader(studentBToken), data: { answers: ansB, timeRemainingSeconds: 0 } });
    await request.post(`/evaluation/${sbj.data.id}/auto-grade`, { headers: authHeader(adminToken) });

    // A should rank 1 (higher marks), B should rank 2
    const ra = await request.get(`/results/${saj.data.id}`, { headers: authHeader(studentAToken) });
    const raj = await ra.json();
    expect(raj.data.rank).toBe(1);
  });
});
