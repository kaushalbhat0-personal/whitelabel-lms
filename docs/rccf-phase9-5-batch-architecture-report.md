# RCCF Phase 9.5 — Production Batch Structure Audit
## Dhanlabh with Shubh → Time-Slot LMS Batches → Student Import Readiness

**Phase:** 9.5 (Audit Only)
**Date:** 2026-09-15
**Scope:** READ → RECON → VERIFY → PLAN → REPORT — no code, no batches, no imports, no commits
**Branch:** `main` (hardening on top of Phase 9 CONDITIONAL GO)
**Verdict:** **CONDITIONAL GO** — architecture supports flat time-slot model; operational gaps must be mitigated before bulk import

---

## 1. Executive Summary

**Question:** Can `Dhanlabh with Shubh` remain the Course/Program concept and can the actual time-slot groups (`Weekday 12–2`, `Weekday 8–10`, `Weekend 12–4`) be plain flat `batches` rows without a parent→sub-batch hierarchy?

**Answer: YES — proven with evidence.**

- `courses` → `batches` is the only hierarchy in the system. `courses.id` `1—N` `batches.course_id` (`scripts/schema.sql:97-122`, `apps/api/src/modules/batches/batches.service.ts:89-99`). There is NO `batches.parent_id`, NO `batch_hierarchy`, NO `batch_groups` table. Every junction (`batch_students`, `session_batches`, `recording_batches`, `test_batches`, `batch_recording_curriculum`) points to a flat `batches.id` (`TABLES.*` in `common/constants/tables.constant.ts:1-14`).
- Student membership is **only** `batch_students(batch_id, user_id)` PK (`scripts/schema.sql:128-133`). `profiles` has NO `batch_id` (`mct-auth-authorization/SKILL.md:32` and `scripts/schema.sql:80-91` confirm the Phase-4 bug fix).
- Recording auth is **only** `recording_batches(recording_id, batch_id)` PK + `batch_recording_curriculum.is_published` display gate (`recordings.service.ts:360-465`, `docs/architecture/modules/recordings.md`). One `recordings` row → N `recording_batches` rows → ONE Bunny GUID. Adding a batch never uploads again.
- Live classes are `session_batches(session_id, batch_id)` PK, DTO `batchIds: string[] @ArrayMinSize(1)` (`live-sessions/dto/create-session.dto.ts:49-53`), and student view is `batch_students → session_batches → live_sessions` with `Set` dedup (`live-sessions.service.ts:805-881`). One session can natively target 1 or N time-slot batches.
- Assessments are `test_batches(test_id, batch_id) UNIQUE` (`migrations/013-assessment-engine.sql:106-111`) and attempt gate is `test_batches ∩ batch_students` at `startAttempt` (`attempts.service.ts:51-63`). Student can be in many batches (`batch_students` PK allows `user_id` duplicated across rows); this is used by `courses.service.ts:313-350 getCoursesForStudent` grouping and all student queries.
- Moving a student from `12–2` → `8–10` is a single `DELETE batch_students(12–2, user)` + `UPSERT batch_students(8–10, user)` (`batches.service.ts:253-267` + `218-251`). Recording/live/test visibility recomputes from the new `batch_students` set on next request (Redis `cache:recordings:*` 300s TTL; see §7 cache risk).

**What remains (conditional):** Batch naming ambiguity (`batches.schedule_type` is only `weekday|weekend|custom`, no `time_slot` column — `create-batch.dto.ts:26-30`, `shared-types/enums.ts:108-112`), broken search in `/admin/batches` (`batch-list.tsx:80` missing `searchKeys`), no `is_active` enforcement on attempt/recording reads, and `batch_students` mutations do not invalidate `cache:recordings:*` (hardening gap). Live DB + browser verification were **BLOCKED** (no live Supabase/dev server in this execution — see §§11-12). All gaps are operational, not architectural — no schema migration required for the flat model.

---

## 2. Current Batch Architecture (Recon A–L)

### A. `batches` table — exactly what it is

**File:** `scripts/schema.sql:111-125`
```sql
CREATE TABLE batches (
  id UUID PK DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schedule_type TEXT CHECK (schedule_type IN ('weekday','weekend','custom')),
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_batches_course ON batches(course_id);
CREATE INDEX idx_batches_active ON batches(is_active);
```

Evidence: single FK to `courses`, no `parent_batch_id`, no `program_id`, no time column beyond schedule_type/date. Drift note: `scripts/schema.sql` is stale for `test_batches` (not present) but `batches` DDL is current.

### B. Fields

See above. DTO `CreateBatchDto` (`apps/api/src/modules/batches/dto/create-batch.dto.ts:12-38`) enforces `courseId: @IsUUID`, `name: @MinLength(2) @MaxLength(100)`, `scheduleType?: @IsEnum(BatchScheduleType)` (`weekday|weekend|custom`), optional `description`, `startDate/endDate` as `YYYY-MM-DD`. Service only writes `course_id, name, description, schedule_type, start_date, end_date` (`batches.service.ts:101-112`). No slot, no capacity, no tier.

### C. Course/program relationship

**Exists and is exactly `courses 1—N batches`.** `courses` table (`scripts/schema.sql:97-106`) is `id, name, description, start_date, end_date, is_active`. `courses.service.ts:62` embeds `batches:batches(id, name, schedule_type, ...)` and `getCoursesForStudent:313-350` groups `batch_students → batches → courses`. `TABLES.COURSES:4`, `TABLES.BATCHES:5`. There is NO `programs` table — `course` is the program concept.

### D. `batch_id` on `profiles`?

**NO.** `scripts/schema.sql:80-91` `profiles` has `id, name, email, phone, role, zoom_user_id, is_active, must_change_password` — no `batch_id`. Skills `mct-auth-authorization:32` and `mct-schema-drift:21` explicitly document: *"There is NO profiles.batch_id. Batch membership lives ONLY in batch_students."* All services query junction (`evaluation.service.ts:755`, `results.service.ts:320` comments).

### E. One / multiple / historical batches per student

**Many-to-many, unlimited.** `batch_students PRIMARY KEY (batch_id, user_id)` (`scripts/schema.sql:132`) allows same `user_id` in N rows with different `batch_id`. No `UNIQUE(user_id)`. Indexes `idx_batch_students_user(user_id)` (`scripts/schema.sql:142` + `migrations/029-performance-indexes.sql:10-11`). Runtime aggregates:
- `courses.service.ts:322-332` groups `batch_students → courseMap` plural
- `live-sessions.service.ts:820-826` `const batchIds = memberships.map(...)` array
- `recordings.service.ts:1048-1068` same; `users.service.ts:65,99,321-346` maps `batch_students(batches(...))` to `batches: Batch[]`
- `shared-types/index.ts:76-86` `Batch` is flat; `Course` has `enrolledBatches?: Batch[]` per student.

Historical: no `batch_students.status` nor `enrolled_until`; removal is hard `DELETE` (`batches.service.ts:254-259`). History not retained unless logged via `system_events`.

### F. Parent/child relationship?

**None.** No `parent_batch_id` column, no adjacency table, no `batch_hierarchy` migration. Grep for `parent` in `apps/api/src/modules/batches/**` returns zero. `batches.course_id` is the only FK.

### G. Batch type/category field?

Only `schedule_type` (`weekday|weekend|custom`) + `description` + `start_date/end_date` + `is_active`. No `type`, `tier`, `cohort`, `capacity`, `price_tier`. Enum defined in `shared-types/enums.ts:108-112`.

### H. How admin creates/edits batches

`POST /batches` `CreateBatchDto` (`batches.controller.ts:46-48` → `batches.service.ts:86-130`): validates `courseId` exists + is_active, `INSERT batches`. `PATCH /batches/:id` (`batches.controller.ts:52-54` → `batches.service.ts:156-187`) allows `name, description, scheduleType, startDate, endDate`. `PATCH /batches/:id/reassign-course` (`batches.controller.ts:64-69` → `batches.service.ts:189-216`) moves batch between courses. UI: `components/admin/courses/batch-form.tsx:29-52` (name + schedule_type only), used from `batch-list.tsx:83-85` and `course-list.tsx:111`.

