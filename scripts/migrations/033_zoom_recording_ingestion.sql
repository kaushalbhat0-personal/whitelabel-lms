-- 036-zoom-recording-ingestion-hardening.sql
-- RCCF Phase 8B/8G/8F/8H: make the Zoom -> upload_queue -> Bunny pipeline
-- idempotent, retryable and observable.
--
-- NOTES
--   * The upload_queue table itself exists in the live database but its DDL was
--     never captured in migration history (only in the stale scripts/schema.sql).
--     This migration documents and normalizes that state additively.
--   * ADDITIVE FIRST: no column is dropped or retyped; no existing value is mutated.
--
-- ROLLBACK (apply manually, only after confirming no NULL session_id rows exist):
--   DROP INDEX IF EXISTS uq_upload_queue_zoom_recording_file;
--   ALTER TABLE upload_queue DROP COLUMN IF EXISTS zoom_topic;
--   ALTER TABLE upload_queue DROP COLUMN IF EXISTS zoom_recording_file_id;
--   ALTER TABLE upload_queue DROP COLUMN IF EXISTS zoom_meeting_uuid;
--   ALTER TABLE upload_queue ALTER COLUMN session_id SET NOT NULL;  -- fails while NULLs exist
--
-- DEPLOY ORDER: apply THIS migration BEFORE deploying the API build that uses it.

-- ── 1. Unmatched Zoom events must be recordable as observable failures ──────
-- The webhook handler can receive recording.completed events whose webinar id
-- has no matching live_sessions row. Today the NOT NULL constraint makes that
-- INSERT fail silently (event lost). Allow NULL + explicit failed row instead.
ALTER TABLE upload_queue ALTER COLUMN session_id DROP NOT NULL;

-- ── 2. Zoom identity columns (idempotency keys) ─────────────────────────────
-- zoom_meeting_uuid      : payload.object.uuid        (unique per recording instance)
-- zoom_recording_file_id : payload.object.recording_files[n].id (unique per FILE)
-- zoom_topic             : payload.object.topic       (human title for the LMS recording)
ALTER TABLE upload_queue ADD COLUMN IF NOT EXISTS zoom_meeting_uuid text;
ALTER TABLE upload_queue ADD COLUMN IF NOT EXISTS zoom_recording_file_id text;
ALTER TABLE upload_queue ADD COLUMN IF NOT EXISTS zoom_topic text;

-- Hard backstop against duplicate ingestion of the same Zoom file:
-- a second INSERT with an already-known file id must fail (23505) rather than
-- enqueue duplicate work. Partial index keeps manual rows (NULL) unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upload_queue_zoom_recording_file
  ON upload_queue (zoom_recording_file_id)
  WHERE zoom_recording_file_id IS NOT NULL;

-- ── 3. Normalize the queue status index (was defined only in stale schema.sql) ──
CREATE INDEX IF NOT EXISTS idx_upload_queue_status ON upload_queue (status);
