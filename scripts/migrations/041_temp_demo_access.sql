-- ============================================================================
-- Migration 041: Temporary demo access foundation (profiles.expires_at)
-- ============================================================================
-- Deployment-scoped capability for the sales-demo deployment only.
-- Adds a nullable expiry marker for per-prospect temporary demo accounts.
--
-- Semantics:
--   expires_at IS NULL  → normal permanent account (all existing rows stay NULL)
--   expires_at IS SET   → temporary account; authoritative marker for the
--                          expiry sweeper (forceLogoutUser + is_active=false +
--                          grace-period cleanup). Never identify temporary
--                          accounts by email/username pattern.
--
-- Safety:
--   - Nullable, DEFAULT NULL, no backfill, no seed data, no demo users.
--   - No tenant/organization columns. No RLS changes (040 default-deny kept).
--   - No DEMO_MODE branching. Client deployments are unaffected.
-- ============================================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL DEFAULT NULL;

-- Partial index for the sweeper lookup:
--   WHERE expires_at IS NOT NULL AND expires_at <= now() AND is_active = true
-- Partial so permanent accounts (NULL) never enter the index.
CREATE INDEX IF NOT EXISTS idx_profiles_expires_at_active
  ON public.profiles (expires_at)
  WHERE expires_at IS NOT NULL AND is_active = TRUE;
