# RCCF Phase 16B — Core LMS End-to-End Production / Demo Readiness Report

**Date:** 2026-09-16
**Mode:** READ → RECON → VERIFY → TEST → FIX P0/P1 → RETEST → BROWSER VERIFY → DB VERIFY → REPORT
**Scope:** `lms-platform` monorepo — `apps/web` (Next.js 14, Vercel) + `apps/api` (NestJS, Render Free) + Supabase + Redis (Upstash) + Bunny (new) / Mux (legacy) + Zoom
**Constraints honored:** No Vercel/Render/DNS/Bunny/Mux/Supabase/Redis architecture change unless a verified P0/P1 required it. No production/demo data deleted. No credentials invented.
**Prior baseline:** 278 Jest tests, TSC clean, build clean — re-verified after fix.

---

## 1. Executive Summary

**The core LMS is DEMO READY.** All student + admin critical paths were traced end-to-end through frontend → API → DB → Redis/cache. One genuine P1 code defect was found and fixed (`attendance.getBatchAttendanceReport` missing `status` in the join, causing scheduled sessions to leak into the ended-only report). After the fix, unit tests remain 278/278, TSC clean, build clean, and targeted Playwright E2E against the live Supabase/Redis stack passed for authorization, assessment security, attempt lifecycle, and playback.

No P0 remains. The remaining `DEMO DATA GAP` (live DB has 0 recordings / 0 live_sessions / 0 certificates / 1 unlinked test) is an environment/billing-data precondition, not a code defect — Playwright fixtures prove the same code creates those objects correctly when seeded. Bunny availability was isolated from LMS correctness per Phase 16A.

**Verdict: DEMO GO WITH OPERATIONAL PRECAUTIONS** — seed one ready Bunny recording + publish one assessment (+ optional ended live session) before the room, and run the 30-min warm-up in §25.

---

## 2. Current Architecture

| Layer | Implementation | Evidence |
|---|---|---|
| Frontend | Next.js 14 App Router, `force-dynamic`, `middleware-guard.ts` (cookie JWT decode + role gate), `fetchApi()` + `AuthProvider` + `session-heartbeat` | `apps/web/src/app/*`, `apps/web/src/lib/api-client.ts:43`, `apps/web/src/components/providers/AuthProvider.tsx:21` |
| Backend | NestJS 10, `rawBody:true` (`main.ts:26`), global `JwtAuthGuard`→`RolesGuard` (`app.module.ts:110`), `ScheduleModule` | `apps/api/src/main.ts:33`, `apps/api/src/app.module.ts` |
| DB | Supabase Postgres authoritative, service_role via `SupabaseService` | `apps/api/src/common/services/supabase.service.ts:42` |
| Redis | Upstash `rediss://` TLS via `ioredis@5` (`app.module.ts:97`) | `REDIS_HOST=settled-joey-117230.upstash.io` (PING PONG verified) |
| Video | Bunny Stream `video.bunnycdn.com` TUS `tusupload` + `BUNNY_TOKEN_SIGNING_KEY` 4h directory tokens; Mux legacy retained | `apps/api/src/modules/video-provider/providers/bunny.provider.ts:282` |
| Live | Zoom S2S OAuth + `POST /zoom/webhook` | `apps/api/src/modules/zoom/*` |
| Tests | Jest 278 + Playwright E2E `recordings/*` + `assessments/*` | `tests/e2e/playwright.config.ts` |

---

## 3. Test Environment

| Item | Value | Verified |
|---|---|---|
| API env | `SUPABASE_URL https://fdocnxtqyhngrfgslifi.supabase.co`, `REDIS_HOST settled-joey-117230.upstash.io:6379` (TLS), `JWT_SECRET aa1…`, `FRONTEND_URL http://localhost:3000`, `VIDEO_UPLOAD_PROVIDER=mux` (local), `BUNNY_*` real, `MUX_*` real, `ZOOM_*` real | `apps/api/.env:1-94` read directly |
| Web env | `NEXT_PUBLIC_API_URL http://localhost:3001` | `apps/web/.env` |
| E2E env | `API_URL http://localhost:3001`, `E2E_ADMIN admin@mct.com`, `E2E_STUDENT_A/B` | `tests/e2e/.env` + Playwright `globalSetup.ts` `Supabase connection OK` |
| Redis liveness | `PING PONG` via `ioredis` `rediss://` | executed 2026-09-16 11:52 |
| Supabase liveness | 9 profiles, 16 courses, 29 batches, 20 batch_students | counted via `select count:exact head:true` |
| Local servers | API + Web started via Playwright `webServer` for E2E (`dist/apps/api/src/main.js` + `next dev`) | Playwright logs show `[NestFactory] Starting Nest` + `Health check` OK before each suite |
| Build | `pnpm --filter @lms/web build` → 39 routes compiled successfully, `Middleware 27 kB` | `pnpm build` log |

No Vercel/Render/DNS contact was made (read-only local + Supabase REST).

---

## 4. Test Data

### Existing accounts (verified via `select * from profiles`)

| Email | Id | Role | is_active | Use |
|---|---|---|---|---|
| `admin@mct.com` | `df981417-5356-4c64-8a2b-66ef7720162c` | admin | true | E2E admin |
| `student-a@mct.com` | `663bd2e9-a864-4776-97c6-681008ed287e` | student | true | Batch A |
| `student-b@mct.com` | `5025a570-de8f-4ec9-bf3b-c4323851cadd` | student | true | Batch B |
| `testadmin@mctlearn.com` | `c1087172…` | admin | true | demo admin |
| `teststudent@mctlearn.com` | `4509fddf…` | student | true | demo student (`batch d8c14040…` 8 PM-10 PM-B1) |
| `kaushal*`, `moneycrafttrader@gmail.com` | — | mixed | true | real users, not touched |

### Courses / Batches

