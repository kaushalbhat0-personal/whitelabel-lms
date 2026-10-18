-- Phase 7D: Certificate Automation

-- Extend certificates table with PDF & email tracking
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS pdf_path       TEXT,
  ADD COLUMN IF NOT EXISTS pdf_generated  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_sent     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at    TIMESTAMPTZ;

-- Certificate verification tokens (public, no auth required)
CREATE TABLE IF NOT EXISTS certificate_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id  UUID NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  token           VARCHAR(100) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at      TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ,
  verified_by_ip  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cert_verification_token ON certificate_verifications(token);
CREATE INDEX idx_cert_verification_cert ON certificate_verifications(certificate_id);
