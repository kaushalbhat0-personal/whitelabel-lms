import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

function loadEnvFile(): void {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
loadEnvFile();

const CI = !!process.env.CI;

const MONOREPO_ROOT = path.resolve(__dirname, '../..');

const REUSE_SERVER = process.env.PW_REUSE === 'true';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : 1,
  maxFailures: CI ? 5 : undefined,

  timeout: CI ? 120_000 : 60_000,
  expect: { timeout: 10_000 },

  outputDir: 'test-results',
  globalSetup: './globalSetup',

  use: {
    baseURL: process.env.API_URL || 'http://localhost:3001',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: CI ? 'retain-on-failure' : 'off',
  },

  projects: [
    {
      name: 'recordings-api',
      testMatch: 'recordings/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'assessments-api',
      testMatch: 'assessments/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: `node ${path.relative(
        path.join(MONOREPO_ROOT, 'apps/api'),
        path.join(MONOREPO_ROOT, 'apps/api/dist/apps/api/src/main.js'),
      )}`,
      url: 'http://localhost:3001/',
      reuseExistingServer: REUSE_SERVER,
      timeout: 120_000,
      cwd: path.join(MONOREPO_ROOT, 'apps/api'),
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        NODE_ENV: process.env.NODE_ENV || 'development',
        PORT: '3001',
        FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
      },
    },
    {
      command: CI ? 'pnpm --filter @lms/web start' : 'pnpm --filter @lms/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: REUSE_SERVER,
      timeout: 120_000,
      cwd: MONOREPO_ROOT,
      env: {
        PORT: '3000',
        NEXT_PUBLIC_API_URL: process.env.API_URL || 'http://localhost:3001',
      },
    },
  ],

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ...(CI
      ? [['json', { outputFile: 'test-results/e2e-results.json' }]]
      : []),
  ],
});
