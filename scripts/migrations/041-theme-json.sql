-- 041 — Runtime Theme Core (COMM-01B-A)
-- Adds business_config.theme_json JSONB for white-label brand theming.
-- Backward compatible: column is NULL-able, existing deployments unaffected.
-- Partial objects supported — missing fields fall back to DEFAULT_THEME_* constants.

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS theme_json JSONB;
