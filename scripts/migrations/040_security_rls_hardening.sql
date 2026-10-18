-- ============================================================================
-- Migration 040: Default-deny Row Level Security hardening
-- ============================================================================
-- Product security boundary (defense in depth).
--
-- Architecture (verified, see RCCF-SEC-01 audit):
--   Browser  -> Supabase anon key -> Auth API ONLY (no table/storage access)
--   Browser  -> NestJS API (custom JWT + Redis + RolesGuard) -> service_role -> PG
--   Scripts/tests/E2E -> service_role
-- PostgreSQL can never see the LMS application user (no Supabase sessions,
-- no auth.uid() in any runtime path), so per-user RLS policies are impossible
-- without inventing a second identity system. Instead this migration makes
-- RLS a default-deny boundary around DIRECT database access:
--   anon / authenticated -> DENIED on all application tables
--   service_role        -> BYPASSES RLS (existing API keeps working)
-- No USING (true) / WITH CHECK (true) blanket policies are introduced here.
-- No demo-, client- or tenant-specific logic. No auth.uid() bridge.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remove security-negative pre-existing policies.
--    Migration 011 "Service role full access" policies have no TO clause, so
--    they apply to PUBLIC (including anon) with USING/WITH CHECK (true).
--    service_role bypasses RLS anyway, so these policies only open data.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access on test_sections" ON public.test_sections;
DROP POLICY IF EXISTS "Service role full access on question_bank" ON public.question_bank;
DROP POLICY IF EXISTS "Service role full access on test_question_bank" ON public.test_question_bank;
DROP POLICY IF EXISTS "Service role full access on test_batches" ON public.test_batches;
DROP POLICY IF EXISTS "Service role full access on test_answers" ON public.test_answers;
DROP POLICY IF EXISTS "Service role full access on test_review_queue" ON public.test_review_queue;
DROP POLICY IF EXISTS "Service role full access on test_results" ON public.test_results;
DROP POLICY IF EXISTS "Service role full access on test_analytics_snapshots" ON public.test_analytics_snapshots;

-- ----------------------------------------------------------------------------
-- 2. Remove dead migration-010 policies.
--    The SELECT policies gate on auth.uid(), which never resolves because the
--    application never creates Supabase user sessions (service-role + custom
--    JWT only). The INSERT/ALL policies carry WITH CHECK (true) with no role
--    restriction and are therefore PUBLIC write access. All are unreachable
--    dead code at best and open writes at worst: remove them and rely on
--    default deny below.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can read all screen recording violations" ON public.screen_recording_violations;
DROP POLICY IF EXISTS "Service role can insert screen recording violations" ON public.screen_recording_violations;
DROP POLICY IF EXISTS "Admins can read all violation counters" ON public.violation_counters;
DROP POLICY IF EXISTS "Service role can upsert violation counters" ON public.violation_counters;
DROP POLICY IF EXISTS "Admins can read all risk scores" ON public.risk_scores;
DROP POLICY IF EXISTS "Service role can upsert risk scores" ON public.risk_scores;

-- ----------------------------------------------------------------------------
-- 3. Enable RLS (default deny) on every surviving application table.
--    With no permissive policies for anon/authenticated, direct clients get
--    zero rows and permission errors on write; service_role is unaffected.
--    (Tables `videos` / `video_batches` were dropped by migration 005 and are
--    intentionally absent here.)
--    ALTER TABLE ... ENABLE ROW LEVEL SECURITY is safe to re-run (NOTICE only).
-- ----------------------------------------------------------------------------
ALTER TABLE public.business_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_batch_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_registrants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_upload_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screen_recording_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violation_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_recording_curriculum ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_curriculum_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_curriculum_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_curriculum_item_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. Canonical private `invoices` storage bucket.
--    The invoice/receipt flow requires this bucket, but no earlier migration
--    creates it (demo environments provisioned it manually). Create it here:
--    private, idempotent, no public policies. Access stays server-mediated
--    (service-role signed URLs); anon/authenticated get nothing by default
--    (storage.objects has restrictive defaults; no policies added here).
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', false, false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
