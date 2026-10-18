-- ============================================================================
-- Migration 006: Make sessions.batch_id nullable (M:N moved to junction table)
-- Run this AFTER 005-session-batch-mappings.sql in Supabase SQL Editor
-- ============================================================================

ALTER TABLE sessions ALTER COLUMN batch_id DROP NOT NULL;

-- Keep the FK constraint, but allow NULL since M:N is via session_batch_mappings
-- When batch_id is NULL, the session is linked through the junction table only