### I. How admin assigns student to batch

Four paths, all `batch_students` (`batches.service.ts`):
- `POST /batches/:id/students` `AssignStudentsDto studentIds: UUID[]` (`batches.controller.ts:73-76` → `batches.service.ts:218-251`): validate `role=STUDENT`, `UPSERT(batch_id,user_id) onConflict`.
- `POST /batches/:id/add-student` `AddStudentDto firstName,lastName,email,phone` (`batches.controller.ts:79-82` → `batches.service.ts:356-444`): `auth.admin.createUser` random 8-char pw → `INSERT profiles is_active=true must_change_password=true` (rollback `deleteUser` on profile fail) → `UPSERT batch_students`.
- `DELETE /batches/:id/students` `studentIds[]` (`batches.controller.ts:85-88` → `batches.service.ts:253-267`): `DELETE batch_students WHERE batch_id AND user_id IN (...)`.
- Bulk CSV/XLSX `POST /bulk-upload/students` (`bulk-upload.controller.ts:51-60` → `bulk-upload.service.ts:35-75`, `parseUsersFile` in `file-parser.util.ts:14-53`): columns `name,email,phone,courseName,batchName` + optional `dto.batchId/courseId`; `processJobInBackground CHUNK_SIZE=5`, per row `auth.admin.createUser` → `upsert profiles` → `lookupBatchByName(batchName ilike, scoped by courseName)` → `batchesService.assignStudentToBatch()` (non-fatal warning on miss). Jobs table `bulk_upload_jobs` status `processing→completed`.

All assignments are idempotent via `upsert onConflict batch_id,user_id`.

### J. How student portal determines batch

Never `profiles.batch_id`. Each portal reads `batch_students(user_id)`:
- Courses `GET /courses/my` → `courses.service.ts:313-350 getCoursesForStudent`
- Live sessions `GET /live-sessions/my` → `live-sessions.service.ts:805-881 getForStudent`
- Recordings `GET /recordings/my` and `/recordings/my/grouped` → `recordings.service.ts:1037-1147,1159-1295`
- `GET /users/me/batches` → `users.service.ts:321-346 getBatchesForUser` (role-aware branch).

### K. APIs exposing batches

- `GET /batches?isActive&page&limit` (`batches.controller.ts:26-37` → `batches.service.ts:29-56` includes `course:courses(id,name)`)
- `GET /batches/:id` with `studentCount/teacherCount` (`batches.controller.ts:40-43` → `batches.service.ts:58-84`)
- `GET /batches/:id/students?` and `GET /batches/:id/teachers`, `GET /batches/:id/sessions` (session_batches join)
- `GET /courses` and `GET /courses/:id` embedding `batches`, `GET /courses/my` for student, `GET /courses/:courseId/batches`, `GET /courses/:courseId/stats` (`courses.service.ts:246-260,262-311`)
- `GET /users/:id/batches`, `GET /users/me/batches` (`users.controller.ts:125-139`)
- `GET /courses/my`, `GET /live-sessions/my`, `GET /recordings/my` etc. all batch-derived.

### L. Authorization checks using `batch_id`

- Recordings: `recording_batches ∩ batch_students` + `status='ready'` + `is_published` (`recordings.service.ts:1044-1472 validateAccess 1320-1365`) — Phase-9 hardened.
- Live sessions: `session_batches ∩ batch_students` (`live-sessions.service.ts:805-848 getForStudent` and `attendance` + `zoom` guards).
- Assessments: `test_batches ∩ batch_students` at `startAttempt` (`attempts.service.ts:51-63` `testBatchIds.some(...)`), and listing `getMyTests:290-334`.
- Batch classroom: `batches` students/teachers guarded by `batch_students/batch_teachers`.

---

## 3. Course vs Batch (Important Decision)

**Already distinguished — course is program, batch is time-slot cohort.**

- `courses` = program-level concept (long-lived, named "Dhanlabh with Shubh"). `batches` = time-slot cohort under one `courses.id`. This matches the business decision `COURSE → Dhanlabh with Shubh → ACTUAL LMS BATCHES → Students`.
- No new table needed. Create **one** `courses` row `name='Dhanlabh with Shubh'` (via `POST /courses` `create-course.dto.ts:3-21` or existing if present) and create **N** `batches` rows with `course_id` = that course's `id`. Each batch's `name` holds the time-slot label (see §4).
- Student payments, invoices, receipts are already `course_id`-scoped (`schema.sql:189-287` `payment_plans.course_id`, `payments.course_id`), not `batch_id`-scoped — correct: a student pays for the program (course), attends one time-slot batch.

**Do NOT invent a `programs` table or a `parent_batch → sub_batch` table.** Grep for `programs` returns zero table. `batches.course_id ON DELETE CASCADE` already enforces cohort grouping; duplicating it with a hierarchy would require migrating `session_batches/recordings_batches/test_batches` to sub-batch ids.

**Recommendation:** Keep `Dhanlabh with Shubh` outside the batch authorization mechanism — exactly as a `courses` row. All authorization stays `batch_students` ↔ `*_batches` (already the skill-mandated pattern). No code change.

---

## 4. Time-Slot Batch Model

**Can the current `batches` model represent `Dhanlabh — Batch 1 — Weekday 12–2` etc. without a parent? YES — flat `name` + `schedule_type`.**

- Allowed names: `Dhanlabh with Shubh — Batch 1 — Weekday 12 PM–2 PM` (MinLength 2 MaxLength 100, `create-batch.dto.ts:16-18`). The string carries the generation (Batch 1/2) + day + hours. The `course_id` implicitly carries the program prefix if desired.
- Existing metadata: `schedule_type` captures `weekday` (12–2, 8–10), `weekend` (12–4), `custom` (`shared-types/enums.ts:108-112`). UI renders it as `Weekday`/`Weekend` pill (`batch-list.tsx:47`, `batch-detail-view.tsx:174`). `start_date/end_date` and `description` can hold generation window.
- **What does NOT exist:** no `time_slot`, `start_time`, `end_time`, `timezone`, `capacity`, `days_of_week[]` columns (`scripts/schema.sql:111-122`). The admin `BatchForm` only exposes `name + schedule_type + course_id` (`batch-form.tsx:6-10,20-28,80-111`). This is sufficient for LMS authorization — *authorization cares about batch identity (UUID), not about Wall-clock time.* The time label is operational metadata only; Zoom live session times live on `live_sessions.start_time/duration_minutes` (`schema.sql:294-306`), not on `batches`.

**Is naming sufficient for current LMS? YES.**

- Recording upload modal `upload-recording-modal.tsx:277-330` multi-select joins `selectedLabels.join(', ')` from `b.name` — clear if names are time-qualified.
- Edit modal `edit-video-modal.tsx:49-51,193-262` same.
- Filters `recordings-page-client.tsx:154-157`, `assign-batch-modal.tsx:171-175` all filter on `batch_id`, display `b.name` — name is the only disambiguator.
- The only risk is **name collision** if two batches share bare `Morning Batch` — mitigate by mandating fully-qualified names (`Dhanlabh — Batch {n} — {Weekday|Weekend} {hh–hh}`) at creation time via admin SOP, not via schema change.

**Do NOT add `time_slot` columns yet.** Phase 9.5 audit constraint says so. If later needed for scheduling automation, add nullable `display_label`/`time_slot_label` then — not required for authorization.

**Compatibility:** `session_batches`, `recording_batches`, `test_batches`, `batch_recording_curriculum` all accept any flat `batches.id`. Recordings uploaded once can be assigned to `Batch 1 12–2 + 8–10 + Weekend` via `recording_batches` (see §6).

---

## 5. Student Batch Assignment (Import → Access Trace)

### What field assigns a student?

`batch_students` junction row `(batch_id, user_id)` (`scripts/schema.sql:128-133`). No `profiles.batch_id`. Every assignment path inserts/upserts there (see §2 I).

### Is it mandatory?

