-- Integrity Hardening: protect student progress from cascade deletes

-- 1. Progress: RESTRICT delete instead of CASCADE
--    Student progress must not be silently destroyed when curriculum changes
ALTER TABLE batch_curriculum_item_progress
  DROP CONSTRAINT IF EXISTS batch_curriculum_item_progress_curriculum_id_fkey,
  ADD CONSTRAINT batch_curriculum_item_progress_curriculum_id_fkey
    FOREIGN KEY (curriculum_id) REFERENCES batch_recording_curriculum(id)
    ON DELETE RESTRICT;

-- 2. Prerequisites: CASCADE is fine (cleanup), but add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_curriculum_prereqs_prerequisite
  ON batch_curriculum_prerequisites(prerequisite_id);

-- 3. Add orphan detection indexes
CREATE INDEX IF NOT EXISTS idx_batch_curriculum_content
  ON batch_recording_curriculum(content_type, content_id);
