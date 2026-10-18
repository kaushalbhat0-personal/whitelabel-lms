-- 011-download-protection.sql
-- Tables for playback token audit, analytics events, and violation logging.

-- ────────────────────────────────────────────────────────────────
--  1. playback_violations — logged when suspicious patterns detected
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playback_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL,
  violation_type TEXT NOT NULL CHECK (violation_type IN (
    'excessive_seeking',
    'excessive_url_generation',
    'excessive_events',
    'revoked_token_use',
    'device_mismatch',
    'unauthorized_access'
  )),
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_playback_violations_user ON playback_violations(user_id);
CREATE INDEX idx_playback_violations_type ON playback_violations(violation_type);
CREATE INDEX idx_playback_violations_created ON playback_violations(created_at DESC);

-- ────────────────────────────────────────────────────────────────
--  2. playback_events — analytics event log (play, pause, seek, ended)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('play', 'pause', 'seek', 'ended', 'heartbeat')),
  position_seconds DOUBLE PRECISION,
  playback_session_id UUID,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_playback_events_user ON playback_events(user_id);
CREATE INDEX idx_playback_events_session ON playback_events(playback_session_id);
CREATE INDEX idx_playback_events_created ON playback_events(created_at DESC);
