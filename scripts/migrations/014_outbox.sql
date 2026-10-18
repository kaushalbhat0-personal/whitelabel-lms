-- Outbox pattern for decoupled receipt/invoice generation
-- Payment commits first; receipt generation is queued asynchronously

CREATE TABLE IF NOT EXISTS outbox_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type  TEXT NOT NULL CHECK (message_type IN ('receipt', 'invoice')),
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count   INT NOT NULL DEFAULT 0,
  max_retries   INT NOT NULL DEFAULT 3,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX idx_outbox_status ON outbox_messages (status, created_at);
