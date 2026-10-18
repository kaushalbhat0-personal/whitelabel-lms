-- ============================================================================
-- Migration 007: Consolidate 'videos' data into 'recordings', drop old tables
-- Run this AFTER 006-drop-sessions-batch-not-null.sql
-- BACKUP YOUR DATABASE BEFORE RUNNING
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add missing columns to recordings (mirrors videos schema)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS mux_upload_id TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_recordings_topic ON recordings(topic_id);
CREATE INDEX IF NOT EXISTS idx_recordings_sort ON recordings(sort_order);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Migrate all videos data into recordings (same UUIDs for FK compatibility)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO recordings (
  id, title, description, topic_id,
  mux_asset_id, mux_playback_id, mux_upload_id,
  duration_seconds, status, sort_order,
  created_at, updated_at
)
SELECT
  id, title, description, topic_id,
  mux_asset_id, mux_playback_id, mux_upload_id,
  duration_seconds, status, sort_order,
  created_at, updated_at
FROM videos;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Migrate batch assignments from old junction to new one
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO recording_batches (recording_id, batch_id)
SELECT video_id, batch_id FROM video_batches
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_recording_batches_recording ON recording_batches(recording_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Drop old tables (FK constraints auto-dropped via CASCADE)
-- ────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS video_batches CASCADE;
DROP TABLE IF EXISTS videos CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Re-add FK constraints on video_progress and video_views pointing to recordings
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE video_progress
  ADD CONSTRAINT video_progress_recording_id_fkey
  FOREIGN KEY (video_id) REFERENCES recordings(id) ON DELETE CASCADE;

ALTER TABLE video_views
  ADD CONSTRAINT video_views_recording_id_fkey
  FOREIGN KEY (video_id) REFERENCES recordings(id) ON DELETE CASCADE;

COMMIT;
