-- Phase 7.1: Email Delivery Center
-- Single source of truth for all email activity

CREATE TABLE IF NOT EXISTS email_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email     TEXT NOT NULL,
  subject             TEXT NOT NULL,
  template_name       TEXT,
  template_type       TEXT,
  provider            TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
  error_message       TEXT,
  metadata            JSONB DEFAULT '{}',
  retry_count         INTEGER NOT NULL DEFAULT 0,
  max_retries         INTEGER NOT NULL DEFAULT 5,
  last_retry_at       TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX idx_email_logs_status ON email_logs(status);
CREATE INDEX idx_email_logs_template ON email_logs(template_name);
CREATE INDEX idx_email_logs_sent_at ON email_logs(sent_at DESC);
CREATE INDEX idx_email_logs_created ON email_logs(created_at DESC);
