-- 033-assessment-attempt-columns.sql
-- Assessment hardening: align test_attempts with the code's update patterns.
--
-- Context (verified during Phase 5 audit):
--   * test_attempts is updated with `updated_at` in 5 places
--     (evaluation.service.ts: autoGrade, submitReview x2, publishResults x2)
--     but the column does not exist -> every grade/publish/review 500s with
--     PGRST204 "Could not find the 'updated_at' column of 'test_attempts'".
--   * test_answers is inserted with `sort_order` in attempts.service.ts but the
--     column does not exist -> fresh attempt start 500s.
--
-- Fix: add updated_at (matches tests/question_bank which already have it).

ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Set a backfill so existing rows have a sane value.
UPDATE test_attempts SET updated_at = COALESCE(last_saved_at, submitted_at, started_at, NOW());
