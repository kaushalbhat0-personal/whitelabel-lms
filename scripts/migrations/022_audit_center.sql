-- Phase 7E: Audit Center

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        VARCHAR(100) NOT NULL,           -- 'created', 'updated', 'deleted', 'published', 'assigned', 'generated', 'issued'
  entity_type   VARCHAR(50) NOT NULL,            -- 'course', 'batch', 'recording', 'payment', 'test', 'certificate', 'announcement'
  entity_id     UUID,
  actor_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role    VARCHAR(20),                     -- 'admin', 'teacher', 'system'
  changes       JSONB DEFAULT '{}',              -- { before: {...}, after: {...} }
  metadata      JSONB DEFAULT '{}',              -- extra context
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
