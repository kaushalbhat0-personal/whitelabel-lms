import { test as base, request } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDb } from '../utils/db-helpers';
import { loginAs } from '../utils/login-helpers';
import { seedTestData, enrollStudentInBatch, teardownTestData, SeedContext } from '../utils/seed';
import { nextSeq } from '../utils/counter';

export { expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@mct.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Admin1234!';
const STUDENT_A_EMAIL = process.env.E2E_STUDENT_A_EMAIL || 'student-a@mct.com';
const STUDENT_A_PASSWORD = process.env.E2E_STUDENT_A_PASSWORD || 'Student1234!';
const STUDENT_B_EMAIL = process.env.E2E_STUDENT_B_EMAIL || 'student-b@mct.com';
const STUDENT_B_PASSWORD = process.env.E2E_STUDENT_B_PASSWORD || 'Student1234!';

export interface AssessmentSeed extends SeedContext {
  questionId: string;
  testId: string;
  qIds: string[];
}

export async function createAssessmentSeed(db: SupabaseClient, opts?: { qCount?: number; createdBy?: string }): Promise<AssessmentSeed> {
  const baseSeed = await seedTestData();
  const qCount = opts?.qCount ?? 2;
  const createdBy = opts?.createdBy;

  const qIds: string[] = [];
  for (let i = 0; i < qCount; i++) {
    const { data, error } = await db.from('question_bank').insert({
      question_text: `E2E-Q-${String(nextSeq()).padStart(3, '0')}-${i}`,
      question_type: 'single_choice',
      options: { options: ['A', 'B', 'C'] },
      correct_answer: 'A',
      difficulty: 'easy',
      is_archived: false,
      created_by: createdBy,
    }).select('id').single();
    if (error) throw new Error(`question insert failed: ${error.message}`);
    qIds.push(data.id);
  }

  const { data: testData, error: testError } = await db.from('tests').insert({
    title: `E2E-Test-${String(nextSeq()).padStart(3, '0')}`,
    description: 'E2E assessment test',
    status: 'draft',
    duration_minutes: 30,
    total_marks: qCount * 5,
    passing_marks: Math.ceil((qCount * 5) * 0.4),
    max_attempts: 3,
    shuffle_questions: false,
    shuffle_options: false,
    show_result_immediately: true,
    created_by: createdBy ?? baseSeed.courseId,
  }).select('id').single();
  if (testError) throw new Error(`test insert failed: ${testError.message}`);
  const testId = testData.id;

  const tqbRows = qIds.map((qid, i) => ({ test_id: testId, question_bank_id: qid, marks: 5, sort_order: i }));
  const { error: tqbErr } = await db.from('test_question_bank').insert(tqbRows);
  if (tqbErr) throw new Error(`tqb insert failed: ${tqbErr.message}`);

  const { error: tbErr } = await db.from('test_batches').insert({ test_id: testId, batch_id: baseSeed.batchAId });
  if (tbErr) throw new Error(`test_batches insert failed: ${tbErr.message}`);

  return { ...baseSeed, questionId: qIds[0], testId, qIds };
}

export async function teardownAssessmentSeed(db: SupabaseClient, seed: AssessmentSeed) {
  const attempts = (await db.from('test_attempts').select('id').eq('test_id', seed.testId)).data ?? [];
  const attemptIds = attempts.map((a: any) => a.id);
  if (attemptIds.length) {
    await db.from('test_answers').delete().in('attempt_id', attemptIds);
  }
  await db.from('test_review_queue').delete().eq('test_id', seed.testId).then(() => undefined).catch(() => undefined);
  await db.from('test_results').delete().eq('test_id', seed.testId);
  await db.from('test_attempts').delete().eq('test_id', seed.testId);
  await db.from('test_batches').delete().eq('test_id', seed.testId);
  await db.from('test_question_bank').delete().eq('test_id', seed.testId);
  await db.from('test_sections').delete().eq('test_id', seed.testId);
  await db.from('test_analytics_snapshots').delete().eq('test_id', seed.testId).then(() => undefined).catch(() => undefined);
  await db.from('tests').delete().eq('id', seed.testId);
  await db.from('question_bank').delete().in('id', seed.qIds);
  await teardownTestData(seed);
}

interface WorkerFixtures {
  workerDb: SupabaseClient;
  workerAuth: {
    admin: { token: string; userId: string };
    studentA: { token: string; userId: string };
    studentB: { token: string; userId: string };
  };
}

interface TestFixtures {
  db: SupabaseClient;
  adminToken: string;
  adminUserId: string;
  studentAToken: string;
  studentAUserId: string;
  studentBToken: string;
  studentBUserId: string;
  seed: AssessmentSeed;
}

const test = base.extend<TestFixtures, WorkerFixtures>({
  workerDb: [
    async ({}, use) => { use(getDb()); },
    { scope: 'worker' },
  ],
  workerAuth: [
    async ({}, use) => {
      const ctx = await request.newContext({ baseURL: 'http://localhost:3001' });
      const admin = await loginAs(ctx, ADMIN_EMAIL, ADMIN_PASSWORD);
      const studentA = await loginAs(ctx, STUDENT_A_EMAIL, STUDENT_A_PASSWORD);
      const studentB = await loginAs(ctx, STUDENT_B_EMAIL, STUDENT_B_PASSWORD);
      await use({ admin, studentA, studentB });
    },
    { scope: 'worker' },
  ],
  db: async ({ workerDb }, use) => { use(workerDb); },
  adminToken: async ({ workerAuth }, use) => { use(workerAuth.admin.token); },
  adminUserId: async ({ workerAuth }, use) => { use(workerAuth.admin.userId); },
  studentAToken: async ({ workerAuth }, use) => { use(workerAuth.studentA.token); },
  studentAUserId: async ({ workerAuth }, use) => { use(workerAuth.studentA.userId); },
  studentBToken: async ({ workerAuth }, use) => { use(workerAuth.studentB.token); },
  studentBUserId: async ({ workerAuth }, use) => { use(workerAuth.studentB.userId); },
  seed: async ({ workerDb, workerAuth }, use) => {
    const seed = await createAssessmentSeed(workerDb, { createdBy: workerAuth.admin.userId });
    await enrollStudentInBatch(workerDb, workerAuth.studentA.userId, seed.batchAId);
    await enrollStudentInBatch(workerDb, workerAuth.studentB.userId, seed.batchBId);
    await use(seed);
    await teardownAssessmentSeed(workerDb, seed);
  },
});

export { test };
