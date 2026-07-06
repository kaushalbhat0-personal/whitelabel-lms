import { test as base, request } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDb } from '../utils/db-helpers';
import { loginAs } from '../utils/login-helpers';
import { seedTestData, teardownTestData, enrollStudentInBatch, SeedContext } from '../utils/seed';


export type { SeedContext };

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@mct.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Admin1234!';
const STUDENT_A_EMAIL = process.env.E2E_STUDENT_A_EMAIL || 'student-a@mct.com';
const STUDENT_A_PASSWORD = process.env.E2E_STUDENT_A_PASSWORD || 'Student1234!';
const STUDENT_B_EMAIL = process.env.E2E_STUDENT_B_EMAIL || 'student-b@mct.com';
const STUDENT_B_PASSWORD = process.env.E2E_STUDENT_B_PASSWORD || 'Student1234!';

interface WorkerFixtures {
  workerDb: SupabaseClient;
  workerAuth: {
    admin: { token: string; userId: string };
    studentA: { token: string; userId: string };
    studentB: { token: string; userId: string };
  };
}

interface TestFixtures {
  adminToken: string;
  adminUserId: string;
  studentAToken: string;
  studentAUserId: string;
  studentBToken: string;
  studentBUserId: string;
  db: SupabaseClient;
  seed: SeedContext;
}

const test = base.extend<TestFixtures, WorkerFixtures>({
  workerDb: [
    async ({}, use) => {
      use(getDb());
    },
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

  db: async ({ workerDb }, use) => {
    use(workerDb);
  },

  seed: async ({ workerDb, workerAuth }, use) => {
    const context = await seedTestData();
    await enrollStudentInBatch(workerDb, workerAuth.studentA.userId, context.batchAId);
    await enrollStudentInBatch(workerDb, workerAuth.studentB.userId, context.batchBId);
    await use(context);
    await teardownTestData(context);
  },

  adminToken: async ({ workerAuth }, use) => {
    use(workerAuth.admin.token);
  },

  adminUserId: async ({ workerAuth }, use) => {
    use(workerAuth.admin.userId);
  },

  studentAToken: async ({ workerAuth }, use) => {
    use(workerAuth.studentA.token);
  },

  studentAUserId: async ({ workerAuth }, use) => {
    use(workerAuth.studentA.userId);
  },

  studentBToken: async ({ workerAuth }, use) => {
    use(workerAuth.studentB.token);
  },

  studentBUserId: async ({ workerAuth }, use) => {
    use(workerAuth.studentB.userId);
  },
});

export { test };
export { expect } from '@playwright/test';
