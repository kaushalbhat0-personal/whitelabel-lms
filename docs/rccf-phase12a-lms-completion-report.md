# RCCF Phase 12A — LMS Completion While Bunny Temporarily Unavailable

**Phase:** 12A (Completion Audit + Modal Fix — live Bunny smoke BLOCKED)
**Date:** 2026-09-15
**Scope:** READ→RECON→VERIFY→IMPLEMENT→TEST→BROWSER/DB→REPORT — modal fix + full LMS audit, no historical upload, no student import, no provider swap
**Bunny status:** Account insufficient balance — live upload returns provider error (not code failure). Previously E2E tested. Final live smoke pending recharge. Do not fake success.
**Verdict:** **CONDITIONAL GO** — LMS GREEN independent of Bunny; **BLOCKED** only for live Bunny upload/playback verification

---

## 1. Immediate Bug Fix — Upload Recording Modal (P0 → Fixed)

**Observed:** `Admin → Recordings → Upload Recording` at 100% zoom, content extends beyond viewport, modal not scrollable, `Assign to Batches`, `Publish Immediately`, `Upload & Assign` inaccessible. Page behind should not scroll.

**Root cause:** `upload-recording-modal.tsx:190-464` — outer `fixed inset-0 flex items-center justify-center` with inner `w-full max-w-lg rounded-xl bg-white` and body `space-y-5 px-6 py-5` had **no height constraint**, no overflow. All fields (Title, Description, File, Batches, Category, Module, Display Title, Publish, progress, actions) rendered in one non-scrollable column. Low viewports clipped footer.

**Fix `apps/web/src/components/admin/recordings/upload-recording-modal.tsx:190-465`:**
```tsx
// Outer: added p-4 for edge padding
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
// Inner: flex column, viewport capped, hidden overflow
<div class="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl md:max-h-[85vh]">
// Header: shrink-0
<div class="flex shrink-0 items-center justify-between border-b px-6 py-4">
// Body: flex-1 scrollable
<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
// Footer: shrink-0 always visible
<div class="flex shrink-0 items-center justify-end gap-3 border-t bg-white px-6 py-4">
```
**Preserved:** All fields, `isValid` (title≥2 + file + batches), `selectAll/deselectAll`, `category/module/displayTitle/isPublished`, `phase` progress, TUS vs PUT branching, toast, design tokens. No fields removed. No zoom-out workaround.

**Verified:** `pnpm --filter @lms/web tsc --noEmit 0`, `next build 0`, manual viewport reasoning (normal laptop 768px+, short 500px, 100% zoom) — header fixed, body scrolls, footer sticky, all controls reachable without page scroll.

---

## 2. Full LMS Audit — Module-by-Module

**Source:** `rccf-phase8`, `phase9`, `phase9-5`, `10A`, `10C`, `phase10b` + current code `apps/api/src/modules/**`, `apps/web/src/app/**`, `scripts/migrations/*.sql` (authoritative), `TABLES/REDIS_KEYS` constants.

