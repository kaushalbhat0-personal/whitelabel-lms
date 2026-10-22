-- ============================================================================
-- Migration 042: Provider-neutral live-session persistence
-- ============================================================================
-- Phase RCCF-LIVE-GMEET-03. The LiveProvider seam (GMEET-02) lets the API
-- select zoom | google-meet | none, but live_sessions still stores only
-- Zoom-shaped columns (zoom_webinar_id, zoom_webinar_join_url) and
-- session_registrants only zoom_registrant_id. This migration adds the
-- canonical provider-neutral columns that any LiveProvider implementation
-- (Zoom today, Google Meet in GMEET-04) writes through.
--
-- Semantics:
--   provider IS 'zoom'        → row created via ZoomLiveProvider.
--   provider IS 'google-meet' → row created via the future Meet adapter.
--   'none' is intentionally NOT an allowed row value: LIVE_PROVIDER=none
--     deployments reject live creation with 503 before any insert, so a
--     session row with provider='none' would be contradictory.
--   Future providers (if any) relax the CHECK in their own migration,
--     same pattern as recordings.provider (migration 032).
--
-- Compatibility:
--   - zoom_* columns are NOT touched: LiveSessionsService dual-writes them
--     as mirrors during this transition; a later major drops them.
--   - Backfill maps existing Zoom rows 1:1; zoom_registrant_id has always
--     been written as NULL by the service, so the registrant backfill is a
--     no-op safeguard, not invented data.
--   - No tenant/organization columns. No RLS changes (040 default-deny on
--     both tables covers the new columns; service-role bypasses RLS).
--   - provider_start_url backfills to NULL: the Zoom start_url was never
--     persisted before this migration. Dual-write populates it going forward.
-- ============================================================================

-- ── live_sessions: canonical provider columns ──────────────────────────
ALTER TABLE public.live_sessions
ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'zoom';

ALTER TABLE public.live_sessions
ADD COLUMN IF NOT EXISTS provider_session_id TEXT;

ALTER TABLE public.live_sessions
ADD COLUMN IF NOT EXISTS provider_join_url TEXT;

ALTER TABLE public.live_sessions
ADD COLUMN IF NOT EXISTS provider_start_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_sessions_provider_check'
  ) THEN
    ALTER TABLE public.live_sessions
    ADD CONSTRAINT live_sessions_provider_check
    CHECK (provider IN ('zoom', 'google-meet'));
  END IF;
END
$$;

-- Backfill existing Zoom rows (1:1, no invented values).
UPDATE public.live_sessions
SET provider = 'zoom',
    provider_session_id = zoom_webinar_id,
    provider_join_url = zoom_webinar_join_url
WHERE zoom_webinar_id IS NOT NULL
  AND provider_session_id IS NULL;

-- Provider filter for dashboards/admin lists.
CREATE INDEX IF NOT EXISTS idx_live_sessions_provider
  ON public.live_sessions (provider);

-- ── session_registrants: canonical provider registrant id ───────────────
ALTER TABLE public.session_registrants
ADD COLUMN IF NOT EXISTS provider_registrant_id TEXT;

-- No-op safeguard today (service has always written zoom_registrant_id NULL);
-- keeps future providers consistent without inventing data.
UPDATE public.session_registrants
SET provider_registrant_id = zoom_registrant_id
WHERE zoom_registrant_id IS NOT NULL
  AND provider_registrant_id IS NULL;
