/**
 * pnpm recordings:repair-batch-links
 *
 * Scans ALL recordings and reconstructs missing recording_batches entries.
 *
 * Strategy:
 *   1. Query batch_recording_curriculum for entries with content_type='recording'
 *      and a valid (non-null) content_id — these represent intended assignments.
 *   2. For each such content_id, check if recording_batches entries exist.
 *   3. If missing, insert recording_batches rows.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   node scripts/repair-batch-links.js
 *
 * Env:
 *   Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from apps/api/.env.
 */

const fs = require('fs');
const path = require('path');

// ── Bootstrap env ──────────────────────────────────────────────
const envPath = path.join(process.cwd(), 'apps/api/.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ apps/api/.env not found. Run this script from the repo root (lms-platform/).');
  process.exit(1);
}

const envText = fs.readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const [k, ...v] = l.split('=');
    return [k.trim(), v.join('=').trim()];
  }),
);

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in .env');
  process.exit(1);
}

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

// ── Helpers ────────────────────────────────────────────────────

async function api(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, { headers: HEADERS, ...options });
  if (!res.ok && !options.ignoreErrors) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res;
}

async function select(table, query) {
  const qs = new URLSearchParams(query);
  const res = await api(`${table}?${qs}`);
  return res.json();
}

async function upsertBatchLinks(rows) {
  if (rows.length === 0) return;
  await api('recording_batches', {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: {
      ...HEADERS,
      Prefer: 'resolution=merge-duplicate,return=minimal',
    },
  });
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('=== Recording Batch Link Repair ===\n');
  const startedAt = Date.now();

  // Step 1: Find ALL curriculum entries of type 'recording' with a valid content_id
  console.log('Step 1: Scanning batch_recording_curriculum for recording entries with content_id...');
  const curriculumEntries = await select('batch_recording_curriculum', {
    select: 'id,batch_id,content_id,category_name',
    content_type: 'eq.recording',
    content_id: 'not.is.null',
    limit: '10000',
  });

  console.log(`  Found ${curriculumEntries.length} curriculum entries with a linked recording.\n`);

  // Step 2: Group by recording (content_id)
  const assignmentMap = new Map();
  for (const entry of curriculumEntries) {
    const recId = entry.content_id;
    if (!assignmentMap.has(recId)) {
      assignmentMap.set(recId, { recordingId: recId, batchIds: [], curriculumIds: [] });
    }
    const record = assignmentMap.get(recId);
    record.batchIds.push(entry.batch_id);
    record.curriculumIds.push(entry.id);
  }

  // Step 3: For each recording, check if recording_batches exist
  const scanned = { total: assignmentMap.size, healthy: 0, repaired: 0, failed: 0, skippedNoCurriculum: 0 };
  const repairLog = [];

  for (const [recordingId, info] of assignmentMap) {
    const uniqueBatchIds = [...new Set(info.batchIds)];

    // Check existing recording_batches
    const existing = await select('recording_batches', {
      select: 'batch_id',
      recording_id: `eq.${recordingId}`,
      limit: '1000',
    });

    const existingBatchIds = new Set(existing.map((r) => r.batch_id));
    const missingBatchIds = uniqueBatchIds.filter((b) => !existingBatchIds.has(b));

    if (missingBatchIds.length === 0) {
      scanned.healthy++;
      continue;
    }

    // Insert missing batch links
    try {
      const rows = missingBatchIds.map((batchId) => ({
        recording_id: recordingId,
        batch_id: batchId,
      }));

      await upsertBatchLinks(rows);
      scanned.repaired++;
      repairLog.push({ recordingId, added: missingBatchIds.length, batches: missingBatchIds });
      console.log(`  ✅ Recording ${recordingId}: inserted ${missingBatchIds.length} missing batch link(s)`);
    } catch (err) {
      scanned.failed++;
      console.error(`  ❌ Recording ${recordingId}: FAILED — ${err.message}`);
    }
  }

  // Step 4: Find recordings that exist but have NO curriculum entries (can't repair)
  const allRecordings = await select('recordings', {
    select: 'id,title,status,created_at',
    limit: '10000',
  });

  for (const rec of allRecordings) {
    if (!assignmentMap.has(rec.id)) {
      // No curriculum entries for this recording — can't determine intended assignment
      continue;
    }
  }

  scanned.total = allRecordings.length;

  // Step 5: Summary
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log('\n═══════════════════════════════════════');
  console.log('           REPAIR SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`  Scanned:        ${scanned.total} recordings`);
  console.log(`  Already healthy: ${scanned.healthy} (have all batch links)`);
  console.log(`  Repaired:       ${scanned.repaired} (missing links restored)`);
  console.log(`  Failed:         ${scanned.failed} (errors during repair)`);
  console.log(`  No curriculum:  ${scanned.skippedNoCurriculum} (no curriculum entries — can't determine batches)`);
  console.log('───────────────────────────────────────');
  console.log(`  Duration: ${elapsed}s\n`);

  if (repairLog.length > 0) {
    console.log('Repair Details:');
    for (const entry of repairLog) {
      console.log(`  📹 ${entry.recordingId} → +${entry.added} recording_batches: ${entry.batches.join(', ')}`);
    }
    console.log('');
  }

  if (scanned.repaired > 0 || scanned.failed > 0) {
    console.log('⚠️  Repair completed. Some recordings were fixed.');
  } else if (scanned.healthy === scanned.total) {
    console.log('✅ All recordings are healthy — no repairs needed.');
  } else {
    console.log('ℹ️  No repairs possible — missing curriculum data.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
