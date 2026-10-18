-- 034-live-sessions-alignment.sql
-- Phase 6B: Live Classes migration support objects.
--
-- Strategy: align code to the existing live DB (no destructive column changes).
-- This migration adds only the objects the codebase genuinely needs:
--   1. Index on join_tokens(token) — token lookup in getStudentJoinUrl
--   2. Index on join_attempts(session_id) — join-audit admin query
--   3. RPC mark_absent_for_session — used by the Zoom webhook webinar.ended handler
--
-- Columns already present in live DB (code aligned to these):
--   live_sessions.teacher_id, zoom_webinar_id, zoom_webinar_join_url, status
--   session_registrants.personal_join_url, zoom_registrant_id
--   attendance.join_time, leave_time, duration_seconds, marked_manually, marked_by

CREATE INDEX IF NOT EXISTS idx_join_tokens_token ON join_tokens(token);
CREATE INDEX IF NOT EXISTS idx_join_attempts_session ON join_attempts(session_id);

-- Mark all enrolled students who have no attendance record as absent.
DROP FUNCTION IF EXISTS mark_absent_for_session(UUID);
CREATE OR REPLACE FUNCTION mark_absent_for_session(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO attendance (session_id, user_id, status)
  SELECT s.session_id, s.user_id, 'absent'
  FROM session_registrants s
  WHERE s.session_id = p_session_id
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.session_id = s.session_id AND a.user_id = s.user_id
    )
  ON CONFLICT (session_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
