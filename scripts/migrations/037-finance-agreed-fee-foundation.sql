-- ============================================================
-- Migration 037: Finance Agreed Fee Foundation (P1)
-- Confirmed model: LMS access independent of finance;
-- Standard Course Fee -> Discount -> Final Agreed Fee (GST inclusive)
-- Booking amount per plan; one receipt per payment; one invoice per plan
--
-- Prerequisite: scripts/schema.sql must have been applied at least once
-- (profiles, courses, payment_plans, invoices, receipts must exist).
-- If you see 42P01 relation does not exist, run schema.sql first in
-- Supabase SQL Editor, then re-run this migration.
--
-- This migration is idempotent: re-running is safe.
-- If payment_plans does not exist (fresh DB without schema.sql),
-- this migration will fail fast with a clear prerequisite message
-- instead of a cryptic 42P01. Run schema.sql first.
-- ============================================================

-- ── Prerequisite guard: fail fast with actionable message ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='courses')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_plans')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='invoices')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='receipts') THEN
    RAISE EXCEPTION
      'Prerequisite missing: profiles/courses/payment_plans/invoices/receipts do not exist. '
      'This is a fresh/empty database. Run scripts/schema.sql in Supabase SQL Editor FIRST '
      '(it is the base rebuild — DROP IF EXISTS + CREATE TABLE for all core tables, idempotent), '
      'then re-run this migration 037. '
      'Do NOT run 037 standalone on an empty DB.';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────
-- 1. payment_plans: add standard/discount/booking lineage
--    total_amount remains FINAL AGREED FEE (GST inclusive)
--    Existing rows: standard = NULL, discount = 0, booking = NULL -> legacy
-- ──────────────────────────────────────────────────────────
ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS standard_course_fee NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS booking_amount NUMERIC(12,2) NULL;

-- Guardrails for financial correctness (check constraints)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_plans_discount_non_negative'
  ) THEN
    ALTER TABLE payment_plans
      ADD CONSTRAINT chk_payment_plans_discount_non_negative
      CHECK (discount_amount >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_plans_discount_lte_standard'
  ) THEN
    ALTER TABLE payment_plans
      ADD CONSTRAINT chk_payment_plans_discount_lte_standard
      CHECK (standard_course_fee IS NULL OR discount_amount <= standard_course_fee);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_plans_booking_non_negative'
  ) THEN
    ALTER TABLE payment_plans
      ADD CONSTRAINT chk_payment_plans_booking_non_negative
      CHECK (booking_amount IS NULL OR booking_amount >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_plans_booking_lte_total'
  ) THEN
    ALTER TABLE payment_plans
      ADD CONSTRAINT chk_payment_plans_booking_lte_total
      CHECK (booking_amount IS NULL OR booking_amount <= total_amount);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────
-- 2. invoices: link to payment plan + persistent storage path
--    One invoice per completed plan is enforced by partial unique index.
--    Existing invoices (payment_plan_id NULL) remain valid.
-- ──────────────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_plan_id UUID NULL
    REFERENCES payment_plans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_plan_id
  ON invoices(payment_plan_id)
  WHERE payment_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_payment_plan
  ON invoices(payment_plan_id);

-- ──────────────────────────────────────────────────────────
-- 3. receipts: persistent storage path
-- ──────────────────────────────────────────────────────────
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS storage_path TEXT NULL;

-- ──────────────────────────────────────────────────────────
-- 4. Idempotency: one receipt per payment
--    Existing data is expected to have 0 duplicates (receipts generated
--    per payment via outbox). The index uses IF NOT EXISTS so the
--    migration does not fail if a pre-existing duplicate is found
--    instead the index creation would fail — operator must resolve
--    duplicates manually per P1 spec before re-running.
-- ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_payment_id
  ON receipts(payment_id);

-- ──────────────────────────────────────────────────────────
-- 5. Comments for auditability
-- ──────────────────────────────────────────────────────────
COMMENT ON COLUMN payment_plans.standard_course_fee IS 'Standard / list course fee at time of agreement. NULL for legacy plans.';
COMMENT ON COLUMN payment_plans.discount_amount IS 'Discount applied in rupees to reach final agreed fee. 0 if none.';
COMMENT ON COLUMN payment_plans.discount_reason IS 'Human-readable reason for discount, e.g. scholarship, waiver, campaign.';
COMMENT ON COLUMN payment_plans.booking_amount IS 'Optional booking amount per student. NULL means not specified; 0 is valid explicit zero.';
COMMENT ON COLUMN payment_plans.total_amount IS 'FINAL AGREED COURSE FEE (GST inclusive). Immutable after plan creation.';
COMMENT ON COLUMN invoices.payment_plan_id IS 'Plan this invoice covers (full agreed fee). One invoice per plan via partial unique index.';
COMMENT ON COLUMN invoices.storage_path IS 'Persistent Supabase Storage path (e.g. invoices/<student>/<number>.pdf). Used to mint fresh signed URL on download.';
COMMENT ON COLUMN receipts.storage_path IS 'Persistent Supabase Storage path. Used to mint fresh signed URL on download.';
