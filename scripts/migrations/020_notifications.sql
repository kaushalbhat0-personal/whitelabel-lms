-- Phase 7C: Notification Center

-- Announcements — admin-created messages targeting students
CREATE TABLE IF NOT EXISTS announcements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  target_type   VARCHAR(20) NOT NULL DEFAULT 'all',  -- 'all', 'course', 'batch'
  target_id     UUID,                                -- course_id or batch_id when target_type != 'all'
  created_by    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_published ON announcements(is_published, published_at DESC);
CREATE INDEX idx_announcements_target ON announcements(target_type, target_id);
CREATE INDEX idx_announcements_created_by ON announcements(created_by);

-- Notifications — per-user notification records
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  announcement_id UUID REFERENCES announcements(id) ON DELETE SET NULL,
  type            VARCHAR(50) NOT NULL DEFAULT 'announcement',  -- 'announcement', 'certificate_issued', 'batch_assigned', 'course_completed', 'achievement_earned'
  title           TEXT NOT NULL,
  message         TEXT,
  data            JSONB DEFAULT '{}',              -- { batchId, courseId, certificateId, achievementKey, ... }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- Notification Read Status
CREATE TABLE IF NOT EXISTS notification_reads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, notification_id)
);

CREATE INDEX idx_notification_reads_user ON notification_reads(user_id);
