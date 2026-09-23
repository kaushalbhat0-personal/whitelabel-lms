-- Phase 1: Batch-level category ordering
-- Adds category_sort_order to batch_recording_curriculum
-- category_sort_order = position of logical category within a batch (0,1,2...)
-- sort_order remains position of recording within category
-- Backfill preserves current alphabetical visible order using normalized category identity (trim, collapse whitespace, lower)

ALTER TABLE batch_recording_curriculum
ADD COLUMN IF NOT EXISTS category_sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill: per batch, rank distinct normalized categories alphabetically
-- Normalized key matches app: lower(trim(regexp_replace(category_name, '\s+', ' ', 'g')))
WITH distinct_cats AS (
  SELECT DISTINCT
    batch_id,
    lower(trim(regexp_replace(category_name, '\s+', ' ', 'g'))) AS norm
  FROM batch_recording_curriculum
),
ranked AS (
  SELECT
    batch_id,
    norm,
    dense_rank() OVER (PARTITION BY batch_id ORDER BY norm) - 1 AS rnk
  FROM distinct_cats
)
UPDATE batch_recording_curriculum AS b
SET category_sort_order = ranked.rnk
FROM ranked
WHERE b.batch_id = ranked.batch_id
  AND lower(trim(regexp_replace(b.category_name, '\s+', ' ', 'g'))) = ranked.norm;

-- Index for efficient ordered fetch per batch (category order then recording order)
CREATE INDEX IF NOT EXISTS idx_batch_curriculum_cat_order
  ON batch_recording_curriculum(batch_id, category_sort_order, sort_order);
