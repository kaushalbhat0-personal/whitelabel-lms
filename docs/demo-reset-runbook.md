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

## 7. Shared student account policy (instant demo)

- The demo **student** account is the only account intended for instant
  prospect access. Prospects explore courses, recordings, tests, results,
  certificates, and the live-class list as a student.
- The demo **admin** account remains operator-only and is shown exclusively
  through guided walkthroughs. Never share admin credentials with prospects.
- Credentials live in the operator vault and the demo environment only.
  They must never enter Git, marketing source or build output, screenshots,
  URLs, logs, tickets, or public documentation.
- Never hardcode a demo email or password in `apps/web`, `apps/marketing`,
  tests, fixtures, or docs. The login form takes operator-shared input at
  runtime; nothing demo-specific is branched in code (no `DEMO_MODE`,
  no `tenant_id`).
- The demo database holds the only copy of demo user rows. Canonical
  migrations, `scripts/generated/*`, seeds, and the deployment factory
  contain no demo users by design (see §6).

## 8. Rotation procedure

When to rotate the shared student password (no fixed high-frequency
schedule; rotate on cause):

- A prospect reports the demo student login no longer works (another
  visitor may have used change-password on the shared account).
- Suspicious activity on the shared student (unexpected profile change,
  mass attempts, abuse reports).
- Any material exposure incident (password pasted into a ticket, chat log,
  screenshot, recording, or indexed page).
- Scheduled operational rotation before a major sales push, at operator
  discretion.

How to rotate (operator-held tooling only, demo project):

1. In the Supabase dashboard (DEMO project) Authentication > Users, locate
   the demo student and use Send/Reset password or set a new strong unique
   password. Alternatively, as demo admin via the API
   (`POST /auth/change-password` is self-service; prefer the dashboard so
   the operator controls the new value).
2. Update the single operator-vault entry. Do not write the new value
   anywhere else.
3. Verify afterward: sign in as the demo student on the demo Vercel URL,
   confirm the dashboard, one recording playback authorization, and one
   published test listing; then sign out. Confirm `GET /health` → 200 and
   an unauthenticated protected route → 401.
4. If lockout recurs frequently, run the §3 reset scope check (a truncated
   `profiles` table requires reprovisioning the demo student per §4 step 3)
   and consider moving to per-prospect provisioning in a future checkpoint
   — do not improvise a token/magic-link system here.

## 9. Reset triggers (reuse §3, no automation)

Execute the existing §3 full reset + §4 reprovision when any of the following
holds; do not build an automated reset:

- Prospect-generated attempts, progress, views, or notifications create
  excessive demo noise before a sales call.
- The shared student account is locked out (password changed by a visitor)
  and rotation alone does not restore a known-good state.
- Demo state becomes materially inconsistent (orphaned curriculum rows,
  unpublished test with attempts, missing enrolment for the demo student).
- The operator intentionally refreshes the demo before a scheduled call.

After reset, re-run the §5 verification checklist including both the demo
student and the operator-held demo admin logins.

## 10. Demo password policy (shared-account protection)

- Demo deployments run with `PASSWORD_MANAGEMENT=disabled` (Render demo API
  env only). Client deployments and factory templates use `enabled`.
- Under `disabled`: `POST /auth/forgot-password` and `POST /auth/change-password`
  are rejected server-side (uniform 403, no reset email issued, no account
  enumeration); the web login/change/reset pages show the operator-managed
  message instead of password forms. Admin/operator rotation paths
  (`resendWelcome`, Supabase dashboard) are unaffected.
- If a password-reset email was issued before the policy was enabled, its link
  still completes via Supabase directly. After enabling, rotate the shared
  student password once (dashboard → operator vault) to invalidate stragglers.
- Optional hardening on the DEMO Supabase project: disable the "Reset password"
  email template so no recovery flow can originate there either. Never commit
  demo credentials; rotation values live in the operator vault only.

## 11. Temporary instant demo access (per-prospect accounts, demo only)

> **Scope:** sales-demo deployment only. This is a deployment-scoped
> capability (`TEMP_DEMO_ACCESS`), not a client feature and not `DEMO_MODE`.
> Client deployments leave the flag unset (disabled) and are unaffected.

How it works:

- Marketing `/demo` links prospects to the LMS-hosted `/demo-access` page
  (`NEXT_PUBLIC_DEMO_URL` + `/demo-access`). Marketing never issues
  credentials and never calls the API.
- The prospect clicks Generate Demo Access → `POST /demo/access` (public, no
  request body — any supplied property is rejected with 400) creates one
  independent `student` account: random `demo-<hex>@demo.invalid` login,
  CSPRNG password, `must_change_password=false`,
  `expires_at = now() + 30 minutes`.
- Credentials return once over HTTPS (`Cache-Control: no-store`) and live
  only in page memory. The prospect still logs in normally at `/login`.
- A per-minute sweeper revokes ALL Redis sessions (`forceLogoutUser` +
  playback/join state), then sets `is_active=false`. Login also rejects
  past-`expires_at` rows, so new logins stop even between sweeper ticks.
- ~24h after expiry a hourly job hard-deletes the Auth user + profile.
  Every destructive predicate requires `expires_at IS NOT NULL`, so normal
  accounts (always NULL) can never be touched.
- Abuse protection: 3 successful issuances per IP per hour, 500 per UTC day
  globally (counts successes only). Over-limit and failure responses are a
  neutral 503 with no internals.

Operator setup (demo project only, one time):

1. In the Supabase dashboard (DEMO project) SQL Editor, run
   `scripts/migrations/041_temp_demo_access.sql` once. Verify:
   `profiles` gained nullable `expires_at` (existing rows stay NULL).
2. On Render (demo API service) set `TEMP_DEMO_ACCESS=enabled` (keep
   `SESSION_POLICY=multi`, `PASSWORD_MANAGEMENT=disabled`), redeploy.
3. Client Render services and the deployment factory stay untouched: factory
   templates never emit the flag (regression-tested), unset means disabled,
   and the endpoint answers 404 when disabled.

Disable / revoke in an incident:

- Set `TEMP_DEMO_ACCESS=disabled` (or remove it) on the demo API and
  redeploy — issuance immediately answers 404. The sweeper keeps revoking
  already-issued temporary rows; to force-expire one now, set its
  `expires_at` to the past in the dashboard and wait ≤1 minute.

Security rules (same bar as §7):

- Never publish, log, screenshot, or ticket a generated password. The only
  intended exposure is the issuing HTTPS response.
- Never email temporary accounts, never add password-reset flows for them.