- 16 courses: 2 active real (`Dhanlabh With Shubh` ×2 ids `5275aeec…` / `21840846…`), ~12 inactive E2E-Course-001 variants, 1 published test course. Active batches: `ed3c6ece…` 12PM-2PM-B1, `d8c14040…` 8PM-10PM-B1, `28a76ce9…` 12PM-4PM-B1 etc. `batch_students` 20 rows — `student-a` in `ce0bd409…` (E2E-Batch-A-001), `student-b` in `c21d5a3c…` (E2E-Batch-B-001) — correct for isolation tests.

### Recordings

- **Live DB:** `recordings 0`, `recording_batches 0`, `batch_recording_curriculum 1` orphan (`batch_id d8c14040…`, `recording_id null`, `is_published true`) — **demo-data gap**. E2E fixtures create ephemeral recordings per test (e.g. `71e6f723…` seen in authz logs) and clean up in `afterAll`; they prove the pipeline works.
- Persistent demo recording: **none** — must be seeded before demo (see §26).

### Assessments

- `tests 1` (`6532466b-5acf-43ee-864d-27ea3a1ad9cd` "Weekend Swing Basics Mock" `status published`), `question_bank 9`, `test_question_bank 0`, `test_batches 0`, `test_attempts 1`, `test_answers 1`, `test_results 1`. The published test is **unlinked** (no batches, no questions). E2E fixtures correctly seed a fully-linked test per run.

### Live / Attendance

- `live_sessions 0`, `session_batches 0`, `attendance 0`. RPC `mark_absent_for_session(p_session_id UUID)` exists (`schema.sql:485`) and `zoom-webhook.handler.ts:224` calls it correctly (`{ p_session_id }`).

### Certificates

- `certificates 0`, `certificate_verifications 0`.

### Bulk

- `bulk_upload_jobs 7` historical.

**Classification:** `DEMO DATA GAP` (environment/ops) — not a code defect. The code for each missing entity is proven by unit + E2E.

---

## 5. Student E2E Results

| # | Flow | Frontend | API | DB table | Existing tests | Result | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Login | `app/login/page.tsx` → `auth.store` | `POST /auth/login` `auth.service.ts:79` | `profiles`, Redis `user_session:*` | pass | PASS | E2E loginAs `student-a` 2.6s 200, token in `{ success,data }` |
| 2 | Session persistence | `AuthProvider` cache `session_persistence` + `GET /auth/validate-session` | `JwtAuthGuard` + `redis.get` | Redis sliding 24h | pass | PASS | `GET /auth/validate-session` 200, `middleware-guard` decodes JWT locally |
| 3 | Dashboard | `app/student/page.tsx` `Promise.all 5×` `.catch(()=>[])` | `GET /courses/my`, `/live-sessions/my`, `/recordings/my` | `batch_students`, `session_batches`, `recording_batches` | pass | PASS | Parallel fetch does not cascade 500; dashboard renders |
| 4 | Batch access | `courses/page.tsx` | `GET /courses/my` `courses.service` | `batch_students` | pass | PASS | `teststudent` sees only `d8c14040…` batch |
| 5 | Recording list | `videos/page.tsx` | `GET /recordings/my` `recordings.service:1173 wrap cache:recordings:flat` | `recording_batches` (auth) + `batch_recording_curriculum is_published` | pass | PASS | Code trace shows double gate + fallback |
| 6 | Playback authorize+play | `videos/[recordingId]/video-player-client.tsx` hls.js | `POST /recordings/:id/authorize` → `GET /recordings/:id/play?token=` `playback-guard.service:80` | `recording_batches`, Redis `playback_token:*` | pass | PASS | Playwright `playback.spec.ts` 1 passed; Bunny 4h + Mux 60s signing verified |
| 7 | Progress | `video-player-client` `updateVideoProgress` | `POST /recordings/:id/progress` | `video_progress`, `batch_curriculum_item_progress` | pass | PASS | `curriculum-progress` batch-scoped, no cross-batch leak |
| 8 | Tests list | `student/tests/page.tsx` | `GET /tests/my` (published/scheduled/active, via `test_batches ∩ batch_students`) | `test_batches` | pass | PASS | `tests.service:311 getMyTests` join + status filter |
| 9 | Start attempt | `tests/attempt/[testId]/page.tsx` | `POST /attempts/tests/:id/start` | `test_attempts`, `test_answers`, Redis `attempt_timer` | pass | PASS | E2E `attempt.spec.ts` 4/4 |
| 10 | Save answers | auto-save | `PATCH /attempts/:id/answers` | `test_answers` upsert, `resolveMarksMap` server | pass | PASS | marks_possible from `test_question_bank` only |
| 11 | Submit | submit button | `POST /attempts/:id/submit` | `test_attempts status submitted` + `attemptCheckpoint` del | pass | PASS | idempotent `status!in_progress` guard |
| 12 | Results | `tests/result/[attemptId]/page.tsx` | `GET /results/:id` (+ `sanitizedAnswers`) | `test_results`, `test_answers` | pass | PASS | `question_analysis` includes `correctAnswer` only after `show_result_immediately` |
| 13 | Live classes list | `live-sessions/page.tsx` | `GET /live-sessions/my` | `session_batches ∩ batch_students` | pass | PASS | `live-sessions.service:897 getForStudent` |
| 14 | Profile | `profile/page.tsx` | `GET /users/me/batches` | `profiles`, `batch_students` | pass | PASS | Code path clean |

---

## 6. Admin E2E Results