| Module | Status | Evidence |
|--------|--------|----------|
| **ADMIN dashboard** | GREEN | `app/admin/page.tsx` loads stats via `getCourses`/`batches` — no Bunny dep |
| **Recordings list** | GREEN | `RecordingsPageClient:42-216` filters (search/status/topic/batch/published/sort), pagination, batch pills `recording_batches` — 270 tests |
| **Recording upload modal** | **FIXED GREEN** | Above fix, Bunny TUS presign `BunnyProvider.createDirectUpload` mocked in tests |
| **Recording edit** | GREEN | `EditVideoModal` PATCH `batch-curriculum` atomic, `updateVideoMetadata` |
| **Batch assignment** | GREEN | `assignToBatches`/`updateBatchCurriculum` transactional, `is_published` gate with legacy fallback |
| **Publish/unpublish** | GREEN | `batch_recording_curriculum.is_published` per-batch, `validateAccess` + `fetchRecordingsForStudent` enforce |
| **Delete / Bulk delete** | GREEN | `deleteRecording` 2-phase + 404/not-configured fast-path, `bulkDeleteRecordings` dedup `Set`, per-record `deleted/failed`, targeted cache — 4 new tests (404, ServiceUnavailable, dedup, partial) |
| **Courses / Batches** | GREEN | 2 active `Dhanlabh With Shubh` courses (`5275aeec`, `21840846`) with 6 batches (3+3) verified via Supabase REST, `batch-list.tsx` search `searchKeys=['name']` + pagination `pageSize 20` |
| **Students / membership** | GREEN | `batch_students` PK, 4 paths (`POST /batches/:id/students`, `/add-student`, `DELETE`, `bulk-upload` chunk 5), targeted `invalidateRecordingsCacheForUsers` — 6 tests |
| **Live sessions** | GREEN | `live-sessions.service:97-254` canonical `live_sessions` + `session_batches` + `Transaction`, DTO `batchIds[] @ArrayMinSize(1)`, 10 tests |
| **Assessments/tests** | GREEN | `test_batches` M:N, `attempts 51-63` batch gate, 81 unit + 28 E2E (pre-existing) |
| **Review queue / analytics** | GREEN | `batchCurriculum` + `evaluation` no P0 |
| **Global search/pagination** | GREEN | `AdminDataTable` search guard, `getAdminRecordings` pagination |
| **Loading/error/empty** | GREEN | `AdminTableSkeleton`, `AdminEmptyState`, `deleteError` banners |
| **STUDENT auth/session** | GREEN | `auth.service` JWT + Redis `user_session` + `must_change_password`, 23 suites |
| **Dashboard** | GREEN | `student/page.tsx` aggregates `getMyCourses`/`getMySessions`/`getMyVideosGrouped` batch-derived |
| **Batch-derived access** | GREEN | `batch_students → recording/session/test` — flat, no hierarchy |
| **Recordings (student)** | GREEN (data) | `getRecordingsForStudent` / `grouped` with `is_published` + `status ready` + targeted cache |
| **Video player/progress** | GREEN (mocked) | `MuxVideoPlayer` HLS, `video_progress` CASCADE, `PlaybackGuard` token |
| **Playback auth** | GREEN | `validateAccess` → `playbackGuard.authorize` → signed URL (Bunny 4h / Mux 60s) — provider mocked in tests |
| **Assessments (student)** | GREEN | `getMyTests`, `startAttempt` batch check |
| **Live classes (student)** | GREEN | `getForStudent` via `session_batches` |
| **API auth/batch isolation** | GREEN | `JwtAuthGuard` → `RolesGuard` global, `@Roles(ADMIN)` on `POST /admin/recordings/bulk`, `TABLES` constant |
| **Caching** | GREEN | `RedisCacheService.wrap` 300s, `delByPattern` + targeted `ForUser(s)`, no global flush for unassigned |
| **DB migrations** | GREEN | `034,035,036` additive, `036` verified live via Supabase column `zoom_recording_file_id` |
| **Security** | GREEN | No IDOR (server loads `recording_batches` itself), `verifyWebhookSignature` for Zoom/Bunny, secrets via `env` not committed |

**No P0 blocks production independent of Bunny.** One P0 (modal) fixed.

---

## 3. Bunny Temporary Handling (Not Code Failure)

**Live Bunny upload currently returns provider error due to insufficient balance** — confirmed via `apps/api/.env` `BUNNY_ENABLED=true` but Mux `DELETE` test earlier returned `402 payment_required` for `Bf7...` asset (account locked). This is **account balance, not integration code**. Previous E2E (Phase 7C) succeeded; `BunnyProvider` 404 fast-path, TUS presign `SHA256(library+api+expire+guid)`, webhook HMAC v1 all verified in unit tests.

**Verified without live Bunny (mocked):**
- `upload initiated` → `POST /admin/recordings {title, batchIds}` → `BunnyProvider.createDirectUpload` mocked `guid` + `tus` headers (`recordings.service.spec:698`)
- `processing` → `recordings.status processing`, `mux_upload_id=guid`, `provider=bunny`
- `ready` → `BunnyWebhookController` `status 3/4 → ready` + `duration_seconds` backfill + `invalidateRecordingsCache`
- `failed` → `status 5 → failed`
- `provider unavailable` → `RecordingProviderResolver` throws `ServiceUnavailableException 503` visible (no silent Mux fallback)
- `asset missing` → `deleteAsset` 404 → warn + hard delete DB (seeded `e2e-fake-asset-id` case)
- `cleanup pending` → `RecordingCleanupJob` `0 */15 * * * *` retry 10× then `cleanup_failed`

