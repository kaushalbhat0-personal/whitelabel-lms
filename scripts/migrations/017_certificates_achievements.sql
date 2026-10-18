-- Achievement Definitions
CREATE TABLE IF NOT EXISTS achievement_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(50) UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  icon_url    TEXT,
  criteria    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Student Achievements
CREATE TABLE IF NOT EXISTS student_achievements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id    UUID NOT NULL REFERENCES achievement_definitions(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  earned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, achievement_id)
);

CREATE INDEX idx_student_achievements_user ON student_achievements(user_id);

-- Certificates
CREATE TABLE IF NOT EXISTS certificates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  certificate_number TEXT UNIQUE,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata          JSONB DEFAULT '{}',

  UNIQUE (user_id, course_id)
);

CREATE INDEX idx_certificates_user ON certificates(user_id);

-- Seed default achievements
INSERT INTO achievement_definitions (key, name, description, criteria) VALUES
  ('first_video', 'First Steps', 'Watch your first video', '{"type": "video_count", "count": 1}'),
  ('module_complete', 'Module Master', 'Complete your first module', '{"type": "module_complete", "count": 1}'),
  ('course_complete', 'Course Graduate', 'Complete a course', '{"type": "course_complete", "count": 1}'),
  ('perfect_score', 'Perfect Score', 'Score 100% on a test', '{"type": "perfect_test", "count": 1}'),
  ('five_videos', 'Video Explorer', 'Watch 5 videos', '{"type": "video_count", "count": 5}')
ON CONFLICT (key) DO NOTHING;
