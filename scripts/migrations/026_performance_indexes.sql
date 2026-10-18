-- ============================================================
-- Migration 029: Performance Indexes
-- Sprint 7.3 Enterprise Hardening — Phase B
--
-- Adds indexes for real query patterns identified during
-- performance audit. All indexes support existing query paths.
-- ============================================================

-- Student enrollment lookups (getMySessions, getVideosForStudent, etc.)
CREATE INDEX IF NOT EXISTS idx_batch_students_user_id
  ON batch_students(user_id);

-- Session-to-batch joins (session filtering by batch)
CREATE INDEX IF NOT EXISTS idx_session_batches_session_id
  ON session_batches(session_id);
CREATE INDEX IF NOT EXISTS idx_session_batches_batch_id
  ON session_batches(batch_id);

-- Recording-to-batch joins (batch access lookups)
CREATE INDEX IF NOT EXISTS idx_recording_batches_recording_id
  ON recording_batches(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_batches_batch_id
  ON recording_batches(batch_id);

-- Batch curriculum lookups
CREATE INDEX IF NOT EXISTS idx_batch_curriculum_batch_id
  ON batch_recording_curriculum(batch_id);

-- Test batch associations
CREATE INDEX IF NOT EXISTS idx_test_batches_test_id
  ON test_batches(test_id);
CREATE INDEX IF NOT EXISTS idx_test_batches_batch_id
  ON test_batches(batch_id);

-- Payment plan installments (all-paid check)
CREATE INDEX IF NOT EXISTS idx_payment_installments_plan_status
  ON payment_installments(payment_plan_id, status);

-- Student payments
CREATE INDEX IF NOT EXISTS idx_payments_student_id
  ON payments(student_id);

-- Certificates by user + course (dedup + lookup)
CREATE INDEX IF NOT EXISTS idx_certificates_user_course
  ON certificates(user_id, course_id);

-- Join tokens for session + user lookup
CREATE INDEX IF NOT EXISTS idx_join_tokens_session_user
  ON join_tokens(session_id, user_id);

-- Notifications by user (ordered by created_at desc)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Announcements ordered by creation
CREATE INDEX IF NOT EXISTS idx_announcements_created
  ON announcements(created_at DESC);

-- Batch curriculum rules by batch + category
CREATE INDEX IF NOT EXISTS idx_batch_curriculum_rules_batch_category
  ON batch_curriculum_rules(batch_id, category_name);

-- Batch curriculum prerequisites by batch
CREATE INDEX IF NOT EXISTS idx_batch_curriculum_prereqs_batch
  ON batch_curriculum_prerequisites(batch_id);

-- Curriculum item progress by user (student dashboard)
CREATE INDEX IF NOT EXISTS idx_curriculum_progress_user
  ON batch_curriculum_item_progress(user_id, curriculum_id);

-- Video progress by user (playback resume)
CREATE INDEX IF NOT EXISTS idx_video_progress_user_video
  ON video_progress(user_id, video_id);

-- Observability queries (dashboard time-range filtering)
CREATE INDEX IF NOT EXISTS idx_system_events_type_created
  ON system_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_errors_type_created
  ON system_errors(error_type, created_at DESC);

-- Live sessions status + time filtering
CREATE INDEX IF NOT EXISTS idx_live_sessions_status_start
  ON live_sessions(status, start_time DESC);