Not at DB `profiles` level — a student can exist with zero `batch_students` rows (e.g., just-created via `POST /users` before enrollment). But **visibility is empty** until at least one row exists — `getCoursesForStudent`, `getForStudent`, `getRecordingsForStudent` all early-return `[]` if `batchIds.length===0` (`courses.service.ts:318`, `live-sessions.service.ts:826`, `recordings.service.ts:1055-1073`).

### Can it be changed later? Transactional?

YES — change = `DELETE batch_students(batch_id=old, user_id)` + `UPSERT batch_students(batch_id=new, user_id)`. Admin endpoints:
- `DELETE /batches/:id/students` (`batches.service.ts:253-267` single `DELETE … in userIds .select()`) — not wrapped in Transaction but single statement.
- `POST /batches/:id/students` (`batches.service.ts:218-251` validation + `UPSERT`).
- Moving is two calls, not a single RPC Transaction. No `Transaction` utility used in `batches.service.ts` (only live-sessions/recordings use `Transaction`). Partial failure leaves old+new simultaneously (student in both), which is benign (many-to-many allows it; recording visibility is union). To enforce single-batch membership, admin must explicitly delete old.

### Does changing it invalidate caches?

**GAP — not via `batches.service.ts`.**

- Recording reads are cached `cache:recordings:flat:{userId}:{topicId}` and `cache:recordings:grouped:{userId}` 300s via `RedisCacheService.wrap` (`recordings.service.ts:1037-1042,1159-1164`). Mutations to `recording_batches` etc. correctly call `invalidateRecordingsCache() → delByPattern('cache:recordings:*')` (`recordings.service.ts:312,462,552,750,788,917` and `bunny-webhook 190`).
- `batches.service.ts:1-16` does NOT inject `RedisCacheService` and neither `assignStudents` nor `removeStudents` calls `invalidateRecordingsCache()` nor `del cache:recordings:*` nor any `REDIS_KEYS` entry. `grep` for `invalidate` in `batches/**` returns zero.
- **Impact:** Student moved from Batch A (12–2) → Batch B (8–10) will retain the old `cache:recordings:flat:{userId}:*` view for up to 5 min (or until any recording mutation invalidates globally). `validateAccess()` on playback hits DB (no cache), so direct playback correctly reflects new batch immediately, but listing pages (`/recordings/my`) are stale for ≤300s.

This is **P1 hardening gap**, not architectural block — fix is to inject `RedisCacheService` into `BatchesService` and call `invalidateRecordingsCache()` after bulk/individual membership changes.

### Does changing it immediately affect…?

| Domain | Behavior after batch change | Evidence |
|--------|-----------------------------|----------|
| **Recording access (listing)** | Yes — after cache expiry/invalidation, next `GET /recordings/my` queries `batch_students(userId) → recording_batches` with new `batch_id` set. Old batch recordings disappear, new batch ones appear. | `recordings.service.ts:1047-1068 fetchRecordingsForStudent` + `is_published` gate `1075-1106` |
| **Recording playback** | Yes — immediate (no cache). `validateAccess:1320-1365` checks `recording_batches ∩ batch_students` + `is_published`. | `attempts` vs `recordings` — recordings re-queries on every authorize |
| **Assessments — listing** | Yes. `getMyTests:290-334` `batch_students → test_batches → tests WHERE status in (published,scheduled,active)` recomputed each call. | `tests.service.ts:291-312` |
| **Assessments — in-progress attempts** | **NO — gap.** `attempts.service.ts:51-63` checks `test_batches ∩ batch_students` only at `startAttempt`. Later `verifyOwnership:349-359` checks `attempt.user_id` only; `saveAnswer/submitAttempt/getTimer` remain allowed after removal from batch. | `attempts.service.ts:160-359` |
| **Live classes** | Yes. `GET /live-sessions/my:805-881 getForStudent` recomputes `batch_students → session_batches → live_sessions` each call. | `live-sessions.service.ts:818-841` |
| **Dashboard** | Yes (portal aggregates above). Student portal `page.tsx:21-28` calls `getMyCourses`, `getMySessions`, `getMyVideosGrouped` — all batch-derived. | `apps/web/src/app/student/**` |
| **Analytics** | Student removed from batch no longer counts in that batch's `batch_students` queries; `courses.service.ts:286-294 getStats` counts unique `user_id` via `IN batchIds`. Historical `test_analytics_snapshots.batch_performance` is snapshotted JSONB at generation time — not retroactively pruned. | `courses.service.ts:262-311`, `evaluation.service.ts:754-793 buildBatchPerformance` (first-batch-wins bug) |
| **Attendance** | No retroactive effect. `attendance` rows are `session_id,user_id` with `status present/absent/late` (`schema.sql:326-339`) linked to `live_sessions`, not `batches`. Moving batch does not delete past attendance; future `mark_absent_for_session` (`schema.sql:485-497`) checks `session_registrants`. | `attendance.service.ts:169-182`, `live-sessions.service.ts` mark-absent RPC |
| **Payments** | **No effect.** `payment_plans.course_id, payments.course_id, invoices.course_id` (`schema.sql:189-287`). Moving time-slot within same course keeps `course_id` stable. Moving across courses (e.g., Batch 1 → Batch 2 if they were separate courses) would need a new `payment_plans` row — but under recommended flat batches under ONE course, payments are untouched. | `payments.service.ts`, `payment_plans` DDL |

**Definitive answer: "If Student X moves from Batch A to Batch B, what changes?"**

- `batch_students` rows: delete `(A,X)` / insert `(B,X)`.
- Listing pages (recordings, tests, live sessions, courses) flip on next fetch (cache ≤300s).
- Old recordings/tests/sessions gated by Batch A become 403/missing; new ones gated by Batch B become visible if `status`/`is_published` allow.
- Payments, past attendance, in-progress attempts, and snapshot analytics do NOT automatically migrate.

---

## 6. Recording Authorization (Production Path)

**Canonical path** (`docs/modules/recordings.md`, `CLAUDE.md Recording Authorization`, `recordings.service.ts`):

```
STUDENT (profiles.id)
  → batch_students.user_id → batchIds[]
  → recording_batches.batch_id IN batchIds → recordingIds[] (PK (recording_id,batch_id))
  → batch_recording_curriculum (batch_id, content_id=recordingId, content_type='recording')
     → WHERE is_published=true (+ legacy fallback if zero rows — Phase-9 hardening recordings.service.ts:1090-1105)
  → recordings WHERE id IN publishedRecordingIds AND status='ready'
  → per-recording validateAccess(recordingId,userId): status ready + batch_students ∩ recording_batches + is_published (recordings.service.ts:1320-1410)
  → playbackGuard.authorize + getSignedUrl (Bunny CDN token 4h)
```

Relevant files:
- `recordings.service.ts:1044-1147 fetchRecordingsForStudent` (flat) — `recording_batches` → `is_published` gate
- `recordings.service.ts:1166-1330 fetchMyRecordingsGrouped` (grouped) — same, grouped by `batch_recording_curriculum(batch_id,category_name)`
- `recordings.service.ts:1320-1365 validateAccess` — single-recording gate
- `recordings.service.ts:1510-1572 getBatchRecordings(batchId)` — classroom batch view, same gate
- `recordings.service.ts:384-465 assignToBatches`, `476-555 removeBatchAccess`, `568-753 updateBatchCurriculum` — transactional `recording_batches + batch_recording_curriculum` + `invalidateRecordingsCache()`
- `recordings.service.ts:248-324 createRecordingWithUpload` — `INSERT recordings provider='mux'|'bunny' + Transaction batch links + curriculum`
- `common/constants/tables.constant.ts:18,50-53` `RECORDING_BATCHES`, `BATCH_RECORDING_CURRICULUM` etc.

**Does `ONE RECORDING → MANY BATCHES` work? YES — proven.**