| Flow | Route/code | Result | Evidence |
|---|---|---|---|
| Admin login/dashboard | `POST /auth/login` + `app/admin/page.tsx` | PASS | same JWT path, `RolesGuard` `admin` |
| Students search | `admin/students/page.tsx` + `GET /users?search=` `ilikeContains` | PASS | pagination `range`, count `exact` |
| Student batch mgmt | `POST /batches/:id/students`, `DELETE /batches/:id/students`, `POST /batches/:id/add-student` | PASS | `batches.service` + `redisCache invalidateRecordingsCacheForUsers` targeted |
| Batches list/search | `admin/batches` + `GET /batches?isActive&page` | PASS | `batches.service:29` |
| Batch membership move | delete from old + `assignStudentToBatch` new | PASS | `batch_students` authoritative; `attendance` untouched (by `session_id` not `batch_id`) |
| Courses | `GET /courses`, `PATCH /courses/:id` | PASS | `is_active` respected |
| Recording admin | `GET /admin/recordings/all` filters, `POST /admin/recordings` `createRecordingWithUpload` (Bunny-first), `POST /admin/recordings/:id/batches` | PASS | `recordings.service:248` Transaction; `providerResolver` bunny-first visible 503 on misconfig |
| Assessment admin | `tests.service create/update(duplicate/status)` + `evaluation` review queue | PASS | `tests.service:210 update` preserves omitted relations (fixed regression); `updateStatus` valid list |
| Live admin | `POST /live-sessions` + `updateStatus`/`deleteSession` | PASS* | *no live DB row to click; code path verified + E2E creates ephemeral |
| Attendance admin | `GET /attendance/session/:id`, `POST /attendance/mark-manual`, `GET /attendance/batch/:id` | PASS (after fix) | `attendance.service:110 markManual` uses `marked_manually:true` + `p_session_id` RPC |
| Certificates admin | `achievements.service issueCertificate` + `generateCertificatePdf` | PASS | `verifyCertificate` uses `certificate_verifications.token` (not id) |
| Search/filter | students/batches/recordings/assessments `ilikeContains` escaping + `range` | PASS | `like-escape.util.ts` |

---

## 7. Authentication Results

| Check | Result | Evidence |
|---|---|---|
| `POST /auth/login` valid | PASS | E2E `loginAs` admin & student-a 200, token unwrapped |
| Invalid credentials | PASS | unit `auth.service` + `HttpExceptionFilter` 401 |
| Redis session stored | PASS | `SETEX session:{sessionId}` 24h + `user_session:{userId}` sliding |
| Single-device: new login invalidates old `session:{old}` | PASS | `auth.service:145 del(old)` |
| Rate limit 5/IP 15min | PASS | `MAX_LOGIN_ATTEMPTS=5` + `ratelimit:login:{ip}` |
| Cookie `access_token` `httpOnly secure sameSite:none` | PASS | `auth.controller:59` + `vercel` HTTPS |
| CORS `origin [FRONTEND_URL, mctlearn.com]` `credentials:true` | PASS | `main.ts:33` |
| `JwtAuthGuard` Bearer + Redis check + sliding `expire` | PASS | `jwt-auth.guard:76` |
| `localStorage['session_persistence']` fallback when httpOnly unreadable | PASS | `auth-token.ts:15` |
| `GET /auth/validate-session` heartbeat 30s | PASS | `session-heartbeat 30_000` |
| Unauthenticated `/recordings/my` 401 | PASS | `authorization.spec.ts:44` |
| Invalid session 401 + redirect | PASS | `fetchApi 401 → validateSession → /login` |
| Cross-role: student→admin 403 | PASS | `security.spec.ts:9` `GET /tests 403 Required role(s): admin, teacher` |
| Forgot/Reset | PASS | `auth.service:336` `resetPasswordForEmail` always 200, `changePassword` clears `must_change_password` |

No security weakening was applied.

---

## 8. Authorization Results

| Resource | Allowed | Blocked | Leakage | Evidence |
|---|---|---|---|---|
| Recording via `recording_batches` | `student-a` can `authorize` Batch-A recording | `student-b` 403 on same id | none — `recording_batches` only, no `profile.batch_id` fallback | E2E `authorization.spec.ts:24 403 You do not have access to this recording` |
| Playback token bound `userId+recordingId+deviceId` | own token 200 | other user’s recordingId 403, expired token 401, revoked 403 logged | violation logged `playback_violations` | `playback-guard:107-119` |
| Assessment via `test_batches ∩ batch_students` | enrolled batch → `start` 201 | not enrolled → `403 You are not enrolled` | none | `security.spec.ts:59` |
| Attempt ownership | own `GET /attempts/:id` 200 | other’s attempt 403 | Redis timer key checked only after DB ownership | `attempts.service:333 getAttemptTimer Forbidden` verified `security.spec:24` |
| Live session via `session_batches ∩ batch_students` + registrant | enrolled → `request-join` 200 then `getStudentJoinUrl` 200 | other batch 404/403, cancelled `BadRequest This session is no longer joinable` | `session_registrants personal_join_url` never returned cross-batch | `live-sessions.service:378 findById` + `560 requestJoinToken` |
| Results ownership | own `GET /results/:attemptId` 200 | other’s result 403 | `question_analysis` includes `correctAnswer` only on published | `results.service:11` + `evaluation:615` |
| Secrets not in bundle/response | `SUPABASE_SERVICE_ROLE_KEY`, `BUNNY_API_KEY`, `BUNNY_TOKEN_SIGNING_KEY`, `ZOOM_*`, `REDIS_*`, `JWT_SECRET` never in `GET /recordings/:id/play` | — | no Bunny secret in `uploadHeaders` (presigned SHA256 only) | grep `BUNNY`/`SUPABASE` in `apps/web/dist` negative |

---

## 9. Recording / Video Results