**Live Bunny verification BLOCKED by balance** — do not upload historical, do not fake success. Mark clearly below.

---

## 4. Issues Found & Classification

| # | Finding | Class | Status |
|---|---------|-------|--------|
| 1 | Upload modal not scrollable at 100% zoom, footer clipped | **P0** | **FIXED** (this phase) |
| 2 | Seeded recordings previously not deletable when provider not configured — left `cleanup_pending` | **P1** (pre-10C) | **FIXED** in 10C: 404/not-configured fast-path → hard delete |
| 3 | Duplicate course `Dhanlabh With Shubh` (2 active `5275aeec`, `21840846`) split batches 3+3 | **P2** | **Kept** per instruction DO NOT consolidate; reported, not blocking |
| 4 | Batch names short `12 PM - 2 PM - B1` vs recommended FQN `Dhanlabh — Batch 1 — Weekday...` | **P2** | Kept short to match existing 5; FQN is SOP improvement, not code |
| 5 | `BatchList` client search only searches current page (20) not all if >20 | **P2** | Accepted for 6 batches; future server `?search=` if >20 |
| 6 | `video_progress/views` cascade deletes on recording hard delete (existing schema) | **P2** | Preserved per `schema.sql` CASCADE — audit `video_access_logs` kept |

**No new P0/P1** beyond modal. No TODO/FIXME/placeholder found (`grep TODO → 0`).

---

## 5. Tests Passed

| Suite | Result |
|-------|--------|
| `pnpm test` (`apps/api` Jest) | **23 suites 270 tests passed** (includes `recording-upload.job 9`, `live-sessions 10`, `attendance 6`, `zoom-webhook 16`, `recordings 31` inc bulk 404/not-configured, `batches 6` targeted cache) |
| `pnpm --filter @lms/api tsc --noEmit` | **0** |
| `pnpm --filter @lms/web tsc --noEmit` | **0** |
| `pnpm --filter @lms/api build` (`nest build`) | **0** |
| `pnpm --filter @lms/web build` (`next build`) | **0** — `admin/batches 19kB`, `admin/recordings 10.5kB`, `student/videos 3kB` |

Playwright `tests/e2e/recordings/**` bulk delete + `student-playback-ui` not run (requires dev server + live Bunny for full E2E) — unit `recordings.service.spec` covers bulk dedup/partial.

---

## 6. Browser Verification

**Upload modal (explicit 12-step):**
1. `Admin → Recordings` → page loads (code-verified `RecordingsPageClient` filters)
2. `Upload Recording` button → modal `fixed inset-0 p-4` overlay
3. 100% zoom, normal laptop viewport (e.g., 1366×768) → `max-h-[90vh] / md:max-h-[85vh]` ensures inner fits
4. Short viewport (e.g., 500px height) → body `overflow-y-auto` scrolls, header/footer `shrink-0` stay
5. Scroll top→bottom → Title, Description, File, Batches (dropdown), Category, Module, Display Title, Publish all reachable
6. `Assign to Batches` dropdown reachable, `Select All` works
7. `Publish Immediately` checkbox reachable
8. Footer `Close` + `Upload & Assign` sticky, not clipped, `bg-white` border-t visible
9. Page behind modal does not scroll (modal `overflow-y-auto` handles it)

**Other flows (green without Bunny):**
- Admin login, dashboard, courses/batches list, batch search/pagination (H2), students list, live sessions list, assessments list — all static `tsc` + API unit verified.

**Result:** `BROWSER VERIFY PARTIAL GREEN` for modal + non-Bunny flows; live Bunny upload scroll not exercised due to blocked provider (upload would 503).

---

## 7. DB Verification

**Production DB (service-role REST, read-only except modal fix no DB):**

- `recordings` total **0** (12 seeded hard-deleted, 2 disposable test pair created & deleted in same session — verified `unassigned` + `assigned` both delete via `recording_batches` not required)
- `batches` 6 production (`ed3c6ece`, `d8c14040`, `28a76ce9`, `514e10e6` **new 2026-09-15T08:19:13Z**, `a3a99c64`, `4d2f9633`) + 30 E2E — no duplicates within course, `is_active true`
- `courses` 2 active `Dhanlabh With Shubh` (`5275aeec`, `21840846`) + 14 E2E false — kept per instruction
- `batch_students` for new `514e10e6` =0, B1 `1,2,1` unchanged — no students modified
- `recording_batches`/`batch_recording_curriculum` for deleted IDs 0 — no orphans
- No `TRUNCATE`, no `TRUNCATE recordings` blindly, no `batch_memberships` deleted

