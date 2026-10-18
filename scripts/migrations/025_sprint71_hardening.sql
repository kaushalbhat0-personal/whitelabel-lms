-- Sprint 7.1: Production Hardening
-- P0-6: Prevent duplicate active test attempts at DB level

-- Partial unique index: only one in_progress attempt per user per test
CREATE UNIQUE INDEX IF NOT EXISTS idx_test_attempts_one_active
  ON test_attempts (test_id, user_id)
  WHERE status = 'in_progress';
