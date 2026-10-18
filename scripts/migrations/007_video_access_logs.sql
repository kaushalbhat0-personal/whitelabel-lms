-- Tracks every signed playback URL generation for audit trail + session tracking.
-- Each row = one unique playback session (60-second window).

CREATE TABLE IF NOT EXISTS video_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  url_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_access_logs_user ON video_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_access_logs_session ON video_access_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_video_access_logs_recording ON video_access_logs(recording_id);
