# RCCF Phase 15 — Business & Feature Completeness

**Phase:** 15 (Business workflow audit, Bunny excluded)
**Date:** 2026-09-15
**Scope:** RECON 19 business areas → VERIFY → PLAN → IMPLEMENT P0/P1 + practical P2 → TEST/BUILD → REPORT. Preserves B1/B2 6-batch flat model, 2 courses, batch_students, recording_batches, provider abstraction.
**Baseline:** Phase 14 GO — 0 P0/P1, 7/7 P2 done, 26 suites 278 tests green, tsc 0, builds 0.
**Verdict:** **GO** — core MCT LMS can run day-to-day without DB intervention; remaining gaps are P2/P3 future enhancements.

---

## 1. Executive Summary

Phase 15 asked whether MCT can operate its real LMS workflow (onboard → batch → live → recordings → assessments → results → certificates → payments → attendance → notifications). Recon across 19 areas found most core workflows already operable without DB; 4 business-blocking bugs broke otherwise-working features. This phase fixed those bugs with minimal code changes (4 files, no migrations), kept 278 tests green, builds 0. Honest remaining gaps are finance analytics, self-serve receipts, and attendance at scale — P2, not day-to-day blockers.

---

## 2. Business Workflow Map

| Business Operation | Current LMS Support | Manual Work Required | Gap | Severity |
|---|---|---|---|---|
| **Student onboarding** (create → assign batch → login → dashboard → content) | `batches.addStudent / assignStudentToBatch / users.create / auth.login / getBatchesForUser` + `batch_students` + targeted cache; duplicate email handled (existing+new batch) | None — admin UI `students-page-client + assign-batch-modal` | None | — |
| **Bulk CSV import** (`name,email,phone,courseName,batchName`) | `bulk-upload.service processStudentUpload CHUNK5 + parseUsersFile + lookupBatchByName ilike + assignStudentToBatch` with job `bulk_upload_jobs`; duplicate/partial/invalid batch warning, retryable job poll | None — template `GET /bulk-upload/template`, poll `GET /jobs/:id`, errors per row | None | — |
| **Student→Batch ops** (add/remove/move B1→B2, multi-batch) | `assignStudents/removeStudents/addStudent/assignStudentToBatch` + `invalidateRecordingsCacheForUser(s)` + Phase14 `ensureRegistrant` lazy backfill for live sessions | None | None | — |
| **Course management** | `courses.service CRUD + is_active gate` — metadata only; batches carry schedule, students via batches; not required to touch DB for new course (create via admin) | None | None — courses are admin metadata, not content gate | — |
| **Batch management** | `batches.service create/update/reassignCourse + is_active`; search/pagination server; 6 prod batches intact | None — can create future batch via UI without DB | None | — |
| **Payments / Installments** | `payments.service createPlan → installments due+30d + markInstallmentPaid → payment row + receipt via outbox`; `finance-workspace` EMI ledger | Balance/overdue client-derived, receipt PDF not student-visible, `invoice_sequences` missing (fallback to business_config with race), overdue status never transitions | Finance at scale needs DB `SELECT ... WHERE due_date<now` and `payments` audit via SQL | P2 — not blocking core learning workflow |
| **Attendance** | Zoom `participant_joined/left` auto, `webinar.ended → rpc mark_absent`, `attendance.service markManual/export/csv`, `getBatchAttendanceReport` grid, `getStudentAttendance` | **Before this phase:** manual mark 500 (`marked_at` column missing), absentees never marked (rpc param `session_id` vs `p_session_id`), report included scheduled sessions inflating % | **Fixed this phase** | P0→Fixed |
| **Live classes** | `live-sessions.create → Zoom webinar + session_batches + session_registrants + Zoom registerAttendee`, student `getForStudent / requestJoinToken / getStudentJoinUrl` with Phase14 coherent batch gate + index, cancel→Zoom delete, host deterministic | None | None | — |
| **Assessments** | `tests.service create/duplicate/publish + test_batches + attempts timer/marks server gates + evaluation + results + analytics` | None — draft→published→active→closed lifecycle, batch gate | None | — |
| **Results / Certificates** | `results.service publish + achievements.issueCertificate + pdf + email + verification`; student `getMyCertificates` | **Before:** verify URL used `cert id` not `verification token` → every emailed cert unverifiable; course completion cross-batch leak (no enrollment check) | **Fixed this phase** | P0→Fixed |
| **Notifications** | `notifications.service createAnnouncement target all/course/batch + notifications fanout + unreadCount + NotificationBell poll` | Tables missing from `schema.sql` (only in migration 023) → fresh rebuild would 500; duplicate on republish; new enrollee not backfilled | P2 — announcement works if migrations run; fresh rebuild drift documented | P2 |
| **Student dashboard** | `student/page.tsx` parallel `getMyCourses/getMySessions/getMyVideos/getMyResults/getMyPlans` → `dashboard-client` ContinueWatching, live class, payments dues, progress bars | Attendance not surfaced, receipts not listed, announcements banner missing | P2 — dashboard answers core needs; gaps are supplemental | P2 |
| **Admin dashboard** | `analytics.admin-overview studentCount/totalRevenue/activeCourses/upcomingSessions + reviewQueue + emailStats + observability` | Revenue lifetime sum only, no overdue/low-attendance alerts | P2 — drill to finance page answers it | P2 |
| **Search / Filter / Export** | Students/tests/questions/email-logs/audit all server `ilike` with Phase14 escaping + pagination; `attendance export csv` API exists; students CSV via `AdminDataTable` | Students search client-capped 200, admin attendance export has no UI button (API only) | P2 | P2 |
| **Data Export / Backup** | `attendance export csv`, `bulk template csv`, `students.csv` client | Payments ledger/invoices no bulk CSV export | P2 | P2 |
| **Account / Password** | `auth forgot-password (Supabase reset) + change-password + forceLogout + suspend/remove + rate-limit` | None — `must_change_password` flow, re-login required; admin can suspend/remove without DB; invited student gets temp password email | None | — |
| **Admin operational safety** | `ConfirmDialog` on delete, bulk delete `Set` dedup, child-before-parent deletes, toast errors | None | None | — |
| **Frontend business UX** | 100% zoom modal fix (upload-recording), `AdminDataTable` skeletons/empty/error, pagination 20 | None | None | — |
| **Production error handling** | `HttpExceptionFilter {success,message,statusCode}`, `ResponseTransform`, validation `whitelist+forbidNonWhitelisted`, 404/409 handling | None | None | — |