- `recording_batches` PK `(recording_id,batch_id)` allows `X→B1, X→B2, X→B3 …` (`scripts/schema.sql:372-380`).
- `assignToBatches(batchIds: UUID[])` does `upsert onConflict 'recording_id,batch_id'` (`recordings.service.ts:408-409`) — idempotent, no 23505 duplicate.
- `batch_recording_curriculum` has `UNIQUE(batch_id,content_id,content_type)` (`migrations/018:24`) — each `(batch,recording)` has own `is_published/category_name/sort_order`.

Example **Batch 1 12–2 / 8–10 / Weekend + Batch 2 12–2**:

```
Recording A (ONE row, ONE Bunny guid)
  → recording_batches (A, <B1-12-2>) , (A, <B1-8-10>) , (A, <B1-WE>) , (A, <B2-12-2>)
  → batch_recording_curriculum (B1-12-2,A,'General',is_published=true) ×4
  → provider stays 'bunny', mux_asset_id stays guid, status stays ready
```

- Adding a batch: `updateBatchCurriculum(assigned:true)` → `upsert recording_batches + curriculum` — no `providerResolver` call, no `BunnyProvider` call, no `createDirectUpload` — verified by absence of provider calls in `assignToBatches/updateBatchCurriculum`.
- Removing a batch: `removeBatchAccess` or `updateBatchCurriculum(assigned:false)` → `DELETE WHERE content_id=A AND batch_id IN removed` scoped — other `batch_id` rows untouched.
- Cache: all mutations `await redisCache.invalidateRecordingsCache()` — next student request recomputes.

**Not affected:** provider, other batch assignments. No duplicate Bunny video.

---

## 7. Student Move Test (S from 12–2 → 8–10, both under Dhanlabh Batch 1)

**Setup:** Course `C = Dhanlabh with Shubh` (`courses.id=c1`). Batches `B_12 = ...12 PM–2 PM (c1, weekday)`, `B_8 = ...8 PM–10 PM (c1, weekday)`, both `is_active=true`. Student `S` initially `batch_students(B_12,S)`.

| Aspect | Before move (S ∈ B_12) | After `DELETE batch_students(B_12,S)` + `UPSERT batch_students(B_8,S)` | Risk / Note |
|--------|------------------------|---------------------------------------------------------------|-------------|
| **Old recording access** | Sees recordings where `recording_batches.batch_id=B_12` and `is_published`. E.g., legacy `Rec-B1-All` assigned `B_12+B_8+WE` → visible; `Rec-B2` assigned `B_8+WE` not. | After cache expiry, `Rec-B1-All` still visible via `B_8` (if assigned there too); recordings assigned ONLY to `B_12` disappear. | Cache staleness ≤300s (see §5 gap). No DB trigger needed — purely recomputed. |
| **New recording access** | Sees `B_12`-linked only. | Sees `B_8`-linked (e.g., time-slot–specific makeup class recorded for 8 PM only). | Correct. |
| **Assessment access** | `getMyTests` lists `test_batches` for `B_12`; `startAttempt` allows `test_batches∩{B_12}` | `getMyTests` now lists `B_8`; `startAttempt` allows `∩{B_8}`. In-progress attempt started under `B_12` remains submittable (see §5 attempt gap) but new attempt gated to new batch. | Gap: old attempt not revoked — low severity for time-slot move within same generation. |
| **Live session access** | `getForStudent` → `session_batches` for `B_12` → upcoming/past via `S`. | Next `GET /live-sessions/my` queries `batch_students=S → {B_8}` → `session_batches IN {B_8}`. Sessions linked ONLY to `B_12` disappear; those linked to both or to `B_8` appear. | Correct. Same session scheduled for both slots (cross-batch `batchIds=[B_12,B_8]`) remains visible (dedup `Set sessionIds`). |
| **Cached data** | `cache:recordings:flat:S:*` and `grouped:S` populated. | Stale until TTL or `invalidateRecordingsCache()` from an unrelated recording mutation. Move itself does NOT invalidate today — see §5 gap. | **Action:** invalidate on `batches.service` membership change before import. |
| **Dashboard** | `GET /courses/my` → `enrolledBatches=[B_12]`, dashboard cards `Course → B_12`. | `enrolledBatches=[B_8]` (grouped via `courses.service.ts:326-332`). | Correct. |
| **Analytics** | `test_analytics_snapshots` past rows keep old `batch_performance` JSONB snapshot — historical. | Future snapshots compute against new `batch_students` set. `evaluation.service.ts:754-793 buildBatchPerformance` uses first-match `if (!batchByUser.has(userId))` — student counted in new batch only. | Minor analytics distortion for multi-batch students only. |

**Verdict for move:** Existing system handles correctly via pure junction recomputation, **except** stale recording cache ≤5 min and lingering in-progress attempts. Both are mitigable without schema change.

---

## 8. Live Classes Compatibility (Flat Model)

**Architecture:** `live_sessions` ←M:N→ `session_batches` ← `batches` (`schema.sql:312-316`, `tables.constant:14`, `migrations/029:14-17` indexes). Also `session_registrants(session_id,user_id)` + `attendance(session_id,user_id)` (`schema.sql:318-339`).

**Can a session target one time-slot batch? YES.**

`live-sessions.service.ts:137-141` `const batchRecords = dto.batchIds.map(batchId => ({session_id: sessionId, batch_id: batchId}))` + DTO `@ArrayMinSize(1)`. Example payload `{topic, startTime, duration, teacherId, batchIds: [B_12]}`.

**Can it target multiple time-slot batches? YES — first-class.**

- DTO header `create-session.dto.ts:6` *"batchIds is plural — a session can be assigned to MULTIPLE batches (cross-batch)."*
- Service `Promise.allSettled(batchIds.map(...batch_students...))` then dedup via `Map` (`live-sessions.service.ts:143-172`) — one Zoom registrant per distinct student even if in both.
- Transaction `insert session_batches + session_registrants` (`live-sessions.service.ts:199-236`).
- Student reads via `getForStudent:805-881` → `Set(sessionIds)` dedup after `session_batches IN batchIds`.

**Compatibility with flat batches:** **100% compatible — no change.** `session_batches.batch_id FK → batches(id)` checks existence only, not `schedule_type` or `course_id` (`live-sessions.service.ts:101-104` `batchesService.findById` loop). Verification never validates time. This is intentional for cross-batch sessions (e.g., same live class for 12–2 + 8–10 + Weekend cohorts) without duplication. Session timing lives on `live_sessions.start_time/duration_minutes`, not on batch.

**Recording inheritance:** `jobs/recording-upload.job.ts:178-267` derives `batchIds` server-side from `session_batches` → `recordingsService.assignToBatches(recordingId, batchIds)` — preserves flat visibility.

No hierarchy table required.

---

## 9. Assessment Compatibility (Flat Model)

**Architecture:** `tests` ←M:N→ `test_batches(test_id,batch_id) UNIQUE` (`migrations/013:104-111`) → `batches`; plus `test_sections`, `test_question_bank`, `test_attempts` (`tests.service.ts:118-171 insertRelations`, `attempts.service.ts`).

**Does flat time-slot create isolation problems? NO — but with known audit findings.**

- `test_batches` is shared M:N, no `course_id` — one test row can be assigned to `B_12`, `B_8`, `WE` via `INSERT test_batches(test_id,batch_id) ×N` (`tests.service.ts:163-171`). Student in multiple time-slots sees test once via `getMyTests:291-312` `Set(testIds)`.
- `schedule_type` is decorative — never gates attempt. Global `tests.start_time/end_time/duration_minutes` apply to all assigned batches uniformly; `startAttempt` only checks `status ∈ (published,scheduled,active)` (`attempts.service.ts:46-48`), not window. This is pre-existing P2 in `docs/rccf-phase5-assessments-audit.md:128` (timer bypass).
- `BatchesService.assignStudents` uses `upsert onConflict batch_id,user_id` — idempotent.
- `TestsService.update` destructively re-inserts `test_batches + sections + question_bank` (`tests.service.ts:241-246` `DELETE then insertRelations`) — admin UI always sends full payload so not triggered in normal flow, but direct API `PATCH {batches:[...]}` would wipe sections.

**Flat-model risks (existing, not introduced by time-slot):**

