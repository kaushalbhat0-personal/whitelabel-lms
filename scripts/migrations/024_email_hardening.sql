-- Phase 7.1b: Email Infrastructure Hardening
-- Resend Webhooks + Suppression List + Template Registry + Delivery Events

-- Email Delivery Events — webhook events from Resend (delivered, opened, clicked, bounced, complained)
CREATE TABLE IF NOT EXISTS email_delivery_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id    UUID REFERENCES email_logs(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL
    CHECK (event_type IN ('delivered', 'opened', 'clicked', 'bounced', 'complained')),
  payload         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_delivery_events_log ON email_delivery_events(email_log_id);
CREATE INDEX idx_email_delivery_events_type ON email_delivery_events(event_type);
CREATE INDEX idx_email_delivery_events_created ON email_delivery_events(created_at DESC);

-- Email Suppressions — when an email bounces repeatedly, skip future sends
CREATE TABLE IF NOT EXISTS email_suppressions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  reason          TEXT NOT NULL,
  email_log_id    UUID REFERENCES email_logs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_suppressions_email ON email_suppressions(email);

-- Email Templates — registry for all email templates
CREATE TABLE IF NOT EXISTS email_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  subject         TEXT NOT NULL,
  html_template   TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_templates_name ON email_templates(name);
CREATE INDEX idx_email_templates_active ON email_templates(is_active);
