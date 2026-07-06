import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function loadEnvFile(): void {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.warn(`[globalSetup] WARNING: no .env file found at ${envPath}`);
    console.warn(`[globalSetup] Create one from .env.example`);
    return;
  }
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

function envCheck(key: string, secret: boolean): string {
  const val = process.env[key];
  if (!val) return `${key} ❌ MISSING`;
  if (secret && val.length > 8) return `${key} ✅ ${val.slice(0, 4)}...${val.slice(-4)}`;
  return `${key} ✅ ${val}`;
}

async function globalSetup(): Promise<void> {
  loadEnvFile();

  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'API_URL',
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
  ];

  const missing: string[] = [];
  console.log('\n═══════════════════════════════════════════');
  console.log('  E2E Environment Summary');
  console.log('═══════════════════════════════════════════');
  for (const key of required) {
    const check = envCheck(key, key.includes('KEY') || key.includes('SECRET') || key.includes('PASSWORD'));
    console.log(`  ${check}`);
    if (!process.env[key]) missing.push(key);
  }

  const optional = ['E2E_STUDENT_A_EMAIL', 'E2E_STUDENT_A_PASSWORD', 'E2E_STUDENT_B_EMAIL', 'E2E_STUDENT_B_PASSWORD', 'CI'];
  console.log('');
  for (const key of optional) {
    const check = envCheck(key, key.includes('KEY') || key.includes('SECRET') || key.includes('PASSWORD'));
    if (process.env[key]) {
      console.log(`  ${check}`);
    } else {
      console.log(`  ${key} ⚠️  (will use default)`);
    }
  }

  if (missing.length > 0) {
    console.error(`\n  ❌ FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error(`  Create tests/e2e/.env from tests/e2e/.env.example\n`);
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase.from('recordings').select('id').limit(1);
    if (error) {
      console.error(`\n  ⚠️  Supabase connection test FAILED: ${error.message}`);
    } else {
      console.log(`\n  ✅ Supabase connection OK`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n  ⚠️  Supabase connection test threw: ${msg}`);
  }

  console.log('═══════════════════════════════════════════\n');
}

export default globalSetup;
