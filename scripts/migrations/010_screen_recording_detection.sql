-- 012-screen-recording-detection.sql
-- Tables for screen recording detection, violation tracking, and risk scoring.

-- ────────────────────────────────────────────────────────────────
--  1. screen_recording_violations — every detection event logged here
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS screen_recording_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN (
    'recording',
    'live_session',
    'test'
  )),
  context_id UUID,
  detection_type TEXT NOT NULL CHECK (detection_type IN (
    'visibilitychange_hidden',
    'window_blur',
    'window_focus_lost',
    'printscreen_key',
    'devtools_open',
    'get_display_media',
    'multiple_displays'
  )),
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_srv_user ON screen_recording_violations(user_id);
CREATE INDEX idx_srv_context ON screen_recording_violations(context_type, context_id);
CREATE INDEX idx_srv_detection ON screen_recording_violations(detection_type);
CREATE INDEX idx_srv_created ON screen_recording_violations(created_at DESC);

-- ────────────────────────────────────────────────────────────────
--  2. violation_counters — per-user running counters (for risk score)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS violation_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN (
    'recording',
    'live_session',
    'test'
  )),
  total_violations INTEGER NOT NULL DEFAULT 0,
  visibilitychange_count INTEGER NOT NULL DEFAULT 0,
  blur_count INTEGER NOT NULL DEFAULT 0,
  focus_loss_count INTEGER NOT NULL DEFAULT 0,
  printscreen_count INTEGER NOT NULL DEFAULT 0,
  devtools_count INTEGER NOT NULL DEFAULT 0,
  display_media_count INTEGER NOT NULL DEFAULT 0,
  last_violation_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, context_type)
);

-- ────────────────────────────────────────────────────────────────
--  3. risk_scores — consolidated risk scoring per user
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  overall_score INTEGER NOT NULL DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 100),
  recording_score INTEGER NOT NULL DEFAULT 0 CHECK (recording_score >= 0 AND recording_score <= 100),
  live_session_score INTEGER NOT NULL DEFAULT 0 CHECK (live_session_score >= 0 AND live_session_score <= 100),
  test_score INTEGER NOT NULL DEFAULT 0 CHECK (test_score >= 0 AND test_score <= 100),
  total_violations INTEGER NOT NULL DEFAULT 0,
  violations_24h INTEGER NOT NULL DEFAULT 0,
  violations_7d INTEGER NOT NULL DEFAULT 0,
  last_violation_at TIMESTAMPTZ,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ────────────────────────────────────────────────────────────────
--  4. RLS policies
-- ────────────────────────────────────────────────────────────────
ALTER TABLE screen_recording_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE violation_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY;

-- Admins can read all violations
CREATE POLICY "Admins can read all screen recording violations"
  ON screen_recording_violations FOR SELECT
  USING (auth.role() = 'service_role' OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Service role can insert
CREATE POLICY "Service role can insert screen recording violations"
  ON screen_recording_violations FOR INSERT
  WITH CHECK (true);

-- Admins can read all counters
CREATE POLICY "Admins can read all violation counters"
  ON violation_counters FOR SELECT
  USING (auth.role() = 'service_role' OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Service role can upsert counters
CREATE POLICY "Service role can upsert violation counters"
  ON violation_counters FOR ALL
  WITH CHECK (true);

-- Admins can read all risk scores
CREATE POLICY "Admins can read all risk scores"
  ON risk_scores FOR SELECT
  USING (auth.role() = 'service_role' OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Service role can upsert risk scores
CREATE POLICY "Service role can upsert risk scores"
  ON risk_scores FOR ALL
  WITH CHECK (true);
