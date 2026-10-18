-- ============================================================================
-- Migration 004: Sessions & Webinar Attendance
-- Run this in Supabase SQL Editor (idempotent — safe to run multiple times)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. sessions — live trading sessions linked to a batch
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2. webinar_attendance — per-user attendance for each session
-- ────────────────────────────────────────────────────────────────────────────

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
-- 3. Trigger: auto-update updated_at on sessions
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_updated_at_sessions ON sessions;
CREATE TRIGGER set_updated_at_sessions
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
