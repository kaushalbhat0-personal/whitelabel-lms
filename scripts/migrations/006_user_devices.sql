-- Device fingerprinting + login alerts
-- Tracks every device a user logs in from for security visibility.

CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  fingerprint_hash TEXT NOT NULL,
  browser TEXT,
  os TEXT,
  screen_resolution TEXT,
  timezone TEXT,
  language TEXT,
  ip_address TEXT,
  last_ip_address TEXT,
  user_agent TEXT,
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_hash ON user_devices(fingerprint_hash);

CREATE TABLE IF NOT EXISTS login_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES user_devices(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('new_device', 'new_ip', 'unusual_time', 'suspicious')),
  ip_address TEXT,
  user_agent TEXT,
  details JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_alerts_user_id ON login_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_login_alerts_unread ON login_alerts(user_id, is_read) WHERE NOT is_read;
