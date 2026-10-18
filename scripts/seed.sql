-- ============================================================================
-- LMS Platform — Seed Data
-- Run this AFTER schema.sql in Supabase SQL Editor.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Business config (single row — MUST exist before invoice/receipt generation)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO business_config (
  business_name,
  address_line_1,
  city,
  state,
  pincode,
  country,
  email,
  phone,
  current_financial_year,
  invoice_prefix,
  receipt_prefix,
  next_invoice_number,
  next_receipt_number
) VALUES (
  'Demo Organization',
  '123, Business Centre',
  'Mumbai',
  'Maharashtra',
  '400001',
  'India',
  'hello@example.com',
  '+91-9876543210',
  '2026-2027',
  'INV',
  'RCP',
  1,
  1
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Admin user (instructions)
-- ────────────────────────────────────────────────────────────────────────────

-- IMPORTANT: Do NOT seed admin users here.
-- Create the admin user via Supabase Auth UI (Authentication → Add User),
-- then insert the matching profile row:
--
--   INSERT INTO profiles (id, name, email, role)
--   VALUES (
--     '<auth-users-uuid>',
--     'Admin Name',
--     'admin@example.com',
--     'admin'
--   );
