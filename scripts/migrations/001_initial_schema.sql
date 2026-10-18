-- ============================================================================
-- Migration 001: Initial Schema (Canonical Base)
-- Derived from scripts/schema.sql §2 (authoritative base before 004)
-- This is the single authoritative base for fresh Supabase provisioning.
-- Run this first, then 002_sessions.sql → 039_theme_json.sql
-- Idempotent: all CREATEs are IF NOT EXISTS, safe to re-run
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────────
-- Core: business_config (single-row, singleton index)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  address_line_1 TEXT NOT NULL,
  address_line_2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'India',
  gstin TEXT,
  pan TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  logo_url TEXT,
  signature_url TEXT,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  receipt_prefix TEXT NOT NULL DEFAULT 'RCP',
  current_financial_year TEXT NOT NULL,
  next_invoice_number INTEGER NOT NULL DEFAULT 1,
  next_receipt_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_config_singleton ON business_config ((TRUE));

-- ────────────────────────────────────────────────────────────────────────────
-- Auth: profiles (linked to Supabase auth.users)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  zoom_user_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- ────────────────────────────────────────────────────────────────────────────
-- Courses & Batches
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schedule_type TEXT CHECK (schedule_type IN ('weekday', 'weekend', 'custom')),
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_course ON batches(course_id);
CREATE INDEX IF NOT EXISTS idx_batches_active ON batches(is_active);

CREATE TABLE IF NOT EXISTS batch_students (
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (batch_id, user_id)
);
CREATE TABLE IF NOT EXISTS batch_teachers (
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (batch_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_students_user ON batch_students(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_teachers_user ON batch_teachers(user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Legacy sessions (pre-canonical live_sessions) + webinar_attendance
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  zoom_meeting_id TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  is_live BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_batch ON sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_live ON sessions(is_live) WHERE is_live = TRUE;

CREATE TABLE IF NOT EXISTS session_batch_mappings (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_sbm_session ON session_batch_mappings(session_id);
CREATE INDEX IF NOT EXISTS idx_sbm_batch ON session_batch_mappings(batch_id);

CREATE TABLE IF NOT EXISTS webinar_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_webinar_attendance_session ON webinar_attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_webinar_attendance_user ON webinar_attendance(user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Finance: payment_plans, payment_installments, payments
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  total_amount NUMERIC(12, 2) NOT NULL,
  installment_count INTEGER NOT NULL CHECK (installment_count >= 1),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_plans_student ON payment_plans(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_course ON payment_plans(course_id);

CREATE TABLE IF NOT EXISTS payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_plan_id UUID NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'waived')),
  paid_at TIMESTAMPTZ,
  payment_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_plan_id, installment_number)
);
CREATE INDEX IF NOT EXISTS idx_installments_plan ON payment_installments(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_installments_status ON payment_installments(status);
CREATE INDEX IF NOT EXISTS idx_installments_due ON payment_installments(due_date);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  payment_plan_id UUID REFERENCES payment_plans(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES payment_installments(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other')),
  transaction_id TEXT,
  paid_on DATE NOT NULL,
  notes TEXT,
  is_full_payment BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_course ON payments(course_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_on);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_installment_payment') THEN
    ALTER TABLE payment_installments ADD CONSTRAINT fk_installment_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Invoices & Receipts
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  gst_applicable BOOLEAN NOT NULL DEFAULT TRUE,
  issued_on DATE NOT NULL,
  pdf_url TEXT,
  email_sent_at TIMESTAMPTZ,
  email_sent_to TEXT,
  generated_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  installment_id UUID REFERENCES payment_installments(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  issued_on DATE NOT NULL,
  pdf_url TEXT,
  email_sent_at TIMESTAMPTZ,
  email_sent_to TEXT,
  generated_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(receipt_number);

-- ────────────────────────────────────────────────────────────────────────────
-- Live Sessions (canonical) + registrants + attendance
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  agenda TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  zoom_webinar_id TEXT,
  zoom_webinar_join_url TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_teacher ON live_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_start ON live_sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status);

CREATE TABLE IF NOT EXISTS session_batches (
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, batch_id)
);
CREATE TABLE IF NOT EXISTS session_registrants (
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  zoom_registrant_id TEXT,
  personal_join_url TEXT,
  PRIMARY KEY (session_id, user_id)
);
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  join_time TIMESTAMPTZ,
  leave_time TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  marked_manually BOOLEAN NOT NULL DEFAULT FALSE,
  marked_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Topics + Recordings (canonical, with provider) + batches
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES live_sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'mux' CHECK (provider IN ('mux', 'bunny')),
  mux_asset_id TEXT,
  mux_playback_id TEXT,
  mux_upload_id TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  cleanup_pending BOOLEAN NOT NULL DEFAULT false,
  retry_count INTEGER NOT NULL DEFAULT 0,
  cleanup_failed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_topic ON recordings(topic_id);

CREATE TABLE IF NOT EXISTS recording_batches (
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recording_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_recording_batches_recording ON recording_batches(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_batches_batch ON recording_batches(batch_id);

-- Legacy video tables required for migration 007 to execute on fresh DB
-- These existed before 007 and are dropped by 007; they must exist for 007's INSERT ... SELECT to not fail with "relation does not exist"
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  mux_asset_id TEXT,
  mux_playback_id TEXT,
  mux_upload_id TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS video_batches (
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, batch_id)
);

CREATE TABLE IF NOT EXISTS video_progress (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  watched_seconds INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, video_id)
);
CREATE TABLE IF NOT EXISTS video_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_video_views_user ON video_views(user_id);
CREATE INDEX IF NOT EXISTS idx_video_views_video ON video_views(video_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Assessments: tests / questions / attempts
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL,
  total_marks INTEGER NOT NULL,
  passing_marks INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS test_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'short_answer', 'long_answer')),
  options JSONB,
  correct_answer TEXT,
  marks INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  score INTEGER,
  answers JSONB
);

-- ────────────────────────────────────────────────────────────────────────────
-- Upload queue + bulk jobs
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  zoom_download_url TEXT NOT NULL,
  zoom_url_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed', 'expired')),
  mux_asset_id TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_queue_status ON upload_queue(status);

CREATE TABLE IF NOT EXISTS bulk_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN ('students', 'invoices', 'receipts')),
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  file_name TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  failures JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_user ON bulk_upload_jobs(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_type ON bulk_upload_jobs(job_type);

-- ────────────────────────────────────────────────────────────────────────────
-- Functions & Triggers (base)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_absent_for_session(p_session_id UUID) RETURNS void AS $$
BEGIN
  INSERT INTO attendance (session_id, user_id, status)
  SELECT sr.session_id, sr.user_id, 'absent'
  FROM session_registrants sr
  WHERE sr.session_id = p_session_id
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.session_id = sr.session_id AND a.user_id = sr.user_id
    );
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_business_config BEFORE UPDATE ON business_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_courses BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_batches BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_payment_plans BEFORE UPDATE ON payment_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_live_sessions BEFORE UPDATE ON live_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_recordings BEFORE UPDATE ON recordings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_tests BEFORE UPDATE ON tests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_attendance BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_upload_queue BEFORE UPDATE ON upload_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_sessions BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