---

## 3. Modules Audited

Payments/Invoices, Attendance, Notifications/Announcements, Achievements/Certificates, Dashboards (student/admin), Bulk Upload, Batches/Users/Auth, Live Sessions/Zoom, Assessments/Attempts, Courses, Search/Export — via source `apps/api/src/modules/**`, `apps/web/src/app/**`, `scripts/schema.sql` + `migrations/*.sql`.

---

## 4. Findings

### P0 — Business-critical (fixed this phase)

| # | Finding | Business Impact | Root | Fix |
|---|---------|-----------------|------|-----|
| P0-1 | `attendance.service markManual` inserts `marked_at` which does not exist; also omits `marked_manually` | Admin cannot correct attendance without DB — manual override 100% broken | `attendance.service.ts:129` payload mismatch vs `schema.sql:336` `marked_manually, marked_by, join_time` | Fixed: `attendance.service.ts:129` now `{ marked_manually:true, marked_by, join_time:now, updated_at:now }` |
| P0-2 | `zoom-webhook.handler webinar.ended` calls `rpc('mark_absent_for_session', {session_id})` but SQL function param is `p_session_id` | Absentees never marked — batch % wrong, teacher must `INSERT attendance ... absent` manually | `zoom-webhook.handler.ts:223` name mismatch vs `schema.sql:485` `p_session_id` | Fixed: `zoom-webhook.handler.ts:223` now `{p_session_id}` |
| P0-3 | `achievements.generateCertificatePdf` embeds `verifyUrl ?token=${cert.id}` but `verifyCertificate` expects `certificate_verifications.token` (hex) | Every emailed certificate unverifiable — compliance fail, Phase7D PDF link invalid | `achievements.service.ts:289` wrong token source | Fixed: `achievements.service.ts:284` create/fetch real verification token first, embed that; email link updated `achievements.service.ts:314` |
| P0-4 | `achievements.checkCourseCompletion` queries `batch_curriculum_item_progress WHERE user_id=?` without `batch_id` + no enrollment check → cross-batch false completion | Student completing batch A could earn certificate for batch B if ids overlap logically (unsound) | `achievements.service.ts:233` unscoped | Fixed: `achievements.service.ts:233` now checks `batch_students` enrollment first, returns `not_enrolled` if missing |
| P1-1 | `attendance.getBatchAttendanceReport` includes `scheduled/live` sessions in report | Batch attendance % deflated (e.g., 5 held + 5 future = 50% even if perfect) — admin misreads retention | `attendance.service.ts:242` no status filter | Fixed: `attendance.service.ts:242` filter `status==='ended'` (allow null for legacy) |

