-- Production Hardening: retry tracking for failed Mux cleanup

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS cleanup_failed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_recordings_cleanup_failed
  ON recordings(cleanup_failed)
  WHERE cleanup_failed = true;