| Risk | Evidence | Severity | Time-slot impact |
|------|----------|----------|------------------|
| `test_batches batchId` not validated for `is_active` | `tests.service.ts:163-171` inserts without `findById` | Medium | Student in deactivated weekend batch still sees test until unenrolled |
| `startAttempt` does not re-check on `saveAnswer/submit` | `attempts.service.ts:349-359 verifyOwnership` checks `attempt.user_id` only | Medium | Move from `B_12→B_8` leaves in-progress attempt submittable |
| Zero-batch test open to any student via API | `attempts.service.ts:52 if(testBatchIds.length>0)` branch falls through → no check | Medium | Time-slot irrelevant |
| `buildBatchPerformance` first-batch-wins | `evaluation.service.ts:754-793` `if (!batchByUser.has(id))` | Low | Multi-batch student counted only in first `batch_students` batch |
| `patch` deletes sections if only batches sent | `tests.service.ts:242 if(sections\|\|questions\|\|batches)` | Medium | Admin mistake — use UI that sends full payload |

**No required change for flat time-slot.** Each time-slot gets its own `batches.id`; assigning a test to `B_8` does not auto-assign to `B_12`; listing and attempt gates remain batch-scoped. Per-batch windows are not needed for this import — global window suffices.

---

## 10. Admin UI Findings

Inventory (examples, not exhaustive): `apps/web/src/app/admin/{batches,courses,students,recordings}/**`, `components/admin/{batches,courses,students,recordings}/**`, `lib/api/{courses,videos,assessments}.ts`, `components/shared/AdminDataTable.tsx:105-263`.

### A. How batches are created

`BatchForm` (`components/admin/courses/batch-form.tsx:6-126`): course selector (only if not predetermined), `name` required placeholder `e.g. Morning Batch` (`batch-form.tsx:91`), `schedule_type` select `weekday|weekend|custom` (`batch-form.tsx:6-10,100-110`), submit `updateBatch` vs `createBatch` (`batch-form.tsx:29-52`). Only `name + scheduleType` sent. Used from `BatchList` (modal, course auto-selected via `courses` prop `batch-list.tsx:83-85`) and `CourseList` (`course-list.tsx:111`). `POST /batches` validates `courseId` + `name`.

### B. How batches are displayed

- `/admin/batches` → `BatchList.tsx:41-81` columns `Name (link) | Course (course.name) | Schedule (weekday→Weekday) | Status (Active pill) | Actions (Edit/Delete)`, stats cards Total/Active/Inactive (`batch-list.tsx:38-39`). Paginated fetch `getAllBatches({isActive:false,page:1,limit:100})` (`batches/page.tsx:11`, `batch-list.tsx:30`).
- `/admin/courses` → `CourseList.tsx:86-104` nested `course.batches.map` row per batch with `batch.name` + Edit/Delete, dot icon, no count.
- `/admin/courses/[id]` → `CourseDetailsView.tsx:219-253` table `Name|Schedule|Status|Actions` with `Students` → `BatchStudentsModal`, `Reassign` → `ReassignBatchForm`.

### C. How students are assigned

- From Batch detail `BatchDetailView.tsx:98-162` tab Students: `getBatchStudents(batch.id, page, 50)` (`batch-detail-view.tsx:101`), `addStudentToBatch(batch.id, {firstName,lastName,email,phone})` CREATES new user (not pick existing) (`batch-detail-view.tsx:156`), `removeStudentsFromBatch` per row.
- From Course → `BatchStudentsModal.tsx:37-79` same creation path.
- From Students list `StudentsPageClient.tsx:85-88` + `AssignBatchModal.tsx:34-221`: the correct existing-user path — select rows via `AdminDataTable` checkboxes → bulk `Assign to Batch` (`students-page-client.tsx:151` bulkActions) → `AssignBatchModal` `getAllBatches({isActive:true,limit:100})` (`assign-batch-modal.tsx:37`), `availableBatches = allBatches \ assignedIds`, `assignStudentsToBatch(selectedBatchId, studentIds)` (`assign-batch-modal.tsx:64`), and `removeStudentsFromBatch` single confirm dialog (`assign-batch-modal.tsx:75-89,226-271`). Student workspace `StudentWorkspace.tsx:233-260` Enrollments list + same modal.

### D. How recordings are assigned

`UploadRecordingModal.tsx:277-332` mandatory multi-select (`isValid: selectedBatchIds.size>0` `upload-recording-modal.tsx:108`), pills `Select All/Deselect All` (`upload-recording-modal.tsx:309-311`), `createRecording({batchIds: Array.from(selectedBatchIds)})` (`upload-recording-modal.tsx:120`) → Bunny TUS. `EditVideoModal.tsx:49-103` init `Set(video.recording_batches)`, checklist `b.name` with X pills, save computes `added/removed` → `updateRecordingBatchCurriculum(video.id, assignments)` single PATCH atomic (`edit-video-modal.tsx:96-103`) then `updateVideoMetadata`.

### E. Multi-batch recording assignment

**Works.** Upload requires `≥1` batch, supports N with checkboxes + `Select All`. Edit diffs add+remove atomically via `PATCH /admin/recordings/:id/batch-curriculum` (`videos.ts:138-146`). Table `RecordingsTable.tsx:149-213` pills up to 3 + overflow; filter bar `RecordingsPageClient.tsx:154-157` single `batchId` dropdown (from 200 active batches).

### F. Batch filters/searches

- `/admin/batches`: **BROKEN.** `batch-list.tsx:80` passes `showSearch` placeholder but `AdminDataTable.tsx:107-113,177` only shows search if `searchKeys+onSearchChange` present — neither passed → no search input (subagent exhaustive verification). No course/status/schedule dropdown filters; no pagination beyond hard `limit:100`.
- `/admin/courses`: none on batch list.
- `/admin/students`: search `name,email,phone` only (`students-page-client.tsx:150` `searchKeys`), batch names excluded; `batches` column pills `b.name` only.
- `/admin/recordings` filter bar `RecordingsPageClient.tsx:132-161` search+status+topic+published+batchId (exact) + sort — single batch filter only.

### G. Do names distinguish `12–2 / 8–10 / Weekend`?

**Not yet — systemic ambiguity.** Every render is bare `b.name`:
`batch-list.tsx:43`, `course-list.tsx:92`, `course-details-view.tsx:189,229`, `students-page-client.tsx:104`, `student-workspace.tsx:253`, `recordings-page-client.tsx:156`, `assign-batch-modal.tsx:172`, `edit-video-modal.tsx:255`, `upload-recording-modal.tsx:294`. Only secondary `schedule_type` shown on list pill/header (`batch-list.tsx:47`, `batch-detail-view.tsx:174` subtitle `weekday batch`).

No `time_slot`/`start_time` column exists; `BatchForm` placeholder `Morning Batch` invites vague names. Two batches both `Morning Batch` under same course collide visually (same `value=id`, different rows). No composite label `Course — Name (Weekday 12–2 IST)` exists.

**Gaps (audit only, do not redesign):**

1. **P0 — Time-slot ambiguity:** mandate fully-qualified names SOP before import; no code change required this phase but gaps 5–6 in this section are operational.
2. **P0 — `/admin/batches` search broken + no batch count/capacity columns:** `batch-list.tsx:38-43` missing `searchKeys`, `batch-list.tsx:63-65` stats only counts, no `studentCount` per row (available via `getBatch` counts `batches.service.ts:69-77`).
3. **P1 — Dropdowns unspecific:** all batch `<select>/<option>` show only `b.name`; `getAllBatches` capped `limit:100/200` (`assign-batch-modal 37`, `recordings pages 76`) silently truncates.
4. **P1 — Student→batch from Batch detail creates DUPLICATES:** `BatchDetailView.handleAddStudent` and `BatchStudentsModal` call `addStudentToBatch` (new auth user) instead of picking existing — only `AssignBatchModal` (from Students list) handles existing users.
5. **P2 — Recording curriculum indirection:** `CurriculumTab.tsx:105` adds `batch_recording_curriculum` but not `recording_batches` — admin may think recording visible while still gated by `recording_batches`.

