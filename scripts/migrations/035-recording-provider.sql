-- Phase 7B: recording-level video provider discriminator (staged Mux -> Bunny migration)
--
-- SAFETY:
--   * Purely additive. No columns dropped, no data rewritten, no Mux assets touched.
--   * Every existing row defaults to provider='mux' (all current recordings are Mux),
--     so existing Mux playback behaviour is unchanged.
--   * The mux_asset_id / mux_playback_id / mux_upload_id columns remain the storage
--     slots for provider identifiers. From Phase 7B onwards their interpretation is
--     keyed by recordings.provider (they are provider-generic despite historical
--     names); physical rename is deferred to the future Mux-retirement phase.
--
-- Rollback: ALTER TABLE public.recordings DROP COLUMN IF EXISTS provider;
-- (safe — no other object depends on it)

ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'mux';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recordings_provider_check'
      AND conrelid = 'public.recordings'::regclass
  ) THEN
    ALTER TABLE public.recordings
      ADD CONSTRAINT recordings_provider_check
      CHECK (provider IN ('mux', 'bunny'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recordings_provider ON public.recordings(provider);
