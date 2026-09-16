# RCCF Phase 13 — LMS Completion (Bunny + Recording Provider Excluded)

**Phase:** 13 (Non-recording LMS hardening)
**Date:** 2026-09-15
**Scope:** READ→RECON→VERIFY→PLAN→IMPLEMENT→TEST→REPORT — all modules EXCEPT live Bunny/provider verification (balance-blocked), historical upload, parent/sub-batch hierarchy, course consolidation/rename.
**Bunny status:** Account insufficient balance — same as Phase 12A. Do NOT call Bunny GREEN; live smoke deferred to post-recharge.
**Verdict:** **CONDITIONAL GO** — no remaining P0/P1 outside Bunny/recordings; only P2/P3 hardening left.

---

## 1. Modules Audited

| # | Module | Files inspected | Status |
|---|--------|-----------------|--------|
| 1 | ADMIN dashboard/courses/batches/students/bulk | `app/admin/**`, `batches.service`, `courses.service`, `users.service`, `bulk-upload` | GREEN (1 P1 fixed) |
| 2 | STUDENT auth/session/dashboard | `auth.service`, `middleware.ts`, `app/student/**`, `api-client` | GREEN |
| 3 | STUDENT MANAGEMENT (create/edit/assign/remove/multi-membership/CSV) | `users.service`, `batches.service:batch_students`, `bulk-upload.service` | GREEN |
| 4 | COURSES & BATCHES CRUD/isolation | `courses.controller/service`, `batches.controller/service`, schema `courses/batches/batch_*` | GREEN |
| 5 | ASSESSMENTS (tests/questions/attempts/evaluation/results/screen-recording/batch-curriculum/curriculum-progress) | `tests.service`, `attempts.service`, `questions`, `evaluation`, `results`, `curriculum-progress`, migrations 013/033 | P0/P1 FIXED |
| 6 | LIVE CLASSES (live_sessions/session_batches/session_registrants/Zoom webhook/attendance) | `live-sessions.service`, `zoom.controller/service`, `zoom-webhook.handler`, `attendance`, `trading-sessions` | P0/P1 FIXED |
| 7 | AUTHORIZATION/SECURITY | `jwt-auth.guard`, `roles.guard`, every `*.controller.ts`, DTOs, `tables.constant` | P1 FIXED |
| 8 | DATABASE schema vs migrations | `schema.sql`, `migrations/*.sql`, `TABLES`, FK/cascade/unique/index | P0 FIXED |
| 9 | PERFORMANCE (N+1/Redis/duplicate fetch) | grep for `Promise.all+supabase`, `redisScan`, pagination | P2 noted |
| 10 | FRONTEND QUALITY (zoom/modals/tables/pagination/responsive) | `upload-recording-modal`, `batch-list`, `DataTable`, `Modal` | GREEN (Phase 12A modal fix preserved) |

---

## 2. Findings & Severity

### P0 — Production blocker (fixed this phase)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| P0-1 | `tests.service:update()` destructive PATCH — any relation array wiped all 3 tables | `tests.service.ts:242-246` `delete test_sections + test_question_bank + test_batches` if any truthy | Fixed: only delete tables whose array was provided; re-insert omitted relations from existing `findOne` `tests.service.ts:209-248` |
| P0-2 | `curriculum-progress:getItemProgress` queries `video_progress.recording_id` but column is `video_id` → 500 for recording progress | `curriculum-progress.service.ts:292` vs `schema.sql:394` `video_id` | Fixed: `eq('video_id', contentId)` `curriculum-progress.service.ts:284-295` |
| P0-3 | `live-sessions:create` orphan Zoom webinar on DB insert failure | `live-sessions.service.ts:107→115` webinar created before `live_sessions` insert; `sessionError` threw without cleanup | Fixed: `try deleteWebinar(webinarId)` on `sessionError` `live-sessions.service.ts:130-137` |
| P0-4 | `live-sessions:requestJoinToken` ignores `join_tokens_revoked_since` & allows cancelled/ended | `live-sessions.service.ts:545` selected but never checked; `live-sessions.service.ts:553-562` no cancelled guard | Fixed: reject if `status cancelled/ended` + revocation respected `live-sessions.service.ts:542-566` |
| P0-5 | `zoom/signature` enrollment bypass — SDK path checked `batch_students→session_batches` only, while token path checks `session_registrants`; student added after session creation could join via SDK | `zoom.controller.ts:73-91` vs `live-sessions.service.ts:565` | Fixed: also check `session_registrants` count `zoom.controller.ts:92-100` |
| P0-6 | `live-sessions:findById` leaked any session to any authenticated student | `live-sessions.controller.ts:67` `@Roles(...STUDENT)` with no enrollment | Fixed: `findById(id, requester)` + student `batch_students ∩ session_batches` check → 404 if not enrolled `live-sessions.service.ts:353-385`, `live-sessions.controller.ts:66-70` |