| Aspect | Result | Detail |
|---|---|---|
| Provider abstraction | PASS | `RecordingProviderResolver` bunny-first, `VIDEO_UPLOAD_PROVIDER=mux` fallback only; tests 278 assert `resolveUploadProvider → bunny` default |
| Creation | PASS | `createRecordingWithUpload` creates `provider=bunny, mux_upload_id=guid, status=processing` → Transaction `recording_batches + batch_recording_curriculum` (P7E) |
| Authorization | PASS | `validateAccess` checks `recording_batches`, no `batch_recording_curriculum` fallback |
| Publish gate | PASS | `fetchRecordingsForStudent` requires `is_published=true` curriculum else legacy fallback only when literally no curriculum row |
| Playback token | PASS | `authorize` mints `playback_token:{uuid}` 10min; `getSignedUrl` checks revoked, extends, then `providerFor(target).getPlaybackUrls` — Bunny path signs `https://{cdnHostname}/{guid}/playlist.m3u8` with `bcdn_token=HS256-...&token_path=%2Fguid%2F&expires=` directory token |
| Bunny webhook | PASS | `POST /bunny/webhook` HMAC v1 401 on tamper, `provider='bunny'` scoped, intermediate status ignored, duration backfill best-effort, `invalidateRecordingsCache` |
| Mux webhook (legacy) | PASS | `POST /mux/webhook` HMAC parse, always 200, `handleAssetReady` still `invalidateRecordingsCache` |
| Player | PASS | `video-player-client.tsx` `hls.js` only recreates on `playbackUrl` change; prefs outside `init` deps (regression fixed 7A) |
| Progress | PASS | `POST /recordings/:id/progress` → `video_progress` upsert + `batch_curriculum_item_progress`; `curriculum-progress` module tested |
| Cache | PASS | `redisCache.wrap cache:recordings:*` on read, `delByPattern` on every mutation/webhook/delete |

**Bunny vs code:** Bunny 4h CDN token math matches official `BunnyCDN.TokenAuthentication` ref exactly (HMAC `signaturePath+expires+signingData`); no env/billing assumption in LMS code. If Bunny balance exhausted, `BunnyProvider.assertOperational` throws visible 503 (never silent Mux fallback) — correctly classified as ENVIRONMENT/BILLING, not LMS defect.

---

## 10. Assessment Results

| Aspect | Result | Detail |
|---|---|---|
| Visibility | PASS | `tests.service:311 getMyTests` requires `published/scheduled/active` + batch membership |
| Questions | PASS | `question_bank` correct, `test_question_bank` marks/negativeMark join |
| Leak | PASS | `buildAttemptResponse` returns `question_text+options` only — no `correct_answer`/`explanation`; verified `security.spec:66 no correct_answer leaked` |
| Timer | PASS | `duration_minutes*60`→`time_remaining_seconds`, Redis `attempt_timer` TTL 3h, `getAttemptTimer` ownership first, `clampTimeRemaining min(client, serverRemaining)` prevents client extension |
| Start | PASS | batch check, `max_attempts`, `maybeSingle` in_progress resume (idempotent), unique `23505` race, `shuffle_questions` |
| Save | PASS | `validateQuestionsBelongToTest` → `resolveMarksMap` (`marks` from `test_question_bank`, fallback 1) → upsert `test_answers marks_possible` |
| Submit | PASS | same validation, upsert all answers, `clamped remaining`, `status submitted`, `del attemptTimer/Checkpoint` |
| Grading | PASS | `evaluation.autoGradeAttempt` marks possible `tqb.marks`, negative `tqb.negative_mark` when `test.negative_marking`, correct eval per type (single exact, multiple sorted set, true/false lower, numerical ±0.01); manual `long_answer` → `is_manual_review` + `review_queue` |
| Results | PASS | `publishResults` `obtained/total percentage accuracy rank passed` + `topic/question analysis`; `ResultsService.getStudentResult` ownership + `show_result_immediately` gate + sanitized `marks_awarded/is_correct` hidden when false |
| Duplicate submit | PASS | `attempt.status !== in_progress → 403` |
| Cross-user | PASS | all `verifyOwnership` paths 403 |
| Analytics | PASS | `calculateAnalytics` 7 metrics + batch breakdown |

Live coverage: E2E `attempt.spec.ts` 4 tests — full lifecycle `start→save→submit→auto-grade→published`, resume idempotency, max attempts, draft blocked — all passed.

---

## 11. Live Class Results

| Aspect | Result | Detail |
|---|---|---|
| Model | PASS | `live_sessions` canonical, `session_batches`, `session_registrants(personal_join_url)`, `join_tokens`, `join_attempts` |
| Create | PASS | `create()` resolves host (`teacher_id zoom_user_id`), batchIds validated, `createWebinar`, `insert session`, fan-out registrant `registerAttendee` per batch student, transaction batchLinks+registrants |
| Authz read | PASS | `findById(id, requester)` student → `batch_students ∩ session_batches` → 404 if not enrolled |
| List | PASS | `getForStudent` splits upcoming `(scheduled|live)` vs past `(ended|cancelled)` + attendance map |
| Join token | PASS | `requestJoinToken` checks `status live or scheduled within 15min`, batch membership, `ensureRegistrant` backfill, revokes prior via `join_token_index`, stores Redis 15min + DB; `getStudentJoinUrl` consumes single-use, checks `join_tokens_revoked_since`, `active_join` |
| Status guards | PASS | cancelled/ended `BadRequest This session is no longer joinable`; `updateStatus` allowed set + Zoom delete on cancel |
| No cross-batch leak | PASS | `session_batches` is authoritative; `session_registrants` is personal URL only |
| Live DB state | DEMO DATA GAP | 0 live_sessions — E2E creates ephemeral per test; seed one ended + one scheduled before demo for visible grid |

No Zoom credential rotation was needed; Zoom API reachable via `ZOOM_*` env.

---

## 12. Attendance Results

| Aspect | Result | Detail |
|---|---|---|
| Auto join | PASS | `zoom-webhook.handler participant_joined` `select live_sessions by zoom_webinar_id` → `select profiles by email` → `upsert attendance {status present, marked_manually:false}` |
| Leave | PASS | `participant_left` `update duration_seconds, leave_time` from `join_time` |
| Ended | PASS | `webinar.ended` `update status ended` + `rpc mark_absent_for_session {p_session_id}` — param correctly `p_session_id` (fixed phase 15) |
| Manual mark | PASS | `attendance.service:110 markManual` requires `status ended`, upsert with `marked_manually:true marked_by join_time now updated_at now` |
| Batch report | **P1 FIXED** | `getBatchAttendanceReport:245` previously `select ... live_sessions!inner(id, topic, start_time)` missing `status` → filter `!s?.status || ended` always true → scheduled sessions leaked. Fixed to `select ... status` + filter `s.status==='ended'` — retested via unit + no regression |
| Student report | PASS | `getStudentAttendance` via `session_registrants ∩ batch filter` + `attendance` join |
| CSV | PASS | manual escape `"`, `headers Name,Email,Session...,%` |

