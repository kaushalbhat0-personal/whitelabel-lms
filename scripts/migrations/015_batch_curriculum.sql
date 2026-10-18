-- Batch Recording Curriculum (polymorphic)
-- Each batch can have its own curriculum: ordered categories of content items.
-- A content item can appear in multiple batches with different positions/categories.
-- Content types: recording, test, session, pdf

CREATE TABLE IF NOT EXISTS batch_recording_curriculum (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  content_id    UUID, -- polymorphic reference: recordings(id), tests(id), live_sessions(id)
  content_type  VARCHAR(20) NOT NULL DEFAULT 'recording',
  category_name TEXT NOT NULL DEFAULT 'General',
  module_name   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT true,
  -- PDF-specific fields (when content_type = 'pdf')
  pdf_url       TEXT,
  pdf_title     TEXT,
  -- Optional display name override
  title_override TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (batch_id, content_id, content_type)
);

CREATE INDEX idx_batch_curriculum_batch ON batch_recording_curriculum(batch_id);
CREATE INDEX idx_batch_curriculum_ordering ON batch_recording_curriculum(batch_id, category_name, sort_order);
