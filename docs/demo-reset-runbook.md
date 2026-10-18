# MicroNest Services Academy — Sales Demo Reset / Reprovision Runbook (DEMO ONLY)

> **Scope:** this procedure operates ONLY on the disposable sales-demo Supabase
> database. It NEVER touches canonical migrations, `scripts/generated/*`,
> product source, or any client database. No demo data lives in this repo.

## 1. When to use

- A prospect modified/deleted demo state during a sales walkthrough.
- You want a known-good demo before a call.

## 2. Prerequisites (operator-held, never committed)

- Supabase service-role key for the DEMO project (operator vault).
- Demo admin credentials (operator vault, rotated per handoff).
- Render + Vercel dashboards (no changes needed for a data-only reset).

## 3. Full reset (Supabase SQL Editor on the DEMO project)

Run in one transaction. `CASCADE` handles join tables. Storage objects in
`uploads`/`invoices` buckets are left in place (orphaned files are harmless for
a demo; delete the buckets' demo folders from the dashboard if desired).

```sql
begin;

-- certification / results
truncate table certificate_verifications, certificates,
  test_results, test_review_queue, test_answers, test_attempts cascade;

-- billing
truncate table payments, payment_installments, payment_plans,
  invoices, receipts, invoice_sequences, outbox_messages cascade;

-- engagement
truncate table notifications, notification_reads, announcements,
  email_logs, email_delivery_events cascade;

-- curriculum / recordings
truncate table batch_curriculum_item_progress, batch_recording_curriculum,
  recording_batches, video_progress, video_views, video_access_logs,
  recordings cascade;

-- sessions / enrolment
truncate table attendance, session_registrants, session_batches,
  live_sessions, batch_students, batches cascade;

-- learning content
truncate table test_batches, test_questions, tests,
  question_bank cascade;

-- people (keeps Supabase auth.users; delete demo auth users from
-- Authentication > Users in the dashboard, EXCEPT the demo admin)
truncate table user_devices, login_alerts, profiles cascade;

commit;
```

Then, in the dashboard: delete demo Mux assets (or delete recordings via the
admin UI BEFORE the truncate — admin delete also removes the Mux asset).

## 4. Reprovision (operator-run, live Render API)

1. Ensure one `business_config` row exists (seeded once per database; the API
   `PUT /business-config` is update-only).
2. As demo admin: `PUT /business-config` (MicroNest Services Academy, INR,
   en-IN, Asia/Kolkata, inclusive 18%, FY April, theme navy/gold).
3. Create courses (3) → batches (3) → users (1 admin exists; 3 students).
4. Enrol students; insert Zoom-free `live_sessions` + `session_batches` rows
   (1 past, 2 upcoming) directly in the DEMO database.
5. `POST /admin/recordings` per video (provider `mux`), PUT the demo clip to
   each `upload.url`, poll `recordings.status = ready` (webhook path).
6. Bulk-import questions → create 2–3 tests → publish.
7. As each student: start → submit attempts; as admin: auto-grade → review
   queue (long-answer) → review → publish results.
8. As a student: mark recording progress → `POST /student/batches/:id/check-completion`
   → certificate issued → note the public verify token.
9. Payments plan → booking → pay instalments → wait ~60s for the outbox cron →
   confirm `invoices` + `receipts` rows and PDF download URLs.
10. Publish 2 announcements; confirm student notifications.
11. Confirm `email_logs` shows `sent` (or diagnose Resend domain/key).

## 5. Verification checklist (read-only)

- Vercel `/login` title shows the academy brand.
- Admin login → dashboard, students, courses, recordings (Ready), tests,
  review queue, finance, business config.
- Student login → dashboard, videos, playback, tests, results, certificate.
- Public `/verify-certificate?token=…` shows name/course/date.
- `GET /health` → 200; unauthenticated protected route → 401.

## 6. Client handoff invariant

A paying client is provisioned from the frozen codebase + canonical
`scripts/generated/fresh-supabase-init.sql` + their own infra/env — NEVER by
copying this demo database. This runbook and all demo records stay out of the
product baseline.