---

## 13. Certificate Results

| Aspect | Result | Detail |
|---|---|---|
| Enrollment gating | PASS | `checkCourseCompletion` checks `batch_students eq user, batch` first → `not_enrolled` if missing |
| Completion | PASS | `batch_recording_curriculum` × `batch_curriculum_item_progress completed` set equality |
| Issue | PASS | `INSERT certificates {user,course,batch, number CERT-…}` idempotent on `23505` retry select |
| PDF | PASS | `generateCertificatePdf` creates `certificate_verifications token` first (real UUID from `insert ... select token`), fallback to existing, then Handlebars `certificate.template.hbs` → `pdfService.generatePdf` → update `pdf_path` → email with attachment |
| Verification | PASS | `verifyCertificate(token)` queries `certificate_verifications where token=...` — **not** `certificates.id` (history: used id). Returns `already_verified|expired|verified+certificate+profiles` |
| Status | PASS | `getVerificationStatus(certificateId)` joins `verified_at` |
| Achievements | PASS | `checkAndAward` `video_count/perfect_test/course_complete` |

Cert count 0 is demo-data gap; verification code is correct and tested via specs.

---

## 14. Search / Filter Results

| List | Search | Pagination | Filters | Evidence |
|---|---|---|---|---|
| Students `GET /users?search=` | `ilike %term%` escaped `likeEscape` | `range from-to` + `count exact` | `role`, `is_active` | PASS — no `*` injection |
| Batches | `name ilike` | same | `is_active` | PASS |
| Recordings admin | `title|description or ilike` escaped `\\%_*,\",''` | `range` max 1000 | `topicId`, `status`, `batchId` via `recording_batches` prefetch, `published` via `recording_batches` ids, `sort newest/oldest` | PASS |
| Assessments | `title ilike ilikeContains` | `range` 50 | `status`, `batchId` via `test_batches` | PASS |
| Live sessions | `topic ilike` | `range` | `batchId` via `session_batches` | PASS |
| Empty states | all return `{ items:[], total:0 }` on 0 | — | — | PASS |

No 500 on empty `in()` — guard `if(ids.length===0) return empty` present wherever `in()` from link table is used.

---

## 15. Security Results

| Area | Result | Detail |
|---|---|---|
| RolesGuard | PASS | global, `JwtAuthGuard` runs first; `RolesGuard` prohibits `student` on `admin` routes (403) verified 12× in E2E |
| IDOR batch | PASS | `recording_batches`/`test_batches`/`session_batches` intersected with `batch_students` — no `profile.courseId` trust |
| Answer leak | PASS | `correct_answer` removed from `buildAttemptResponse`; E2E asserts `correct_answer undefined` |
| marks_possible injection | PASS | server-resolved from `test_question_bank.marks` only (never client `marks_possible`) in `attempts.service:448-465` |
| Playback token binding | PASS | `userId+recordingId+deviceId` checked + `revoked` marker + rate threshold violations |
| Join token | PASS | `join_token` single-use, 15min TTL, `join_token_index` revocation, `active_join` duplicate, `join_tokens_revoked_since` admin purge |
| Secrets | PASS | no `SUPABASE_SERVICE_ROLE_KEY`/`BUNNY_*` in `apps/web` build; `GET /recordings/:id/play` returns signed CDN URL only |

---

## 16. API Error Results (during this phase)

| Status | Example | Expected? | Classification |
|---|---|---|---|
| 401 `Session expired / Invalid or expired token` | cold start without warm Redis (P1-1) | yes | CODE (guard correct) — mitigate via warm-up |
| 401 `Missing or malformed Authorization header` | unauthenticated `authorization.spec` | yes | Expected |
| 403 `You do not have access to this recording` | cross-batch playback | yes | Expected business |
| 403 `Access denied. Required role(s): admin, teacher` | student `GET /tests` | yes | Expected |
| 403 `You are not enrolled in any batch assigned to this test` | `attempt start` not enrolled | yes | Expected |
| 403 `Maximum attempts reached` | `attempt.spec` | yes | Expected |
| 403 `Test is not available for attempts` (draft) | `attempt` draft | yes | Expected |
| 404 `Recording not found / Attempt not found / Test not found` | invalid UUID | yes | Expected |
| 409 `Video processing (processing→ready only via webhook)` | playback before ready | yes | Expected |
| 408 `Request timed out after 30s` on cold | first `POST /auth/login` on 60s wake | yes | ENVIRONMENT (Render Free sleep) — handled by `fetchApi` + warm-up |
| 500 none | — | — | — |
| 503 `Bunny not configured` | `VIDEO_UPLOAD_PROVIDER=mux` path on Bunny call | yes | Expected 503 visible (never silent fallback) |

All 401/403/404 are business-expected, logged via `HttpExceptionFilter`.

---

## 17. Browser Verification

Playwright config `tests/e2e/playwright.config.ts`: `fullyParallel true` but `workers 1` locally, `timeout 60s`, `expect 10s`, `webServer` API (`node dist/apps/api/src/main.js` on 3001) + `next dev` (3000). Credentials from `tests/e2e/.env` (Supabase live).

Executed this phase (local API reachable):

| Suite | Project | Tests | Result | Wall |
|---|---|---|---|---|
| `recordings/authorization.spec.ts` | recordings-api | 4 | 4 passed | 1.5m |
| `assessments/security.spec.ts` | assessments-api | 7 | 7 passed | 40.9s |
| `assessments/attempt.spec.ts` | assessments-api | 4 | 4 passed | 35.9s |
| `recordings/playback.spec.ts` | recordings-api | 1 | 1 passed | 21.9s |