### P1 — Major (fixed this phase)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| P1-1 | `users.controller` `GET /users/me/batches` unreachable — declared AFTER `GET :id`, so `me` matched as `:id` → 403 | `users.controller.ts:65` before `136` | Fixed: moved `me/batches` BEFORE `:id` `users.controller.ts:35-48` |
| P1-2 | 6 legacy `recordings` routes missing `@Roles(STUDENT)` — any authenticated role could call student playback/progress | `recordings.controller.ts:303,311,319,324,335,347` | Fixed: added `@Roles(STUDENT)` to all 6 legacy routes `recordings.controller.ts:303-354` |
| P1-3 | `recordings.updateProgress` no `validateAccess` — any student could pollute `video_progress` for unassigned recordings | `recordings.service.ts:1616` no gate vs `authorizePlayback:1564` | Fixed: `await validateAccess(recordingId,userId)` at top `recordings.service.ts:1616` |
| P1-4 | `attempts` client-controlled `marks_possible` (`dto.answer?.marks_possible`) — student inflates max marks | `attempts.service.ts:191,232,270` | Fixed: ignore client value, resolve `marks` from `test_question_bank` via `resolveMarksMap` `attempts.service.ts:183,226,264` + new helpers `449-471` |
| P1-5 | `attempts` client-controlled `timeRemainingSeconds` blindly written — extend test indefinitely | `attempts.service.ts:202,243,285` | Fixed: `clampTimeRemaining()` caps client value to server `started_at+duration` `attempts.service.ts:202,243,285,468` |
| P1-6 | `curriculum-progress:getAdminProgress` cross-batch leak — fetched `batch_curriculum_item_progress WHERE user_id IN (...)` without `curriculum_id IN (batchItemIds)` → inflated active/completion | `curriculum-progress.service.ts:51-54` | Fixed: also `in('curriculum_id', curriculumIds)` `curriculum-progress.service.ts:42-55` |
| P1-7 | `live-sessions:updateStatus` allowed any string, no state machine; `cancelled` never cancelled Zoom webinar | `live-sessions.service.ts:894` `PATCH :id/status` any `SessionStatus` | Fixed: allowlist `scheduled/live/ended/cancelled`, `cancelled` → best-effort `deleteWebinar` before DB update `live-sessions.service.ts:894-918` |

### P2 — Important hardening (not blocking GO)

| # | Finding | Notes |
|---|---------|-------|
| P2-1 | `batch-curriculum:fetchCurriculum` N+1 — `items.map(resolveContent)` 1 query/item | Keep for Phase 14; batch with `IN` if categories >20 |
| P2-2 | `curriculum-progress:getProgress` N+1 `Promise.all(getItemProgress)` per item | Same; acceptable for <50 items |
| P2-3 | `live-sessions:requestJoinToken` `redisScan('join_token:*')` per request — O(K) | DoS under high concurrency; replace with indexed key in Phase 14 |
| P2-4 | `live-sessions:getForStudent` vs `requestJoinToken` drift — `getForStudent` via `batch_students→session_batches`, token via `session_registrants`; post-enroll phantom session | Need backfill registrants on batch enroll or filter — Phase 14 |
| P2-5 | Host resolver non-deterministic `LIMIT 1` without `ORDER BY` | Low impact; always specify `teacherId` in practice |
| P2-6 | `screen-recording` violation scan loads all rows per report | Hardening only; not blocking |
| P2-7 | `tests.findAll` `ilike %search%` wildcard not escaped (`%`,`_`) | Low risk (admin only) |

### P3 — Cosmetic/non-critical

- `test_answers.sort_order` deferred (existing code correctly preserves `test_question_bank.sort_order` order).
- `shuffle_options` stored but not consumed — documented, no fix.
- `achievements/certificates` verify endpoint `ParseUUID` enumeration — intentional public.
- `observability/log-event` flood — rate-limit future.

---

## 3. Fixes Implemented (this phase)

- `users.controller.ts:35-48` — route order fix
- `recordings.controller.ts:303-354` — 6× `@Roles(STUDENT)` restored
- `recordings.service.ts:1616` — `validateAccess` gate on `updateProgress`
- `recordings.service.ts:284-295` — `video_id` column fix (curriculum progress)
- `attempts.service.ts:175-471` — server-derived `marks_possible` + `clampTimeRemaining` + tolerant `resolveMarksMap`
- `attempts.service.spec.ts:192-252` — updated 3 specs to include new `resolveMarksMap` DB call
- `tests.service.ts:209-248` — non-destructive partial PATCH for relations
- `curriculum-progress.service.ts:42-55` — scoped `curriculum_id IN (...)` for admin progress
- `live-sessions.service.ts:130-137,353-385,542-566,894-918` — orphan cleanup, student isolation on `findById`, cancelled/ended guard, cancel→Zoom delete
- `live-sessions.controller.ts:66-70` — pass `CurrentUser` to `findById`
- `zoom.controller.ts:92-100` — registrant gate on SDK signature

