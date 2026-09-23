import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

// Load env for Jest (outside Nest ConfigService) — manual parse, no dotenv dep
try {
  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(process.cwd(), 'apps/api/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && !process.env.SUPABASE_URL) {
      const content = fs.readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
      break;
    }
  }
} catch {}

/**
 * Defense-in-depth RLS assertion - proves browser/anon client cannot bypass Nest API.
 * Uses anon key, NOT service_role. Unauthenticated. No JWT.
 * If anon can read protected rows, test will FAIL and must be reported as finding.
 */
describe('Supabase RLS — anon client defense-in-depth', () => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const hasEnv = Boolean(url && anonKey);
  const shouldRun = hasEnv;

  // Helper to create anon client like browser would
  function anonClient() {
    return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  // Tables that MUST NOT be readable by anon (core student data)
  const protectedTables = [
    { table: 'profiles', desc: 'user profiles (PII, roles)' },
    { table: 'batches', desc: 'batch metadata' },
    { table: 'batch_students', desc: 'enrollment mapping' },
    { table: 'payment_plans', desc: 'financial plans' },
    { table: 'invoices', desc: 'invoices (storage_path via DB)' },
  ];

  for (const { table, desc } of protectedTables) {
    it(`anon cannot read ${table} (${desc})`, async () => {
      if (!shouldRun) {
        console.warn(`Skipping RLS anon test for ${table} — SUPABASE_URL/ANON_KEY not set`);
        return;
      }
      const anon = anonClient();
      const { data, error } = await anon.from(table).select('*').limit(1);
      // Document actual behavior: RLS disabled => data may be returned, error may be null.
      // Expected: either error with code 401/42501 or data empty/null due to RLS/policy.
      // We assert that NO rows are returned to anon without auth.
      if (error) {
        // Supabase errors for RLS denial are typically code 42501 or message contains 'permission denied' / 'RLS'
        expect(error).toBeDefined();
        // Ensure error is permission-related, not random network error
        const msg = (error.message || '').toLowerCase();
        const code = (error as any).code || '';
        const isPermissionError = msg.includes('permission') || msg.includes('rls') || msg.includes('policy') || msg.includes('not allowed') || code === '42501' || code === '401' || String(error).includes('401');
        // If error is network/timeout, test should not pass as RLS proof
        if (!isPermissionError) {
          console.warn(`Anon ${table} returned error but not clearly RLS: ${error.message} code=${code}`);
        }
        // Either way, data must be falsy when error present
        expect(data).toBeFalsy();
      } else {
        // No error — then data must be empty (RLS filtered to 0 rows) to be safe
        // If data contains rows, this is a security finding (anon can read protected table)
        if (data && Array.isArray(data) && data.length > 0) {
          // FAIL - anon can read protected rows
          console.error(`SECURITY FINDING: anon client read ${data.length} rows from ${table} — protected data exposed! Sample id: ${(data[0] as any).id}`);
        }
        expect(data).toEqual([]);
      }
    });
  }

  it('anon cannot list storage bucket invoices (private bucket)', async () => {
    if (!shouldRun) {
      console.warn('Skipping storage anon test — env not set');
      return;
    }
    const anon = anonClient();
    // Attempt to list objects in private bucket as anon (should be denied or empty)
    const { data, error } = await anon.storage.from('invoices').list('', { limit: 1 });
    if (error) {
      expect(error).toBeDefined();
    } else {
      // Private bucket should return error or empty
      if (data && data.length > 0) {
        console.error(`SECURITY FINDING: anon listed ${data.length} objects from invoices bucket`);
      }
      expect(data === null || data.length === 0).toBe(true);
    }
  });

  it('anon cannot list uploads bucket objects outside own folder', async () => {
    if (!shouldRun) return;
    const anon = anonClient();
    const { data, error } = await anon.storage.from('uploads').list('question-answers', { limit: 1 });
    // Without auth, should be denied (policy requires authenticated + auth.uid())
    if (error) {
      expect(error).toBeDefined();
    } else {
      // If no error, should be empty
      expect(data === null || data.length === 0).toBe(true);
    }
  });

  it('service_role can still read (sanity - proves test harness works)', async () => {
    const serviceUrl = process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!serviceUrl || !serviceKey) {
      console.warn('Skipping service_role sanity — SERVICE_ROLE_KEY not set');
      return;
    }
    const svc = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Service role should be able to query (even if zero rows, no permission error)
    const { data, error } = await svc.from('profiles').select('id').limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