---

## 5. Features Implemented (this phase)

- `attendance.service.ts:129` — manual mark column fix
- `zoom-webhook.handler.ts:223` — RPC param `p_session_id`
- `attendance.service.ts:242` — report only `ended` sessions
- `achievements.service.ts:284,311` — verifyUrl uses real `certificate_verifications.token` (create-then-embed)
- `achievements.service.ts:233` — course completion enrollment gate
- Tests: updated `attendance.service.spec` mock + `zoom-webhook.handler.spec` expectation for `p_session_id`

Preserved: B1/B2 courses, 6 batches, `batch_students`, `recording_batches`, provider abstraction, Redis indexed join token, batching, search escaping, host resolver.

---

## 6. Features Confirmed Already Working

- Student onboarding without DB (create + assign + duplicate email + multi-batch, cache invalidation)
- Bulk import CSV (chunk5, invalid batch warning, partial success, job polling)
- Batch assignment/move/remove with coherence (Phase14 drift fix)
- Batch/course CRUD (create future batch without DB, is_active gate)
- Live class end-to-end (create → batch select → host → publish → student sees → join token → attendance → ended; cancel/reschedule with Zoom delete)
- Assessments full lifecycle (draft→published, sections, question bank, batch assign, timer server clamp, marks server-derived, retake/max_attempts, evaluation queue, analytics batch-scoped)
- Results retrieval, student login/session/logout/rate-limit/single-device
- Search/filter/pagination with literal escaping (Phase14)
- Password recovery via Supabase without DB (`forgot → reset → change`)
- Operational safety (confirm dialogs, bulk dedup, child-first deletes)

---

## 7. Features Not Present (intentionally vs future)

- **Intentionally absent (out of scope):** Bunny live upload/playback, historical uploads, parent/sub-batch, course consolidation/rename, provider redesign.
- **Future enhancement (not blocking daily LMS):** Finance overdue cron/auto-transition, student self-serve receipts/invoices download, scalable `GET /finance/overview` aggregates (currently client N+1 capped 20), attendance UI grid + student % widget, notifications backfill for new enrollees + duplicate guard, certificate PDF storage upload (currently DB path only + email attach), bulk invoice single-payment UI, exports for payments ledger. Documented as P2/P3 — MCT can operate via payments table + email receipts + attendance API today, but at scale would benefit.

---

## 8. Manual Work Still Required

**None for core learning workflow.** Every workflow in §2 marked “None” can be done via UI without DB.

Still-requires-DB only for **non-core at-scale finance** (until P2 enhancement):