---

## 11. DB Verification

**Live Supabase access — BLOCKED.**

No `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` was available in this execution (env check `process.env.SUPABASE_*` absent; `scripts/schema.sql` treated as rebuild script, not live introspection). Therefore no `SELECT` was run against production.

**Schema evidence from repo (migrations + schema.sql drift note):**

| Table | PK / Unique | FK | Indexes | Drift note |
|-------|-------------|----|---------|------------|
| `courses` | `id PK` | — | `idx_courses_active` | Current in `schema.sql:97-108` |
| `batches` | `id PK` | `course_id → courses ON DELETE CASCADE` | `idx_batches_course, idx_batches_active` `schema.sql:124-125` | — |
| `batch_students` | `PRIMARY KEY (batch_id, user_id)` | both `ON DELETE CASCADE` | `idx_batch_students_user ON user_id` `schema.sql:142` + `029:10-11` | — |
| `batch_teachers` | `PRIMARY KEY (batch_id, user_id)` | both `CASCADE` | `idx_batch_teachers_user` | — |
| `session_batches` | `PRIMARY KEY (session_id, batch_id)` | both `CASCADE` | `idx_session_batches_session_id, _batch_id` `029:14-17` | — |
| `recordings` | `id PK` | `session_id → live_sessions SET NULL`, `topic_id SET NULL` | `idx_recordings_status/topic/session/provider` `schema.sql:368-370` + `035` `provider CHECK` | — |
| `recording_batches` | `PRIMARY KEY (recording_id, batch_id)` | both `CASCADE` | `idx_recording_batches_recording/batch` `schema.sql:379-380` | — |
| `batch_recording_curriculum` | `UNIQUE(batch_id,content_id,content_type)` | `batch_id → batches CASCADE`, `content_id` no FK (polymorphic) | `idx_batch_curriculum_batch + ordering` `migrations/018:26-27` | — |
| `test_batches` | `UNIQUE(test_id,batch_id)` (id PK) | both `CASCADE` | `idx_test_batches_test/batch/test_id/batch_id` `013:113` + `029:30-33` | MISSING in `scripts/schema.sql` (stale, 007-era legacy `tests` only) — rebuild requires `013,029` |

**Indexes / FKs / constraints verified via code-migration cross-check:**
- Composite PKs on all junctions prevent duplicate `(X, batch)` rows (duplicate assignment guarded via `upsert onConflict batch_id,user_id` or `recording_id,batch_id`).
- `batches.course_id NOT NULL` ensures every time-slot batch belongs to exactly one course (`Dhanlabh`).
- No hierarchy FK → no accidental tree logic.

**To verify live before import (run in Supabase SQL editor, read-only):**

```sql
-- 1. Courses (expect 0-or-1 row named Dhanlabh)
SELECT id, name, is_active, created_at FROM courses ORDER BY created_at;
-- 2. Batches under that course
SELECT id, course_id, name, schedule_type, is_active, created_at
FROM batches WHERE course_id = '<dhanlabh-course-id>' ORDER BY name;
-- 3. Junction counts (should be zero pre-import, or reflect test data)
SELECT batch_id, COUNT(*) FROM batch_students GROUP BY batch_id;
SELECT recording_id, COUNT(*) FROM recording_batches GROUP BY recording_id;
SELECT batch_id, COUNT(*) FROM session_batches GROUP BY batch_id;
-- 4. Drift check (test_batches must exist)
SELECT to_regclass('public.test_batches'), to_regclass('public.batch_recording_curriculum');
```

Do not create/update/delete; `SELECT` only. If `test_batches` missing, live DB was built from stale `schema.sql` — apply `013` first.

---

## 12. Browser Verification

**Dev/staging server — BLOCKED.**

No `http://localhost:3000` nor `http://localhost:3001` was reachable in this execution (no `pnpm dev` running; `next dev`/`nest start` not available). Playwright `tests/e2e/**` would otherwise exercise:
- `/admin/batches` list → `BatchList` pagination/search
- `/admin/batches/[id]` → `BatchDetailView` tabs, Students tab add/remove
- `/admin/students` → `AssignBatchModal` bulk flow
- `/admin/recordings` → `UploadRecordingModal` multi-select, `EditVideoModal` save, filter bar

**Blocked evidence:** `BatchList` search guard (`batch-list.tsx:80` vs `AdminDataTable:177`) and dropdown truncation (`limit:100`) would be observable in browser but could not be exercised. No test account credentials were available for staging.

Mark `BROWSER VERIFY = BLOCKED` — do not fabricate. Manual QA must be performed against staging with existing test accounts before production import (see §18).

---

## 13. Student Import Readiness

### Required model

Minimal CSV/XLSX header (already supported by `parseUsersFile:14-53`):

```
name,email,phone,courseName,batchName
```

- `name` — required (`file-parser.util.ts:30-41` `name`+`email` required else RowResult failure).
- `email` — required, validated `^[^\s@]+@[^\s@]+\.[^\s@]+$` (`bulk-upload.service.ts:137-145`) before `auth.admin.createUser`.
- `phone` — optional (`ParsedUser.phone?: string`).
- `courseName` — optional but **recommended** (`file-parser.util.ts: email,phone,courseName,batchName` normalized headers). Used to scope batch lookup.
- `batchName` — optional per row; if empty, falls back to `dto.batchId` form field (`bulk-upload.service.ts:239-246`) or leaves student without batch (warning on miss, not failure).

Template provided by `GET /bulk-upload/template` (`bulk-upload.controller.ts:25-33` `@Public()`) returns `name,email,phone,courseName,batchName` CSV header.

### Can `batch_id` be assigned during import?

**YES.** `BulkUploadService.processSingleRow:211-246`:
```ts
if (user.batchName) {
  const lookup = await lookupBatchByName(user.batchName, user.courseName); // ilike batches.name scoped by courseName → batches.course_id
  if (!lookup) warning = `... batch "${user.batchName}" not found ... assign manually`;
  else await batchesService.assignStudentToBatch(lookup.batchId, userId);
} else if (dto.batchId) {
  await batchesService.assignStudentToBatch(dto.batchId, userId);
}
```
Enrollment is non-fatal warning, not row failure; job summary aggregates `successCount/failureCount/warning` (`bulk-upload.service.ts:95-112`).

Single-row direct API also allows `POST /batches/:id/add-student` with `AddStudentDto`.

### Should IDs or names be used?

**Use `batchName (+ courseName)` in CSV, not hard-coded UUIDs.**

- UUIDs in CSV are fragile (copy-paste error, cross-env mismatch).
- `lookupBatchByName` uses `ilike name = batchName.trim()` scoped by `courseName ilike` (`bulk-upload.service.ts:272-303`), `limit(2)` to flag `multipleMatch` warning (`multipleMatch: true` → enrolled in first match + warning `Multiple batches matched`).
- To avoid `multipleMatch`, ensure **unique batch names within the Dhanlabh course** (e.g., fully-qualified `Dhanlabh — Batch 1 — Weekday 12 PM–2 PM`). Deduplicate before import by deduping `batchName` column and verifying against live `SELECT id,name FROM batches WHERE course_id = '<dhanlabh-id>'`.

### Safe mapping strategy (audit recommendation, no code)

1. **Freeze course:** create (or identify) `courses` row `name='Dhanlabh with Shubh'` — capture its `id`.
2. **Freeze batches:** create **only the required time-slot batches** under that `course_id` (see §15 exact list). Verify `SELECT name FROM batches WHERE course_id=@dhanlabh` — no duplicates.
3. **CSV prep:** sheet with columns `name,email,phone,courseName,batchName` where `courseName = Dhanlabh with Shubh` (exact, case-insensitive but keep stable) and `batchName =` chosen batch's exact `name` (copy from live `SELECT`). Example row: `Aarav Sharma,aarav@...,+91...,Dhanlabh with Shubh,Dhanlabh with Shubh — Batch 1 — Weekday 12 PM–2 PM`.
4. **Pilot:** import 5–10 rows via `POST /bulk-upload/students` (`bulk-upload.controller.ts:51-60` multipart `file` field), poll `GET /bulk-upload/jobs/:jobId` until `completed`, inspect `results` warnings.
5. **Bulk:** import remaining in `CHUNK_SIZE=5` parallel chunks; each bad `batchName` yields warning not fatal — correct via `POST /batches/:id/students` fallback.