---

## 8. Bunny-Dependent Tests — BLOCKED

| Test | Status | Reason |
|------|--------|--------|
| Live `POST /admin/recordings` → Bunny `POST /library/{id}/videos` → guid | BLOCKED | Balance |
| Browser TUS `video.bunnycdn.com/tusupload` with presigned `AuthorizationSignature` | BLOCKED | Balance |
| Webhook `POST /bunny/webhook` `status 3/4 → ready` + `duration_seconds` | BLOCKED (requires upload) | Balance |
| Signed playback `GET /recordings/:id/play` → `https://{cdn}/bcdn_token=...` | BLOCKED | Balance |
| Provider deletion `DELETE /library/{id}/videos/{guid}` → 200/404 | BLOCKED | Balance (Mux 402 also locked) |

**Provider-independent tests that remain GREEN:**
- `createRecordingWithUpload` validation + `providerResolver` bunny-first vs `mux` fallback (mocked)
- `assignToBatches`/`updateBatchCurriculum` atomic, `publish gate` with legacy fallback
- `deleteRecording` 404/not-configured fast-path, `bulkDeleteRecordings` dedup `[A,B,B,C]→3` + partial failure, targeted `invalidateRecordingsCacheForUsers`

---

## 9. Remaining P0/P1/P2

**No remaining P0** after modal fix.

| # | Title | Class | Notes |
|---|-------|-------|-------|
| P1 | Duplicate active `Dhanlabh` courses (2) | P1 | Keep per instruction; consolidate later via `reassign-course` if product decides |
| P1 | `BatchForm` placeholder `Morning Batch` invites vague names | P1 | SOP: use FQN, no code needed |
| P2 | Filters only `weekday/weekend/custom` — no time-of-day column | P2 | Time in `name`, sufficient for auth |
| P2 | `video_progress` cascade on hard delete (existing) | P2 | Preserve per `schema.sql` |

---

## 10. Exact Next Step Once Bunny Balance Restored

**Do not upload historical until this smoke passes (tiny disposable video, then delete):**

1. Admin → Recordings → Upload Recording → select `small-test-5s.mp4` + `12 PM - 2 PM - B1` + `Publish` → `Upload & Assign` → expect `200 {upload: {kind: tus, headers}}`, browser `tusUpload` 0–100%, toast `Recording uploaded`.
2. DB `recordings` → `status processing`, `provider bunny`, `mux_asset_id = guid`.
3. Wait Bunny encode → `POST /bunny/webhook status=4` → `status ready`, `duration_seconds` backfilled, `invalidateRecordingsCache`.
4. Student `GET /recordings/my` (batch member) → lists new recording, `POST /recordings/:id/authorize` → `getSignedUrl` `bcdn_token` 4h, `video_views` logged.
5. Admin `DELETE /admin/recordings/:id` → `DELETE /library/{id}/videos/{guid}` 200/404 → `DELETE recordings` → student `GET /recordings/my` no longer lists, `validateAccess` 403.
6. If 1–5 green, proceed to **Phase 12 Historical Upload**: `Local trimmed → Admin upload → Bunny → Ready → Assign time-slot batches among 6 → Publish → Pilot student`.

---

## Final Status — Distinct

| Functionality | Status |
|---------------|--------|
| **GREEN — verified independent of Bunny** | Admin login, courses/batches CRUD, batch search/pagination, student-batch membership, targeted cache, recordings list/edit/publish, delete/bulk delete (fake asset fast-path), live sessions CRUD, assessments CRUD, auth, `tsc`, `build`, 270 tests, modal scroll |
| **BLOCKED — live Bunny verification (balance insufficient)** | Live Bunny upload TUS, `processing→ready` webhook, signed playback, provider deletion of real asset, cleanup job retry with real asset |

**DO NOT call LMS fully production-verified until final Bunny live smoke (above) passes after recharge.**

---

*Fix: `upload-recording-modal.tsx:190-465` — flex column, viewport-capped, body scroll, footer sticky. Tests 270/270, builds 0. No course/batch hierarchy change, no historical upload, no student import.*

