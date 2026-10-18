-- ⚠️ DANGER: This removes ALL session data for a clean slate.
-- Run this in the Supabase SQL Editor, then re-test scheduling.

DELETE FROM session_batch_mappings;
DELETE FROM webinar_attendance;
DELETE FROM sessions;