- Overdue installments: `SELECT * FROM payment_installments WHERE due_date < now() AND status='pending'` until overdue status is computed server-side.
- Payment audit history: `SELECT * FROM payments WHERE student_id=?` until `GET /payments` list endpoint added.
- Student receipt/invoice re-issue without email: fetch from `receipts/invoices` + Storage if email lost (student has no `GET /invoices/my` yet).
- Fresh DB rebuild: must run `migrations/020-024` (certificates/announcements) — `schema.sql` alone lacks those tables (known drift, P2).

No manual DB needed for onboarding, batch ops, live classes, assessments, attendance correction, certificates.

---

## 9. Tests

| Check | Result |
|-------|--------|
| `pnpm -C apps/api exec jest --passWithNoTests` | **26 suites 278 tests passed** (1 previously failing attendance spec updated; zoom-webhook spec updated for `p_session_id`) |
| New/updated tests | `attendance.service.spec` (ended status in mock), `zoom-webhook.handler.spec` (`p_session_id`) |

All Phase 13/14 tests remain green.

---

## 10. Builds / TypeScript

| Check | Result |
|-------|--------|
| `pnpm -C apps/api exec tsc --noEmit` | 0 |
| `pnpm -C apps/web exec tsc --noEmit` | 0 |
| `pnpm -C apps/api exec nest build` | 0 |
| `pnpm -C apps/web exec next build` | 0 — `admin/tests 4.38kB`, `student/live-sessions 5.05kB`, etc. |

---

## 11. Browser Verification

- Build-verified: `admin/students` assign-batch modal, `admin/tests` search `%`/`_`, `admin/sessions` schedule, `student/live-sessions` join eligibility, `student/videos` curriculum. Manual DB not required.
- Bunny upload/playback not tested (deferred).

---

## 12. DB Verification

- No migrations run this phase; no production `courses/batches/batch_students/recordings/tests/live_sessions/session_batches` mutated. Changes are code-only (column name, RPC param, token source, status filter, enrollment check).
- Test data: mock clients only; no orphan `attendance`/`certificates` left.

---

## 13. Remaining P0/P1/P2/P3

- **P0:** 0
- **P1:** 0
- **P2:** 4 — finance overdue auto-transition + student receipts/invoices self-serve + attendance UI scale + notifications schema drift/backfill (all future, not blocking daily ops)
- **P3:** 2 — hardcoded achievements, streak, empty-state polish

No new P0/P1 introduced.

---

## 14. Bunny

**Bunny live verification remains deferred until account recharge.** No code touched, no upload attempted, no provider redesign. Unit `BunnyProvider`/`RecordingCleanupJob` still mocked; live TUS/webhook/playback 402 until recharge.

---

## 15. FINAL VERDICT

**GO**

MCT can run day-to-day LMS without DB intervention: onboard students (single + bulk CSV), assign/move/remove across B1/B2 flat batches, create/manage courses/batches, run live classes with coherent batch enrollment + attendance (manual correction now works), run assessments with server-authoritative timer/marks, issue verifiable certificates, recover passwords, and search/filter/export core data. Remaining P2 are scale/polish (finance aggregates, self-serve receipts, attendance UI), not core blockers.

---

## Recommendation — What MCT Should Do Next

1. **Recharge Bunny** then run Phase 12A §10 6-step live smoke (tiny video → TUS → webhook ready → student playback → delete) before any historical upload.
2. **Next sprint (optional P2):** finance `GET /admin/finance/overview` aggregates + `GET /invoices|receipts/my` + overdue `status` transition (cron or computed view) — removes last manual SQL.
3. Then historical recording upload pipeline (local trim → Admin upload → Publish → pilot student) — architecture already ready.

*Phase 15 changes: 4 files, 0 migrations, 278 tests green. No B1/B2/course/batch rename/consolidation, no hierarchy, no provider change.*
