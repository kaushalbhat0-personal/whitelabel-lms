-- Module Completion Rules
-- Each category in a batch curriculum can have a completion rule.

CREATE TABLE IF NOT EXISTS batch_curriculum_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  rule_type     VARCHAR(20) NOT NULL DEFAULT 'all_items',
    -- 'all_items', 'all_recordings', 'pass_tests', 'percentage', 'any_one'
  threshold     INTEGER, -- for 'percentage': 0-100; for others: null
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (batch_id, category_name)
);

-- Prerequisites: a curriculum item that must be completed before another
CREATE TABLE IF NOT EXISTS batch_curriculum_prerequisites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  curriculum_id   UUID NOT NULL REFERENCES batch_recording_curriculum(id) ON DELETE CASCADE,
  prerequisite_id UUID NOT NULL REFERENCES batch_recording_curriculum(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (curriculum_id, prerequisite_id),
  CHECK (curriculum_id != prerequisite_id)
);

-- Student item progress (supplements video_progress/test_attempts for non-recording/test types)
CREATE TABLE IF NOT EXISTS batch_curriculum_item_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  curriculum_id   UUID NOT NULL REFERENCES batch_recording_curriculum(id) ON DELETE CASCADE,
  completed       BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, curriculum_id)
);

CREATE INDEX idx_curriculum_rules_batch ON batch_curriculum_rules(batch_id);
CREATE INDEX idx_curriculum_prereqs_curriculum ON batch_curriculum_prerequisites(curriculum_id);
CREATE INDEX idx_curriculum_progress_user ON batch_curriculum_item_progress(user_id);
CREATE INDEX idx_curriculum_progress_curriculum ON batch_curriculum_item_progress(curriculum_id);
