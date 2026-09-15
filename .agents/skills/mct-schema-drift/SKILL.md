---
name: mct-schema-drift
description: Database schema verification discipline — migrations are authoritative, scripts/schema.sql is stale, TS types lie. Includes the drift incidents already fixed. Use BEFORE writing any persistence/Supabase code.
---

# Skill: MCT LMS — Schema Drift Defense

## Purpose
Every serious production incident class in this repo's history started with code assuming schema that didn't exist. This skill makes verification mandatory.

## Facts
- **`scripts/schema.sql` is STALE/PARTIAL** (missing the entire assessment engine, provider column, etc.). Never authoritative.
- **Authoritative:** `scripts/migrations/*.sql` (004→035) applied to live Supabase + the live DB itself.
- **Verify live:** `node scripts/check-supabase-schema.js <table>` → prints column_name/data_type/is_nullable/column_default via PostgREST `information_schema.columns`. Read-only; uses apps/api/.env. For constraints/indexes, use the Supabase SQL editor or read-only REST queries.

## Incident register (already fixed — patterns to never repeat)
| Column/Table | Incident |
|---|---|
| `test_answers.sort_order` | attempts.service inserted a nonexistent column → P0 500 on every attempt start |
| `test_attempts.updated_at` | evaluation/publish/review wrote it before it existed → PGRST204 500s; added by migration 033 |
| `profiles.batch_id` | assumed by auth/batch logic; doesn't exist — membership lives in `batch_students` |
| `test_analytics_snapshots.created_at` vs `calculated_at` | analytics ordered by wrong timestamp → stale snapshots served (fixed 5A) |
| live session columns (`teacher_id`, attendance join/leave/duration fields, registrant personal_join_url) | migration 034 aligned CODE to existing DB instead of altering DB — the correct direction |
| `recordings.provider` | additive migration 035 with DEFAULT 'mux' + CHECK — deploy order: apply migration BEFORE deploying API |

## Rules
Before touching persistence code:
1. Read the relevant migration files for CHECK/NOT NULL/UNIQUE/FK definitions.
2. Run check-supabase-schema.js on every table you write to.
3. Confirm enum-ish values against CHECK constraints (statuses especially).
4. New columns = new migration file (`scripts/migrations/NNN-*.sql`, additive-first, rollback comment included) — never edit old migrations.
5. Deploy order: migrations first, then API deploy.
6. Verify one real INSERT/UPDATE against dev DB after writing the code.

## Common Failure Modes
- DTO with extra optional field silently sent to Supabase → PGRST204 at runtime only.
- Assuming TIMESTAMPTZ vs TEXT, INT4 vs NUMERIC (duration rounding bug in Mux webhook).
- Renaming a column in TS "for clarity" while DB keeps the old name.

## Verification
Any persistence change ships with: migration file + unit spec asserting written shape + live DB check output pasted into the phase report.

## Do Not
- Do not trust TypeScript interfaces as schema documentation.
- Do not run destructive SQL (DROP/ALTER TYPE) without explicit approval + rollback script.
