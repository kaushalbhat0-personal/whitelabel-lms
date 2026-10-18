-- ============================================================
-- Migration 030: Invoice Sequences
-- Sprint 7.3 Enterprise Hardening — Phase C
--
-- Creates a dedicated invoice_sequences table for atomic
-- counter allocation, eliminating race conditions in the
-- previous business_config counter approach.
-- ============================================================

-- Invoice sequences table
-- Each row represents a counter for a document type + FY combination
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_type VARCHAR(20) NOT NULL,   -- 'INVOICE' or 'RECEIPT'
  fiscal_year   VARCHAR(20) NOT NULL,   -- e.g. '2025-26'
  counter       INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sequence_type, fiscal_year)
);

-- Seed existing counters from business_config
-- Normalize fiscal_year to 'YYYY-YY' format if present
INSERT INTO invoice_sequences (sequence_type, fiscal_year, counter)
SELECT 'INVOICE',
       CASE
         WHEN current_financial_year ~ '^\d{4}-\d{2}$' THEN current_financial_year
         WHEN current_financial_year ~ '^\d{4}-\d{4}$' THEN LEFT(current_financial_year, 4) || '-' || RIGHT(current_financial_year, 2)
         ELSE '2025-26'
       END,
       COALESCE(next_invoice_number, 0)
FROM business_config
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_sequences WHERE sequence_type = 'INVOICE'
);

INSERT INTO invoice_sequences (sequence_type, fiscal_year, counter)
SELECT 'RECEIPT',
       CASE
         WHEN current_financial_year ~ '^\d{4}-\d{2}$' THEN current_financial_year
         WHEN current_financial_year ~ '^\d{4}-\d{4}$' THEN LEFT(current_financial_year, 4) || '-' || RIGHT(current_financial_year, 2)
         ELSE '2025-26'
       END,
       COALESCE(next_receipt_number, 0)
FROM business_config
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_sequences WHERE sequence_type = 'RECEIPT'
);

-- Index for sequence lookups
CREATE INDEX IF NOT EXISTS idx_invoice_sequences_type_fy
  ON invoice_sequences(sequence_type, fiscal_year);

-- Atomic sequence increment function
-- Uses UPDATE ... RETURNING for guaranteed atomic allocation
-- Returns the new counter value (not the old one)
CREATE OR REPLACE FUNCTION increment_sequence(
  p_sequence_type VARCHAR(20),
  p_fiscal_year VARCHAR(20)
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_counter INTEGER;
BEGIN
  INSERT INTO invoice_sequences (sequence_type, fiscal_year, counter)
  VALUES (p_sequence_type, p_fiscal_year, 1)
  ON CONFLICT (sequence_type, fiscal_year)
  DO UPDATE SET counter = invoice_sequences.counter + 1,
                updated_at = now()
  RETURNING counter INTO v_new_counter;

  RETURN v_new_counter;
END;
$$;