**Pre-import guard:** run `SELECT id,name FROM batches WHERE course_id='<dhanlabh-id>' ORDER BY name;` and `SELECT id FROM profiles WHERE email IN (...csv emails)` to detect existing users (bulk reuses existing auth user via `listUsers` scan `bulk-upload.service.ts:161-172` — warns not fail).

---

## 14. Historical Video Assignment Model

Already proven in Phase 9 (`docs/rccf-phase9-historical-video-upload-report.md:6-9,14-17`):

```
Batch 1 generation recording (e.g., old Batch 1 lecture)
  → upload once via POST /admin/recordings {title, batchIds: [B_12, B_8, WE_B1, B2_12, ...], isPublished}
  → ONE recordings row {provider='bunny', status='processing' → ready via Bunny webhook} (recordings.service.ts:248-324)
  → N recording_batches rows (recording_id, batch_id) × N  (upsert onConflict PK)
  → N batch_recording_curriculum rows (batch_id, content_id, General, is_published)
  → invalidateRecordingsCache() → students in all N batches see it when status=ready
```

- Same lecture required by all time-slots: one Bunny GUID + multiple `recording_batches` — *no duplication*.
- Batch-2-only lecture: `batchIds = [B2_12, B2_8, B2_WE]` → Batch 1 slots not assigned → not visible to Batch 1 students.
- Adding another slot later: `PATCH /admin/recordings/:id/batch-curriculum {assignments:[{batchId:B_new, assigned:true}]}` or `POST /admin/recordings/:id/batches {batchIds:[B_new]}` (`recordings.controller.ts:90-105`) — no provider call.

No hierarchy needed — each `recording_batches` row is independent.

---

## 15. Recommended Production Batch Structure

**Based ONLY on existing architecture** (`courses 1—N batches`, flat `schedule_type`, `course_id` required):

### Course

```
courses.id = <new-or-existing>
name = 'Dhanlabh with Shubh'
description = 'Time-slot cohorts for Dhanlabh with Shubh program' (optional)
is_active = true
```

If `SELECT * FROM courses WHERE name ILIKE 'Dhanlabh%'` already exists, reuse it — do not duplicate.

### Actual LMS batches (flat, course_id = Dhanlabh)

Create **only the batches actually operated**. The six suggested in the prompt are the **max** template — do not create all six if a slot is not operated. From repo + prompt, the canonical time-slots are:

| # | Batch `name` (exact, unique) | `schedule_type` | `description` example |
|---|-------------------------------|-----------------|----------------------|
| 1 | `Dhanlabh with Shubh — Batch 1 — Weekday 12 PM–2 PM` | `weekday` | `Batch 1 · Weekday 12:00–14:00 IST` |
| 2 | `Dhanlabh with Shubh — Batch 1 — Weekday 8 PM–10 PM` | `weekday` | `Batch 1 · Weekday 20:00–22:00 IST` |
| 3 | `Dhanlabh with Shubh — Batch 1 — Weekend 12 PM–4 PM` | `weekend` | `Batch 1 · Weekend 12:00–16:00 IST` |
| 4 | `Dhanlabh with Shubh — Batch 2 — Weekday 12 PM–2 PM` | `weekday` | `Batch 2 · Weekday 12:00–14:00 IST` |
| 5 | `Dhanlabh with Shubh — Batch 2 — Weekday 8 PM–10 PM` | `weekday` | `Batch 2 · Weekday 20:00–22:00 IST` |
| 6 | `Dhanlabh with Shubh — Batch 2 — Weekend 12 PM–4 PM` | `weekend` | `Batch 2 · Weekend 12:00–16:00 IST` |

- If only Batch 1 operates today, create 1–3 only.
- If no Weekend batch is operated for Batch 2, skip 6.
- **Never create a synthetic parent batch** like `Dhanlabh — Batch 1` and children — the system has no parent column; doing so would require putting students in children but not parent, while recordings/live sessions would need to target N children individually — unnecessarily complex vs flat.

**Creation order:** `POST /courses` → capture `courses.id` → then loop `POST /batches {courseId, name, scheduleType, description}` for each needed row (via Admin UI `BatchForm` or direct API). Keep `is_active=true`.

---

## 16. Risks

| # | Risk | Evidence | Impact | Mitigation (pre-import) |
|---|------|----------|--------|------------------------|
| R1 | **Batch name ambiguity → wrong assignment** | All UI renders `b.name` only (`batch-list 43`, `assign-batch 172`, `upload-modal 294`) + `limit 100/200` truncation | Student/recording assigned to wrong time-slot | Enforce unique FQN names SOP (§15); verify via `SELECT name, schedule_type FROM batches` before import |
| R2 | **Stale recording cache after move** | `batches.service 218-267` never calls `invalidateRecordingsCache` | Moved student sees old batch recordings ≤5 min | Harden `BatchesService.assignStudents/removeStudents/addStudent/assignStudentToBatch` to inject `RedisCacheService` and `await invalidateRecordingsCache()` (P1, no schema) |
| R3 | **In-progress attempt remains after move** | `attempts.service 349-359 verifyOwnership` checks `user_id` only | Student removed from `B_12` still submits `B_12`-only test started before move | Accept for time-slot move (same generation); or harden `saveAnswer/submit` to re-check `test_batches ∩ batch_students` |
| R4 | **Zero-batch test open to any authenticated student** | `attempts.service 52 if(testBatchIds.length>0)` falls through | `GET /tests/:id` unknown UUID could leak test | Ensure every production test has ≥1 `test_batches` row; add API validation `batches required` (future) |
| R5 | **`test_batches` missing on stale rebuild** | `scripts/schema.sql:412-445` has no `test_batches` | Fresh DB without `013` has no test batching | Verify `to_regclass('test_batches')` live; apply `migrations/013` if null |
| R6 | **`BatchDetailView` creates duplicate users** | `batch-detail-view 156` + `batch-students-modal 67` call creation path, not lookup | Duplicate auth account if email already in other batch | Use `AssignBatchModal` (Students list) for existing users; `BatchDetailView` for new-only |
| R7 | **`BatchList` search broken, no batch count column** | `batch-list 80` no `searchKeys`, `AdminDataTable 177` guard | Admin cannot audit batches pre-import | Fix `batch-list.tsx:80` to pass `searchKeys=['name','course.name','schedule_type']` + `searchValue` state (P1) |
| R8 | **Bulk import ilike multipleMatch** | `bulk-upload 272-303 limit(2)` warns `Multiple batches matched` | Enrolled in first arb. match | Pre-dedupe CSV `batchName` against live unique `batches.name`; keep case-exact |
| R9 | **Large-file TUS vs file-size limit** | `bulk-upload` FILE limit not, `recording` TUS direct → Bunny | Historical 1GB videos okay via TUS, not via `bulk-upload` | Use `POST /admin/recordings` + `tusUpload` for videos, `POST /bulk-upload/students` for students only |
| R10| **Batch reassign-course CASCADE** | `batches.course_id ON DELETE CASCADE` | Moving batch to new course orphans stats | `reassignCourse` validates `is_active` (`batches.service 189-216`); avoid deleting `courses` row |

All risks are operational/hardening — none require parent→sub-batch hierarchy.

---

## 17. Required Changes, If Any

**Audit verdict: zero required schema changes for the flat time-slot model.**

Additive P1 hardening recommended (do NOT block audit, schedule before bulk import):

