/**
 * Migration Schema Verification — Live DB vs Expected Migration State
 *
 * Authority: scripts/migrations/ is the single source of truth.
 * scripts/schema.sql is DEPRECATED reference-only and is NOT checked here.
 * This script queries live Supabase information_schema.columns and compares
 * against hard-coded expected columns for a subset of migrations (017–020).
 *
 * This is an intentionally narrow, non-fragile checker. It does NOT attempt
 * to parse all migrations dynamically — that would be fragile. Coverage is
 * limited to 8 representative tables; extend the `migrations` array as needed.
 * For full history, inspect scripts/migrations/ in order.
 *
 * Usage: node scripts/check-supabase-schema.js  (requires apps/api/.env)
 *
 * See also: CONFIG_OWNERSHIP.md (no tenant_id), docs/architecture.md
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), 'apps/api/.env');
const envText = fs.readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envText.split('\n').filter(Boolean).map((l) => {
    const [k, ...v] = l.split('=');
    return [k.trim(), v.join('=').trim()];
  })
);

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in .env');
  process.exit(0);
}

async function getColumns(tableName) {
  const qs = new URLSearchParams({
    select: 'column_name,data_type,is_nullable,column_default',
    table_name: `eq.${tableName}`,
    table_schema: 'eq.public',
    order: 'ordinal_position.asc',
  });
  const res = await fetch(`${url}/rest/v1/information_schema.columns?${qs}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: text.slice(0, 200) };
  }
  return await res.json();
}

async function main() {
  console.log('=== MIGRATION SCHEMA VERIFICATION ===\n');

  const migrations = [
    {
      file: '017-outbox.sql',
      table: 'outbox_messages',
      expected: ['id','message_type','payload','status','retry_count','max_retries','created_at','processed_at'],
    },
    {
      file: '018-batch-curriculum.sql',
      table: 'batch_recording_curriculum',
      expected: ['id','batch_id','content_id','content_type','category_name','module_name','sort_order','is_published','pdf_url','pdf_title','title_override','created_at','updated_at'],
    },
    {
      file: '019-progress-rules.sql',
      table: 'batch_curriculum_rules',
      expected: ['id','batch_id','category_name','rule_type','threshold','created_at','updated_at'],
    },
    {
      file: '019-progress-rules.sql',
      table: 'batch_curriculum_prerequisites',
      expected: ['id','batch_id','curriculum_id','prerequisite_id','created_at'],
    },
    {
      file: '019-progress-rules.sql',
      table: 'batch_curriculum_item_progress',
      expected: ['id','user_id','curriculum_id','completed','completed_at','created_at','updated_at'],
    },
    {
      file: '020-certificates-achievements.sql',
      table: 'achievement_definitions',
      expected: ['id','key','name','description','icon_url','criteria','created_at'],
    },
    {
      file: '020-certificates-achievements.sql',
      table: 'student_achievements',
      expected: ['id','user_id','achievement_id','batch_id','course_id','earned_at'],
    },
    {
      file: '020-certificates-achievements.sql',
      table: 'certificates',
      expected: ['id','user_id','course_id','batch_id','certificate_number','issued_at','metadata'],
    },
  ];

  let allCorrect = true;

  for (const m of migrations) {
    console.log(`${m.file} → ${m.table}`);
    const cols = await getColumns(m.table);

    if (cols.error) {
      console.log(`  ERROR: ${cols.error}\n`);
      allCorrect = false;
      continue;
    }

    if (!Array.isArray(cols) || cols.length === 0) {
      console.log('  TABLE NOT FOUND\n');
      allCorrect = false;
      continue;
    }

    const actualCols = cols.map(c => c.column_name);
    console.log(`  Columns (${actualCols.length}):`);
    for (const c of cols) {
      const expected = m.expected.includes(c.column_name);
      console.log(`    ${expected ? '✅' : '⚠️'} ${c.column_name.padEnd(30)} ${c.data_type} ${c.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'}${c.column_default ? ` default=${c.column_default}` : ''}`);
    }

    const missing = m.expected.filter(e => !actualCols.includes(e));
    if (missing.length > 0) {
      console.log(`\n  ❌ MISSING COLUMNS: ${missing.join(', ')}`);
      allCorrect = false;
    } else {
      console.log(`  ✅ All ${m.expected.length} expected columns present\n`);
    }
  }

  console.log('\n=== VERDICT ===');
  console.log(allCorrect ? '✅ All 8 migrations applied correctly in Supabase' : '❌ Some migrations have issues');
}

main().catch(console.error);
