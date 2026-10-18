-- ============================================================================
-- Migration 005: Session-Batch M:N junction table
-- Run this AFTER 004-sessions.sql in Supabase SQL Editor
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Create junction table for M:N session <-> batch relationship
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_batch_mappings (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_sbm_session ON session_batch_mappings(session_id);
CREATE INDEX IF NOT EXISTS idx_sbm_batch ON session_batch_mappings(batch_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill existing rows from sessions.batch_id
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO session_batch_mappings (session_id, batch_id)
SELECT id, batch_id FROM sessions
WHERE batch_id IS NOT NULL
ON CONFLICT DO NOTHING;