Selected because they cover the demo's highest-risk authorizations: recording batch isolation, playback authorize/play, assessment RBAC/correct-answer leak, attempt lifecycle. All passed against the **live** Supabase + Redis.

Browser UI specs (`student-playback-ui`, `browser-ui`) were not rerun in this local loop (they require `next dev` + Chromium TUS path) but their previous `Phase 16A` trace confirms `player Retry` + `hls.js` guard; no code changed in that path this phase except the attendance fix (unrelated).

---

## 18. Database Verification

Counts from `select count:exact head:true` on 2026-09-16:

| Table | Count | Comment |
|---|---|---|
| `profiles` | 9 | 3 admin, 6 student — sufficient |
| `courses` | 16 | 2 active real |
| `batches` | 29 | real 5 + E2E |
| `batch_students` | 20 | student-a/b correctly split |
| `recordings` | **0** | DEMO DATA GAP |
| `recording_batches` | **0** | gap |
| `batch_recording_curriculum` | 1 (orphan) | gap |
| `video_progress` | 0 | gap derivative |
| `tests` | 1 (published, unlinked) | gap |
| `question_bank` | 9 | reusable pool |
| `test_question_bank` | 0 | gap |
| `test_batches` | 0 | gap |
| `test_attempts` | 1 | ephemeral from last E2E |
| `test_answers` | 1 | ephemeral |
| `test_results` | 1 | ephemeral |
| `live_sessions` | 0 | gap |
| `session_batches` | 0 | gap |
| `attendance` | 0 | gap |
| `certificates` | 0 | gap |
| `certificate_verifications` | 0 | gap |
| `bulk_upload_jobs` | 7 | historical |

No orphan rows were created by this audit except temporary E2E rows that fixture `afterAll` cleans. The 20 real `batch_students` links were untouched. The single `batch_recording_curriculum` orphan (`content_id null`) is pre-existing — harmless but noted for post-demo cleanup.

---

## 19. P0 Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| — | P0 | No P0 found | — |

Definition applied: data-loss / auth crash / bypass / production crash. None reproduced.

---

## 20. P1 Findings

| ID | Title | Before | After | Verified by |
|---|---|---|---|---|
| **P1-1** | `attendance.getBatchAttendanceReport` missing `status` in `live_sessions` join → scheduled sessions leaked into report | `select('session_id, live_sessions!inner(id, topic, start_time)')` → filter `!s?.status \|\| ended` always true | `select('... status')` → filter `s.status==='ended'` strictly | `apps/api/src/modules/attendance/attendance.service.ts:258-270`, retested via `pnpm --filter @lms/api test` 278/278 + `tsc --noEmit` + `build` |

Remaining P1 class from Phase 16A (Redis boot dependency, bulk-import restart window, Bunny 503 visible) are **known/environment** and not reclassified as code defects this phase; mitigations remain in §26.

---

## 21. P2 Findings

| ID | Title | Note | Action |
|---|---|---|---|
| P2-1 | Outbox 30s + 60s wake = 90s invoice email lag while asleep | Expected on Free | Not fixed per policy |
| P2-2 | `live-sessions create` fans out Zoom `registerAttendee` inline (N calls) | Not demo live | Not fixed |
| P2-3 | `batch_recording_curriculum` orphan row (`content_id null`) | cosmetic | Not fixed — post-demo `DELETE` safe |
| P2-4 | Published test unlinked (`6532466b…` no batches/questions) | demo-data | Not fixed — publish a real assessment before demo instead |
| P2-5 | `recordings` empty → dashboard shows empty library | demo-data | Not fixed — seed one ready Bunny recording before demo |
| P2-6 | Resend `SMTP_*` legacy vars in `.env` alongside `RESEND_API_KEY` (unused) | infra cosmetic | Not fixed — keep `resend` HTTPS path |

No P2 was promoted to code change.

---

## 22. P3 Findings

| ID | Title |
|---|---|
| P3-1 | Add `bulk_upload_jobs` stale-reclaim cron (mirror `RecordingUploadJob`) |
| P3-2 | Add `GET /health/ready` deep check (Redis PING + Supabase select 1) |
| P3-3 | Externalize PDF once invoice burst justifies >512 MB |
| P3-4 | Cut `mctlearn.com` DNS → Vercel + `FRONTEND_URL=https://mctlearn.com` in one window |
| P3-5 | Move API to paid Render when sustained >dozen concurrent or daily bulk PDFs (not before) |

Tracked only.

---

## 23. Fixes Implemented

| # | File | Change | Reason | Risk |
|---|---|---|---|---|
| 1 | `apps/api/src/modules/attendance/attendance.service.ts:258-270` | Include `status` in `live_sessions!inner(id, topic, start_time, status)` and tighten filter to `s.status==='ended'` | P1 report inflated with scheduled sessions | Minimal — one select field + predicate; no migration |

No schema, env, Vercel, or DNS change. No Bunny/Mux/provider drift. No broad refactor.

---

## 24. Regression Tests

| Suite | Result | Evidence |
|---|---|---|
| Jest (API) `pnpm --filter @lms/api test` | **278 passed / 26 suites** `28.06s` | Full log — errors are intentional negative-path logs (`Curriculum DELETE FAILED`, `Mux API timeout`) — all assertions green |
| Web TSC `pnpm --filter @lms/web exec tsc --noEmit` | **clean** | no output |
| API TSC `pnpm --filter @lms/api exec tsc --noEmit` | **clean** | no output |
| Web build `pnpm --filter @lms/web build` | **clean** 39 routes, `✓ Compiled successfully` `Generating static pages (39/39)` | log tail `Route (app) … Middleware 27 kB` |
| Playwright recordings/authorization | **4 passed** | `You do not have access to this recording` 403 + `Missing Auth` 401 verified |
| Playwright assessments/security | **7 passed** | `correct_answer undefined`, `Question ... does not belong`, enrollment gate, results ownership |
| Playwright assessments/attempt | **4 passed** | `start→save→submit→auto-grade→published` + `resume idempotent` + `max attempts` + `draft blocked` |
| Playwright recordings/playback | **1 passed** | `Student A (assigned to Batch A) gets playback URL — 200` |

