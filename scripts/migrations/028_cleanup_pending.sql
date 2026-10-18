-- Production Hardening: track failed Mux cleanup for orphaned asset reconciliation

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS cleanup_pending BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_recordings_cleanup_pending
  ON recordings(cleanup_pending)
  WHERE cleanup_pending = true;