| Change | File | What | Why |
|--------|------|------|-----|
| H1 | `apps/api/src/modules/batches/batches.service.ts:1,23,218,253,356,446` | Inject `RedisCacheService`; call `await this.redisCache.invalidateRecordingsCache()` after `assignStudents`, `removeStudents`, `addStudent`, `assignStudentToBatch` | §5 cache staleness on move |
| H2 | `apps/web/src/components/admin/batches/batch-list.tsx:38-81` | Pass `searchKeys`, `searchValue/onSearchChange`, add `studentCount` column (already available via `GET /batches/:id`), add `total/page/limit` pagination | §10 G2–G3 — admin audit before import |
| H3 | `apps/api/src/modules/batches/batches.service.ts:163-171` / `apps/api/src/modules/tests/tests.service.ts:241-246` | Validate `batches` existence + `is_active` before insert; wrap `tests insertRelations` in Transaction / guard `PATCH` destructive branch | §9 risks — not flat-model specific but improves safety |
| H4 (optional) | `apps/web/src/components/admin/**` batch selects | Render `b.course?.name` alongside `b.name` in all batch `<select>/<option>` and pills | §10 G5 ambiguity — display-only, no DB |

No `programs` table, no `batch_hierarchy`, no `batch_time_slots`. No migration file.

---

## 18. Exact Next Steps (No Code in This Phase)

1. **Live DB read-only checks** (Supabase SQL editor, no writes):
   ```sql
   SELECT id, name, is_active FROM courses WHERE name ILIKE '%dhanlabh%';
   SELECT id, course_id, name, schedule_type, is_active FROM batches ORDER BY course_id, name;
   SELECT COUNT(*) FROM batch_students; -- expect sparse pre-import
   SELECT to_regclass('public.test_batches'), to_regclass('public.batch_recording_curriculum');
   ```

2. **Decide real batch count** — with product owner, tick which of the 6 in §15 actually operate (e.g., if Batch 2 Weekend not yet run, omit it).

3. **Create course + batches via Admin UI** (or `POST /courses`, `POST /batches`) — manually, one by one, using FQN names in §15. Verify `GET /courses/{id}` embeds correct `batches`.

4. **Capture batch UUIDs** — `GET /batches?isActive=true&limit=100` → export `id,name` → use as `batchName` source for CSV (copy exact `name` strings, not IDs).

5. **Prepare CSV** — columns `name,email,phone,courseName,batchName` per `file-parser.util.ts:14-30`. Fill `courseName='Dhanlabh with Shubh'` everywhere, `batchName`=chosen FQN per student row. De-duplicate emails, validate `emailRegex` (`bulk-upload.service.ts:137`).

6. **Pilot import** — `POST /bulk-upload/students` with 5–10 rows, poll `GET /bulk-upload/jobs/:id`, check `results[].warning` for `batch not found / multipleMatch`. Fix CSV, verify `GET /batches/:id/students` lists pilot students.

7. **Recording assignment (Phase 9 workflow, unchanged)** — upload historical video once via `POST /admin/recordings {batchIds:[B_12,B_8,...]}` + TUS → Bunny → `recording_batches ×N`. No duplication.

8. **Browser QA** (staging):
   - Admin → Batches: confirm search works (after H2), `schedule_type` pills.
   - Admin → Students bulk assign: select 2 rows → `Assign to Batch` → pick `B_8` → confirm `batches` pills appear.
   - Admin → Recordings upload → pick 3 time-slot batches → `is_published=true` → confirm table pills.
   - Student (test account): move `DELETE /batches/{old}/students {studentIds}` + `POST /batches/{new}/students` → wait 5 min or hit any recording mutation → confirm `/recordings/my` reflects new batch.

9. **Schedule hardening H1+H2 before bulk import** — one PR, `230` tests still pass, `AdminDataTable` search guarded.

10. **Full bulk import** — chunked `POST /bulk-upload/students`, monitor `bulk_upload_jobs` table (`SELECT status, success_count, failure_count, failures FROM bulk_upload_jobs ORDER BY created_at DESC LIMIT 10`).

---

## Definition of Done — Evidence Checklist

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Can `Dhanlabh with Shubh` remain Course/Program? | **YES** — as `courses` row `name='Dhanlabh with Shubh'` | `schema.sql:97-106`, `courses.service.ts:25-54 create`, `batches.service.ts:89-99` `course_id` FK |
| 2 | Can time-slot groups be flat `batches`? | **YES** — plain `batches` with FQN `name` + `schedule_type` | `schema.sql:111-125` flat, no `parent_id`; `create-batch.dto 26-30` enum; `session_batches PK` proves M:N |
| 3 | How are students assigned? | `batch_students(batch_id,user_id) PK`, via `POST /batches/:id/students` upsert, `POST /batches/:id/add-student`, `POST /bulk-upload/students` (batchName ilike) | `batches.service.ts:218-268,356-468`, `bulk-upload.service.ts:211-246` |
| 4 | Can students safely move between batches? | **YES** — `DELETE old + UPSERT new`; flat many-to-many allows both simultaneously; old access drops, new granted on next query (cache ≤300s) | `batches.service.ts:253-267 + 218-251`, `recordings.service.ts:1047-1106`, `live-sessions.service.ts:805-841` |
| 5 | Does recording auth follow current batch? | **YES** — `recording_batches ∩ batch_students + is_published` recomputed per request | `recordings.service.ts:1044-1147,1320-1365`, Phase-9 report §§6,9 |
| 6 | Can one recording → many time-slot batches? | **YES** — `recording_batches PK` upsert `onConflict recording_id,batch_id`; N rows → one Bunny GUID; adding batch never calls provider | `schema.sql:372-380`, `recordings.service.ts:384-465`, `migrations/018:24` |
| 7 | Do live classes work? | **YES** — `session_batches M:N`, DTO `batchIds[] @ArrayMinSize(1)`, `getForStudent` dedup `Set` | `schema.sql:312-316`, `live-sessions dto:49-53`, `live-sessions.service:137-236,805-881` |
| 8 | Do assessments work? | **YES** — `test_batches UNIQUE(test_id,batch_id)`, `startAttempt` `test_batches ∩ batch_students` | `migrations/013:106-111`, `attempts.service:51-63`, `tests.service:163-171` |
| 9 | Does Admin UI support workflow? | **YES** with gaps — multi-batch upload/edit works, student bulk assign works, but `/admin/batches` search broken + names ambiguous | `UploadRecordingModal 277-330`, `EditVideoModal 49-103`, `AssignBatchModal 34-221`, `BatchList 41-81` |
| 10| Exact batch structure? | **Course + 3–6 flat batches under `Dhanlabh` — see §15 table** — create only operated slots | `courses 1—N batches` model, `schedule_type` week/weekend |
| 11| Exact data for student import? | `name,email[,phone],courseName,batchName` CSV header (template `GET /bulk-upload/template`), mapped via `lookupBatchByName ilike` scoped by course | `file-parser.util.ts:14-30`, `bulk-upload.service.ts:137-303` |

---

## Verdict

**CONDITIONAL GO**

The running LMS **correctly and safely supports** `Dhanlabh with Shubh` as a `courses` program and time-slot cohorts as flat `batches` rows. No hierarchy migration is required or desired. Student batch determines access, moving batches flips recording/live/test visibility as specified, and `ONE recording → MANY recording_batches → ONE Bunny asset` holds.

**Conditions before production bulk import** (operational, 1–2 day hardening + verification):

1. Apply **H1** (cache invalidation on `batch_students` change) and **H2** (admin batch search + counts) — small PR, no schema.
2. Enforce **batch name SOP** (FQN names in §15) and verify uniqueness via `SELECT` before CSV.
3. Run **live DB SELECTs** (§18 step 1) and **pilot bulk import** (§18 steps 5–6).
4. Perform **browser QA** of the 8 flows in §18 step 8 with existing test accounts (search, bulk assign, recording upload multi-batch, student move).

After those four, verdict becomes **GO** with no additional architecture work.

---

_MCT LMS 2026-09-15 — RCCF Phase 9.5 Audit Only. No production batches created. No students imported. No schema modified. No code committed._
_Reports: `docs/rccf-phase8-live-recordings-bunny-report.md`, `docs/rccf-phase9-historical-video-upload-report.md` → this report._