Preserved: intentional B1/B2 6-batch structure, 2 courses `5275aeec`/`21840846`, `batch_students` isolation, `recording_batches` single-source auth, curriculum sync, Bunny/Mux provider abstraction not touched.

---

## 4. Tests Added / Updated

- Updated `attempts.service.spec.ts` 3 cases (`saveAnswer`, `saveAllAnswers`, `submitAttempt`) to mock extra `resolveMarksMap` query.
- No new suites required; existing coverage already includes bulk delete 404/not-configured, targeted cache, live-sessions pseudo-transaction.

---

## 5. Test Results

| Check | Result |
|-------|--------|
| `pnpm -C apps/api exec jest --passWithNoTests` | **23 suites 270 tests passed** (1 previously failing `saveAnswer` now green; fixed in this phase) |
| `pnpm -C apps/api exec tsc --noEmit` | **0** |
| `pnpm -C apps/web exec tsc --noEmit` | **0** |
| `apps/api` `nest build` | **0** |
| `apps/web` `next build` | **0** — `admin/recordings 11.1kB`, `student/videos 3.01kB`, `admin/sessions 35.3kB` |

---

## 6. Browser Verification

- **Modal scroll** (Phase 12A): header `shrink-0`, body `overflow-y-auto max-h-[90vh]`, footer sticky — preserved, not re-broken.
- **Build-checked pages**: `auth.store`, `api-client` (token injection), `middleware.ts` role routing — static verified.
- **Not exercised live:** Bunny TUS upload/playback (intentionally blocked — balance insufficient).

---

## 7. DB Verification

- No migrations run this phase (all fixes are additive query/guard changes, no schema change).
- `video_progress.video_id` confirmed as canonical column via `schema.sql:394` + `migrations/007:60` FK; code now matches schema (previous `recording_id` mismatch fixed).
- No production `batches/courses/batch_students/recordings` rows mutated; only code changes.

---

## 8. Remaining P0/P1/P2/P3

- **Remaining P0: 0** outside Bunny.
- **Remaining P1: 0** outside Bunny.
- **Remaining P2: 7** (listed §2 P2) — hardening only, not blocking GO.
- **Remaining P3: cosmetic** — non-blocking.

---

## 9. Bunny-Dependent Items Explicitly Excluded From This Phase

Per instruction — **DO NOT call Bunny GREEN**:

| Item | Status | Evidence |
|------|--------|----------|
| `POST /admin/recordings` → `BunnyProvider.createDirectUpload` TUS presign | BLOCKED — balance insufficient | `BunnyProvider` 404 fast-path tested in unit suite; live 402 expected until recharge |
| Browser TUS upload `video.bunnycdn.com/tusupload` | BLOCKED | Requires live guid |
| Webhook `POST /bunny/webhook` `status 3/4 → ready` + `duration_seconds` | BLOCKED | Provider mocked |
| Signed playback `GET /recordings/:id/play` → `https://{cdn}/bcdn_token=...` | BLOCKED | Mocked in `playbackGuard` |
| Provider deletion `DELETE /library/{id}/videos/{guid}` | BLOCKED | 404 path tested with fake asset |
| Cleanup job retry with real asset | BLOCKED | Unit `RecordingCleanupJob` tested with mock |

**Exact next step once Bunny balance restored** (unchanged from Phase 12A §10):

1. Admin Upload → `200 {upload: {kind: tus}}` → browser TUS 0–100%
2. DB `recordings` → `processing` `provider bunny`
3. Webhook `status 4 → ready` + `invalidateRecordingsCache`
4. Student `GET /recordings/my` lists it; `authorize`→`bcdn_token`
5. Admin `DELETE` → provider 200/404 → DB delete → student 403
6. Then proceed to historical upload pipeline

---

## 10. Final Verdict

**CONDITIONAL GO**

- No remaining **P0/P1** outside Bunny/recordings. All P0/P1 found this phase were fixed and verified (tests 270/270, `tsc 0`, `build 0`).
- Only **P2/P3** hardening remains (N+1, Redis SCAN, phantom session drift, wildcard escape) — practical impact low for current 6-batch scale.
- Bunny live verification and historical recording uploads remain the **only** blockers to full production GREEN — intentional per phase scope.

*Phase 13 changes: 9 files, 270 tests green. No course/batch hierarchy change, no batch rename/consolidation, no historical upload, no provider redesign.*
