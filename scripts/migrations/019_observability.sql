-- Phase 7A: Observability Platform

-- System Errors — backend exceptions, API failures, failed operations
CREATE TABLE IF NOT EXISTS system_errors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_type    VARCHAR(100) NOT NULL,          -- 'api_error', 'db_error', 'email_failed', 'upload_failed', 'certificate_failed', 'invoice_failed', 'receipt_failed', 'playback_failed', 'zoom_join_failed', 'frontend_crash'
  severity      VARCHAR(10) NOT NULL DEFAULT 'error',  -- 'debug', 'info', 'warn', 'error', 'critical'
  message       TEXT NOT NULL,
  stack_trace   TEXT,
  context       JSONB DEFAULT '{}',             -- request context: { userId, batchId, courseId, ... }
  -- Request context
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  url           TEXT,
  method        VARCHAR(10),
  status_code   INTEGER,
  user_agent    TEXT,
  ip_address    TEXT,
  -- Resolution
  resolved      BOOLEAN NOT NULL DEFAULT false,
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_errors_type ON system_errors(error_type);
CREATE INDEX idx_system_errors_severity ON system_errors(severity);
CREATE INDEX idx_system_errors_created ON system_errors(created_at DESC);
CREATE INDEX idx_system_errors_resolved ON system_errors(resolved);

-- System Events — non-error operational events
CREATE TABLE IF NOT EXISTS system_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    VARCHAR(100) NOT NULL,          -- 'email_sent', 'certificate_issued', 'invoice_generated', 'batch_assigned', 'course_duplicated'
  source        VARCHAR(50) NOT NULL,            -- 'api', 'worker', 'cron', 'frontend'
  severity      VARCHAR(10) NOT NULL DEFAULT 'info',
  message       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',             -- flexible payload
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_events_type ON system_events(event_type);
CREATE INDEX idx_system_events_source ON system_events(source);
CREATE INDEX idx_system_events_created ON system_events(created_at DESC);

-- Performance Metrics — backend + frontend latency tracking
CREATE TABLE IF NOT EXISTS performance_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name   VARCHAR(100) NOT NULL,          -- 'endpoint_latency', 'page_load_time', 'dashboard_load', 'video_page_load', 'api_latency'
  metric_value  DOUBLE PRECISION NOT NULL,       -- milliseconds
  unit          VARCHAR(20) NOT NULL DEFAULT 'ms',
  tags          JSONB DEFAULT '{}',             -- { endpoint: '/courses', method: 'GET', status: 200, userId: '...' }
  -- Common dimensions
  endpoint      VARCHAR(200),
  method        VARCHAR(10),
  status_code   INTEGER,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_perf_metrics_name ON performance_metrics(metric_name);
CREATE INDEX idx_perf_metrics_endpoint ON performance_metrics(endpoint);
CREATE INDEX idx_perf_metrics_created ON performance_metrics(created_at DESC);
