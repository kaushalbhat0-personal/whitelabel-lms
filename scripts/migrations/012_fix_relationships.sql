-- ──────────────────────────────────────────────────────────────
-- 014: Fix Supabase FK relationships for Assessment Engine
-- ──────────────────────────────────────────────────────────────

-- Add FK from test_answers.question_id to question_bank.id
-- This enables Supabase nested selects like:
--   test_answers(question_bank(...))
ALTER TABLE test_answers
  ADD CONSTRAINT fk_test_answers_question_bank
  FOREIGN KEY (question_id)
  REFERENCES question_bank(id)
  NOT VALID;  -- skip validation for existing data

-- Validate existing data (will fail if any orphan rows exist)
ALTER TABLE test_answers
  VALIDATE CONSTRAINT fk_test_answers_question_bank;
