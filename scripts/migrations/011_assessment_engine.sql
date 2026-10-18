-- 013-assessment-engine.sql
-- Complete Assessment Engine: tests, questions, attempts, evaluation, results, analytics

-- ──────────────────────────────────────────────────────────────
-- 1. EXTEND question_type enum on test_questions
-- ──────────────────────────────────────────────────────────────
ALTER TABLE test_questions DROP CONSTRAINT IF EXISTS test_questions_question_type_check;
ALTER TABLE test_questions ADD CONSTRAINT test_questions_question_type_check
  CHECK (question_type IN (
    'single_choice', 'multiple_choice', 'true_false',
    'numerical', 'short_answer', 'long_answer',
    'image_upload', 'image_based'
  ));

-- ──────────────────────────────────────────────────────────────
-- 2. EXTEND tests — add new columns
-- ──────────────────────────────────────────────────────────────
ALTER TABLE tests ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS show_result_immediately BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS negative_marking BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS negative_per_question DOUBLE PRECISION DEFAULT 0.25;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS instructions TEXT;

ALTER TABLE tests DROP CONSTRAINT IF EXISTS tests_status_check;
ALTER TABLE tests ADD CONSTRAINT tests_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'active', 'closed', 'archived'));

-- ──────────────────────────────────────────────────────────────
-- 3. EXTEND test_questions — add new columns
-- ──────────────────────────────────────────────────────────────
ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium'
  CHECK (difficulty IN ('easy', 'medium', 'hard'));
ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS section_id UUID;
ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS negative_mark DOUBLE PRECISION DEFAULT 0;
ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS is_compulsory BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS explanation TEXT;

-- ──────────────────────────────────────────────────────────────
-- 4. test_sections — group questions within a test
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_sections_test ON test_sections(test_id);

-- ──────────────────────────────────────────────────────────────
-- 5. question_bank — reusable questions independent of any test
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN (
    'single_choice', 'multiple_choice', 'true_false',
    'numerical', 'short_answer', 'long_answer',
    'image_upload', 'image_based'
  )),
  options JSONB,
  correct_answer TEXT,
  explanation TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  image_url TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_question_bank_topic ON question_bank(topic_id);
CREATE INDEX idx_question_bank_difficulty ON question_bank(difficulty);
CREATE INDEX idx_question_bank_type ON question_bank(question_type);

-- ──────────────────────────────────────────────────────────────
-- 6. test_question_bank — link reusable questions to a test
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_bank_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  marks INTEGER NOT NULL DEFAULT 1,
  negative_mark DOUBLE PRECISION DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  section_id UUID REFERENCES test_sections(id) ON DELETE SET NULL,
  is_compulsory BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(test_id, question_bank_id)
);

CREATE INDEX idx_tqb_test ON test_question_bank(test_id);
CREATE INDEX idx_tqb_section ON test_question_bank(section_id);

-- ──────────────────────────────────────────────────────────────
-- 7. test_batches — which batches a test is assigned to
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  UNIQUE(test_id, batch_id)
);

CREATE INDEX idx_test_batches_test ON test_batches(test_id);
CREATE INDEX idx_test_batches_batch ON test_batches(batch_id);

-- ──────────────────────────────────────────────────────────────
-- 8. EXTEND test_attempts — add status tracking, resume support
-- ──────────────────────────────────────────────────────────────
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_progress'
  CHECK (status IN ('in_progress', 'submitted', 'evaluated', 'partially_evaluated', 'published'));
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS current_question_index INTEGER DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS time_remaining_seconds INTEGER;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMPTZ;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS obtained_marks DOUBLE PRECISION DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION;

-- ──────────────────────────────────────────────────────────────
-- 9. test_answers — individual answer records per question
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  question_type TEXT NOT NULL,
  answer JSONB,
  marks_awarded DOUBLE PRECISION,
  marks_possible DOUBLE PRECISION NOT NULL DEFAULT 1,
  is_correct BOOLEAN,
  is_manual_review BOOLEAN NOT NULL DEFAULT false,
  feedback TEXT,
  evaluated_by UUID REFERENCES profiles(id),
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX idx_test_answers_attempt ON test_answers(attempt_id);
CREATE INDEX idx_test_answers_evaluated ON test_answers(is_manual_review, evaluated_at NULLS FIRST);

-- ──────────────────────────────────────────────────────────────
-- 10. test_review_queue — manual grading queue for teachers
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  answer_id UUID NOT NULL REFERENCES test_answers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'reviewed')),
  assigned_to UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX idx_review_queue_status ON test_review_queue(status);
CREATE INDEX idx_review_queue_assigned ON test_review_queue(assigned_to);

-- ──────────────────────────────────────────────────────────────
-- 11. test_results — published results per attempt
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL UNIQUE REFERENCES test_attempts(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  total_marks DOUBLE PRECISION NOT NULL,
  obtained_marks DOUBLE PRECISION NOT NULL,
  percentage DOUBLE PRECISION NOT NULL,
  rank INTEGER,
  total_attempts INTEGER NOT NULL DEFAULT 1,
  accuracy DOUBLE PRECISION,
  topic_analysis JSONB,
  question_analysis JSONB,
  teacher_feedback TEXT,
  passed BOOLEAN NOT NULL DEFAULT false,
  duration_seconds INTEGER,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_results_test ON test_results(test_id);
CREATE INDEX idx_test_results_user ON test_results(user_id);

-- ──────────────────────────────────────────────────────────────
-- 12. test_analytics_snapshots — periodic analytics cache for admin
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  average_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  highest_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  lowest_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  median_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  pass_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_accuracy DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_duration_seconds DOUBLE PRECISION,
  question_performance JSONB,
  topic_performance JSONB,
  batch_performance JSONB,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(test_id, calculated_at)
);

CREATE INDEX idx_analytics_test ON test_analytics_snapshots(test_id);

-- ──────────────────────────────────────────────────────────────
-- 13. RLS policies
-- ──────────────────────────────────────────────────────────────
ALTER TABLE test_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (NestJS bypasses RLS with service_role)
CREATE POLICY "Service role full access on test_sections"
  ON test_sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on question_bank"
  ON question_bank FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on test_question_bank"
  ON test_question_bank FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on test_batches"
  ON test_batches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on test_answers"
  ON test_answers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on test_review_queue"
  ON test_review_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on test_results"
  ON test_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on test_analytics_snapshots"
  ON test_analytics_snapshots FOR ALL USING (true) WITH CHECK (true);