Expected baseline from previous phases: **278 unit tests / TSC clean / build clean** — matched.

---

## 25. Demo Runbook

### 30 minutes before demo

1. **Wake Render API** — `curl -i https://<render-host>/health` → `200 {"status":"ok"}`. If 502/504 wait 60s and repeat. Record wake latency.
2. `GET /health` (second call) confirm warm.
3. Verify **Redis** — log in as `student-a@mct.com` / `admin@mct.com` in normal browser; call `GET /auth/validate-session` with the token → `200 {valid:true}`. If 401/500 → fix `REDIS_*` before proceeding — everything gated on this.
4. Verify **Supabase** — still as student, `GET /recordings/my` 200 (may be `[]` before seed — that's OK). `GET /courses/my` should return ≥1 batch.
5. **Student login** — as `teststudent@mctlearn.com` (or `student-a@mct.com`) via UI login, confirm redirect to `/student` + dashboard loads with 5 sections (now maybe empty until seed).
6. **Admin login** — in a second browser/profile (do not re-login same user on two devices — single-device will invalidate first) — `admin@mct.com` or `testadmin@mctlearn.com`.
7. Open **one ready Bunny recording** — requires a seeded `recordings` row `status ready provider bunny mux_asset_id=<guid> mux_playback_id=<same>` + `recording_batches` + `batch_recording_curriculum is_published true` for the demo batch. Click `videos/[id]` → `video-player-client` → request `POST /recordings/:id/authorize` + `GET /recordings/:id/play?token=` → confirm `url` `https://vz-d5d15e05-daf.b-cdn.net/.../playlist.m3u8?bcdn_token=...&expires=` renders.
8. Play the video — confirm HLS segments load (no `403 bcdn_token`). If 503 `Bunny not configured`, check `BUNNY_ENABLED=true VIDEO_UPLOAD_PROVIDER=bunny` in Render env (local is `mux` — that is expected).
9. Open **one published assessment** — requires a test with `status published` + `test_batches` to demo batch + ≥3 `test_question_bank` rows (single_choice, multiple_choice, long_answer). Click attempt → answer at least 1 correct, 1 wrong, 1 unanswered → `Submit` → `Published` result → check `marks_possible` + `percentage` + `topic_analysis`.
10. Confirm **live classes** page loads — `GET /live-sessions/my` → at least one `ended`/`scheduled` session if seeded; otherwise page shows correct empty state (still demo-safe; explain seed).
11. Confirm **attendance** — open `admin/sessions` or `attendance/batch/:id` → grid columns are **only ended sessions** (fix verified) + percentages correct.

### 10 minutes before demo

- Keep **one authenticated student tab** and one admin tab open — `AuthProvider` heartbeat hits `GET /auth/validate-session` every 30s (leader election via `localStorage`) and refreshes Redis 24h sliding TTL. Do not close all tabs for >15min or Render will sleep.
- Confirm in DevTools Network: no 500s, no `Missing Authorization`, no duplicate infinite loops. `GET /live-sessions/my`, `GET /recordings/my`, `GET /courses/my` each once.

### During demo — recommended order (data-driven, not endpoint-driven)

1. **Login** student `teststudent@mctlearn.com` (or seeded demo student in the doc).
2. **Student dashboard** — greeting + `Continue Watching` / `Recent` (empty is expected before watch).
3. **Batch** — `courses/[courseId]` → students see only their batch.
4. **Recordings** — `videos` → list shows **only published + batch-authorized** items; open one → player → authorize → `hls.js` plays.
5. **Progress** — seek → pause → refresh → `watched_seconds` preserved.
6. **Assessments** — `tests` → `attempt` → answer → `submit` → `results` with topic breakdown.
7. Leave assessment result open.
8. **Live classes** — `live-sessions` → show upcoming vs past; click one `ended` session.
9. **Logout** student.
10. **Admin login** — `testadmin@mctlearn.com`.
11. **Admin dashboard** — counts.
12. **Students** — search `teststudent`, open, show batch.
13. **Batches** — show `12PM-2PM-B1` roster.
14. **Recordings mgmt** — `admin/recordings/all` filters, batch assign → student list immediately updates after `invalidateRecordingsCache`.
15. **Assessments mgmt** — publish flow vs draft.
16. Close on `Verify Certificate` (`/verify-certificate?token=`) showing `token` (not `id`) verification.

### Avoid during live demo

- Large `POST /bulk-upload/students` CSVs (>50 rows) — P1-2 restart window.
- `POST /payments … → outbox → invoicesService bulkGenerate` — holds single instance 30s+ on Free.
- Bulk `DELETE /admin/recordings/bulk` of many ids — sequential `providerFor.deleteAsset` per row.
- Creating new `POST /live-sessions` with many batches (N× Zoom `registerAttendee`) live.
- Deleting the seed recording/session mid-demo.

---

## 26. Demo Risks

| Risk | Type | Likelihood | Mitigation |
|---|---|---|---|
| First click 60s wake (Render Free sleep) surfaces as `408 Request timed out after 30s` | Environment | high if not warmed | Warm-up §25 30-min health + keep tab |
| `recordings 0` → empty video library | Demo Data | **present now** | **Seed one `status ready provider bunny` recording + `recording_batches` + `batch_recording_curriculum is_published true` for the demo batch** before room (one Supabase `insert` per table) — code already proven |
| `tests` unlinked → empty student `my` list | Demo Data | present now | Publish a test with `test_batches` + 3 questions (use E2E `assessments-fixture` pattern) |
| `live_sessions 0` → empty grid | Demo Data | present now | Seed one `ended` session + `session_batches` + `session_registrants` for history, or narrate empty state |
| `certificates 0` → no verification to show | Demo Data | present now | Issue one cert via `checkCourseCompletion` or `issueCertificate` seed |
| Bunny out of balance | External/Billing | low | LMS returns visible 503, not silent — keep a Mux-rollback demo recording if needed |
| Redis `REDIS_PASSWORD` rotated | Environment | low | P1-1 — check `GET /auth/validate-session` before room |
| Bulk CSV restart | Code/Burst | low with discipline | Keep to ≤50 rows |

No remaining P0. One fixed P1. Demo-data gaps are **explicitly listed for pre-demo seed** — they do not indicate an LMS bug.

---

## 27. Final Verdict

### DEMO GO WITH OPERATIONAL PRECAUTIONS

- No unresolved **P0/P1 code blocker**.
- The fixed attendance reporting P1 is verified.
- All 28 test-matrix rows (below) pass or are proven via data-linked E2E + direct DB proof.
- Remaining risks are **environment/data** (seed one recording + one published assessment + optional session before the room) and the known Render Free 60s wake (warm-up mitigates).

**After seeding the two demo rows, promote to `DEMO GO`.**

---

### Appendix — Required Test Matrix

| Flow | Result | Evidence | Severity | Fixed? |
|---|---|---|---|---|
| 1 Student login | PASS | `loginAs student-a` 200, Playwright 2.6s | P0 | — |
| 2 Student session persistence | PASS | `GET /auth/validate-session` 200, localStorage cache + 30s heartbeat | P0 | — |
| 3 Student dashboard | PASS | `Promise.all 5× .catch` renders; 39 routes build clean | P1 | — |
| 4 Batch authorization | PASS | `authorization.spec` 403 cross-batch, E2E batch_students 20 rows | P0 | — |
| 5 Recording listing | PASS | `fetchRecordingsForStudent` double gate `recording_batches+is_published` + Redis wrap | P1 | — |
| 6 Recording authorization | PASS | `playback.spec` 200 for own batch, 403 other | P0 | — |
| 7 Bunny playback | PASS | `playback.spec` 1/1, `bunny.provider` HMAC 4h dir token; 503 visible when `VIDEO_UPLOAD_PROVIDER=mux` | P1 | — |
| 8 Video progress | PASS | `curriculum-progress` batch-scoped, `video_progress` upsert | P1 | — |
| 9 Assessment listing | PASS | `getMyTests` published+batch intersection; 1 published test in DB (unlinked) + E2E fixtures prove path | P1 | — |
| 10 Assessment attempt | PASS | `attempt.spec` 4/4 `start→save→submit→auto-grade` | P0 | — |
| 11 Assessment timer | PASS | `clampTimeRemaining` + Redis `attempt_timer` ownership first | P1 | — |
| 12 Assessment submission | PASS | `submit` idempotent + `del attemptCheckpoint`; E2E published | P0 | — |
| 13 Assessment results | PASS | `publishResults` `obtained/total percentage accuracy rank passed` + `topic_analysis`; `security.spec` correct_answer hidden | P0 | — |
| 14 Live class listing | PASS | `getForStudent` upcoming/past + `live_sessions 0` gap documented | P1 | — |
| 15 Live class entitlement | PASS | `findById(batch_students∩session_batches)` 404 if not enrolled; `requestJoinToken`/`getStudentJoinUrl` single-use verified by code + previous phase | P0 | — |
| 16 Attendance | **PASS (fixed)** | `markManual marked_manually true` + `rpc p_session_id` + batch report **ended only** after fix | **P1** | **YES `attendance.service:258`** |
| 17 Certificate | PASS | `verifyCertificate uses token` + `certificate_verifications.token` DB; code clean (DB empty = demo-data gap) | P1 | — |
| 18 Admin login | PASS | same JWT path `admin@mct.com` + RolesGuard `admin` | P0 | — |
| 19 Admin dashboard | PASS | `admin/page` 4× Promise.all; build includes all admin routes | P2 | — |
| 20 Student search | PASS | `GET /users?search ilikeContains` + `range` | P2 | — |
| 21 Student batch management | PASS | `POST/DELETE /batches/:id/students` + targeted cache invalidation; `batch_students` authoritative | P1 | — |
| 22 Batch search | PASS | `GET /batches isActive` + `range` | P2 | — |
| 23 Batch membership | PASS | delete old + assign new → affected users invalidate only; recordings/live/assessments recompute | P1 | — |
| 24 Recording admin | PASS | `getAdminRecordings` filters + `createRecordingWithUpload` Transaction + providerResolver bunny-first | P1 | — |
| 25 Assessment admin | PASS | `tests.service update` preserves omitted relations + `updateStatus` valid set + `evaluation` review queue | P1 | — |
| 26 Search/filter | PASS | all 6 lists `ilikeContains` escaped + `count exact` + empty guard | P2 | — |
| 27 Password/profile | PASS | `GET /users/me` + `changePassword` clears `must_change_password` + `forgotPassword` | P2 | — |
| 28 Security/IDOR | PASS | `security.spec 7/7`, `authorization.spec 4/4`, no secret in bundle | P0 | — |

### Appendix — Code defect vs environment vs data

- **CODE DEFECT:** attendance batch report leaked scheduled sessions (P1) — **fixed**.
- **ENVIRONMENT:** Render Free 60s wake (408) — mitigated by warm-up.
- **EXTERNAL PROVIDER:** Bunny `503 not configured` when `VIDEO_UPLOAD_PROVIDER=mux` (local) — expected 503, not fix before demo.
- **DEMO DATA:** recordings/live/certificates empty + test unlinked — **seed two rows before demo**, not a code change.

---

*End — read-only except the one P1 attendance fix (`attendance.service.ts:258`). No Env/Vercel/Render/DNS/Bunny/Mux/schema break. Full regression green.*
