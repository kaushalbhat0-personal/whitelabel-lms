-- 010-join-security.sql
-- Adds join_tokens (single-use) + join_attempts (audit trail) tables
-- for Zoom webinar join security.

-- ────────────────────────────────────────────────────────────────
--  1. join_tokens — single-use tokens bound to user + session
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS join_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_join_tokens_token ON join_tokens(token);
CREATE INDEX idx_join_tokens_session_user ON join_tokens(session_id, user_id);

-- ────────────────────────────────────────────────────────────────
--  2. join_attempts — audit log for every join request
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS join_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_id UUID REFERENCES join_tokens(id),
  ip_address TEXT,
  user_agent TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('granted', 'rejected_expired', 'rejected_reused', 'rejected_not_live', 'rejected_not_enrolled', 'rejected_duplicate')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_join_attempts_session ON join_attempts(session_id);
CREATE INDEX idx_join_attempts_user ON join_attempts(user_id);

-- ────────────────────────────────────────────────────────────────
--  3. Add token_revoked_at to live_sessions for bulk revocation
-- ────────────────────────────────────────────────────────────────
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS join_tokens_revoked_since TIMESTAMPTZ;
