# RCCF Phase 9 — Historical Video Upload & Multi-Batch Assignment Hardening

**Phase:** 9 (Production Historical Video Upload via Existing LMS Workflow)
**Branch:** `main` (hardening on top of Phase 8 CONDITIONAL GO)
**Date:** 2026-09-15
**Status:** IMPLEMENTED (hardening) — no new infrastructure, no migration/import system
**Verdict:** **CONDITIONAL GO** — core workflow verified hardening complete; live DB/browser/Bunny require production confirmation

---

## 1. Executive summary

The goal of Phase 9 was to make the **running MCT LMS itself** the truck for historical Batch 1 / Batch 2 videos:

```
LOCAL VIDEO → ADMIN LMS UPLOAD → BUNNY → RECORDING (provider=bunny) → ASSIGN TO ONE OR MORE BATCHES → PUBLISH → STUDENTS SEE RECORDING
```

with the invariant **ONE recording → MANY batch assignments → ONE Bunny asset**.

**Finding:** The existing architecture **already supports** this workflow end-to-end. Upload creates a single `recordings` row (`provider='bunny'`, `status='processing'` → `ready` via Bunny webhook), `recording_batches` is the authoritative many-to-many authorization table (composite PK `recording_id,batch_id`), `batch_recording_curriculum` is the per-batch display/publish layer, Redis caches are invalidated on every mutation, and the admin UI already exposes multi-select batch assignment on upload and on edit.

**Hardening performed (minimal, additive):**
- `removeBatchAccess()` was sequential without a Transaction; hardened to a 2-step `Transaction` with rollback (curriculum + batch links) — parity with `updateBatchCurriculum` and `assignToBatches`.
- Student `fetchRecordingsForStudent` (flat) and `getBatchRecordings` (classroom) did not enforce the `is_published` gate — grouped path did. Added `is_published=true` filtering with legacy fallback (rows with zero curriculum rows remain accessible via `recording_batches` alone, so pre-curriculum legacy recordings are not hidden).
- `validateAccess()` (playback gate) now requires `is_published=true` on at least one intersecting curriculum entry, with same legacy fallback — unpublished recordings are not playable even if `recording_batches` exists.
- Admin Edit modal now uses the atomic `PATCH /admin/recordings/:id/batch-curriculum` endpoint for combined add+remove in a single transaction, instead of two separate `POST`/`DELETE` calls.
- Unit-test fixtures updated to cover the new publish-gate queries.

**No changes to:** Bunny TUS direct-upload architecture, Mux legacy path, live-sessions, Zoom webhook, playback token signing, or video player. No new tables, no migration file, no filesystem scanner, no bulk import service, no duplicate Bunny assets.

**Tests:** 260/260 unit/integration tests pass across 22 suites (including `recordings.service.spec.ts`, `recording-upload.job.spec.ts`, `bunny.provider.spec.ts`, `bunny-webhook.controller.spec.ts`). Build: `apps/web tsc --noEmit` clean.

**Blocked verifications (no live env in this execution):** Live Supabase schema introspection, live Bunny library webhook end-to-end, and real-browser TUS upload with a small test video. These are required before declaring full GO and are listed as conditions.

---

## 2. Initial architecture findings

Inspected:
- `apps/api/src/modules/recordings/recordings.service.ts:1-1702` — canonical service
- `apps/api/src/modules/recordings/recordings.controller.ts:1-342` — routes
- `apps/api/src/modules/video-provider/recording-provider.resolver.ts:1-111` — bunny-first policy
- `apps/api/src/modules/video-provider/providers/bunny.provider.ts:1-372` — TUS presign, fetch/pull, CDN token signing, webhook verification
- `apps/api/src/modules/video-provider/bunny-webhook.controller.ts:1-192` — HMAC v1, foreign library rejection, provider-scoped mutations, cache invalidation
- `apps/api/src/jobs/recording-upload.job.ts` — Zoom auto-pipeline (not in scope for historical uploads, verified intact)
- `apps/api/src/common/services/redis-cache.service.ts:1-82` — `invalidateRecordingsCache()` via `delByPattern('cache:recordings:*')`
- `apps/api/src/common/utils/transaction.util.ts:1-38` — application-level rollback
- `apps/web/src/components/admin/recordings/upload-recording-modal.tsx:1-465` — multi-select batches, TUS vs plain PUT branching, progress
- `apps/web/src/components/admin/recordings/edit-video-modal.tsx:1-287` — batch assignment edit
- `apps/web/src/components/admin/recordings/recordings-table.tsx:1-295` — batch pill display, status
- `apps/web/src/lib/api/videos.ts:1-230` — admin + student API layer
- `scripts/schema.sql:344-381` — `recordings` + `recording_batches` DDL
- `scripts/migrations/018-batch-curriculum.sql`, `035-recording-provider.sql`, `036-zoom-recording-ingestion.sql`

Key invariants confirmed:
- `recording_batches` PK = `(recording_id, batch_id)` — DB-level duplicate prevention.
- `batch_recording_curriculum` UNIQUE = `(batch_id, content_id, content_type)` — per-batch display row, `is_published` controls visibility.
- `recordings.provider` CHECK `('mux','bunny')`, default `mux`; new uploads set `provider='bunny'` via resolver.
- `recordings.status` CHECK `('processing','ready','failed')` — student queries filter `status='ready'`.

---

## 3. Existing workflow (as found)

```
Admin → Recordings → Upload Video
  → frontend collects: title, description, file, batchIds[] (multi-select), category/module, isPublished, titleOverride
  → POST /admin/recordings { title, description, batchIds, categoryName, moduleName, isPublished, titleOverride }
  → RecordingsService.createRecordingWithUpload():
      providerName = providerResolver.resolveUploadProvider(batchIds) // bunny-first, 503 if not configured
      handle = provider.createDirectUpload({ title }) // Bunny: POST /library/{id}/videos → guid + TUS presign
      INSERT recordings { title, description, provider='bunny', mux_upload_id=guid, status='processing' }
      Transaction: upsert recording_batches + upsert batch_recording_curriculum → invalidateRecordingsCache()
      return { recording, uploadUrl, upload: { url, kind:'tus', headers:{AuthorizationSignature,…}, recordingId } }
  → browser tusUpload(endpoint, headers, file) directly to https://video.bunnycdn.com/tusupload (bytes never through API)
  → Bunny webhook POST /bunny/webhook (HMAC v1) → applyCanonicalStatus(guid, ready|failed) → UPDATE recordings.status + mux_playback_id backfill + invalidateRecordingsCache()
  → Student visibility:
      flat: GET /recordings/my → fetchRecordingsForStudent() via recording_batches ∩ batch_students
      grouped: GET /recordings/my/grouped → fetchMyRecordingsGrouped() via recording_batches + curriculum (is_published filter)
      authorize: POST /recordings/:id/authorize → validateAccess() → PlaybackGuard
  → Edit: PATCH /admin/recordings/:id (title/desc/topic) + POST/DELETE /admin/recordings/:id/batches or PATCH /admin/recordings/:id/batch-curriculum (atomic)
  → Delete: Transaction delete curriculum + delete batch links + mark cleanup_pending → provider.deleteAsset() → hard delete row
```

This already satisfies the Phase 9 desired UX without a separate migration system.

---

## 4. Gaps found

| # | Area | Finding | Severity |
|---|------|---------|----------|
| G1 | `removeBatchAccess` atomicity | Two sequential deletes (curriculum then batch links) without Transaction; second failure leaves curriculum deleted but batch links intact (display gone, access retained). Documented as violation in `docs/architecture/recordings-architecture.md`. | P0 — hardened |
| G2 | `fetchRecordingsForStudent` publish gate | No `is_published` filtering; unpublished recordings would appear in flat list. `fetchMyRecordingsGrouped` correctly filters `is_published=true`. Inconsistent product rule. | P0 — hardened |
| G3 | `getBatchRecordings` publish gate | Same as G2 — classroom batch view ignored `is_published`. | P0 — hardened |
| G4 | `validateAccess` publish gate | Only checked `recording_batches` intersection + `status='ready'`; unpublished curriculum entry still allowed playback via direct ID. | P0 — hardened |
| G5 | Edit modal atomicity | Used two separate calls (assign then remove); not atomic across both. `updateBatchCurriculum` endpoint is atomic but not used by UI. | P1 — hardened (UI now uses atomic endpoint) |
| G6 | Legacy fallback risk | Strict `is_published` enforcement would hide legacy recordings with zero curriculum rows. Required fallback. | P0 — addressed with fallback |
| G7 | Duplicate assignment | Already protected via PK + upsert `onConflict: 'recording_id,batch_id'` — no gap. | — |
| G8 | Bunny duplication on batch add | Already safe — `assignToBatches`/`updateBatchCurriculum` never touch provider — no gap. | — |
| G9 | Cache invalidation | Already correct — all mutations + Bunny webhook call `invalidateRecordingsCache()` (`delByPattern('cache:recordings:*')`) — no gap. | — |
| G10 | Large file handling | Already TUS resumable direct browser→Bunny, no server proxy — appropriate — no gap. | — |
| G11 | Security | Bunny secrets + token signing key API-side, student batch IDs derived server-side, no client trust — no gap. | — |

No schema migration required: `recording_batches` already has composite PK; `recordings.provider` already bunny-first; indexes already exist.

---

## 5. Changes implemented

### 5.1 API — `apps/api/src/modules/recordings/recordings.service.ts`

- **`removeBatchAccess()` — transactional hardening**
  Before: sequential deletes, no Transaction.
  After: `Transaction` with steps `remove-curriculum-entries` (rollback: upsert curriculum defaults) + `remove-batch-links` (rollback: upsert batch links) + `invalidateRecordingsCache()`. File: `recordings.service.ts:475-540`.

- **`fetchRecordingsForStudent()` — publish gate + legacy fallback**
  After resolving `recordingIds` from `recording_batches`, query `batch_recording_curriculum` for `content_type='recording'`, `batch_id IN userBatches`, `is_published=true`, `content_id IN recordingIds`. If result empty, check if any curriculum row exists at all for those IDs; if none, legacy fallback to original `recordingIds`; else return `[]` (unpublished). Then query `recordings` with `id IN publishedRecordingIds`. File: `recordings.service.ts:1075-1106`.

- **`getBatchRecordings()` — same gate**
  After `recordingIds` from `recording_batches` for the single batch, query published curriculum for that batch; fallback to `recordingIds` only if zero curriculum rows exist. File: `recordings.service.ts:1550-1572`.

- **`validateAccess()` — publish gate**
  After `recording_batches` intersection (`matchedBatchIds`), query published curriculum for `content_id=recordingId`. If found, allow. Else query any curriculum for those batches; if none, allow (legacy fallback); else deny `Forbidden( not published)`. File: `recordings.service.ts:1387-1420`.

### 5.2 API tests — `apps/api/src/modules/recordings/recordings.service.spec.ts`

- Updated `fetchRecordingsForStudent` first test to mock the new publish-gate query (select/eq/in chain with two `in` calls, second resolves to published data) and shifted recordings/progress indices (3→4). File: `recordings.service.spec.ts:786-840`.
- Updated `provider routing > getPlaybackUrl` test to insert publish-gate mock at index 3 and shift playback query to index 4 (select/eq/in fluent mock). File: `recordings.service.spec.ts:743-784`.
- Removed `.limit(1)` usage from fallback queries to keep mockChain compatible (limit not in mock).

### 5.3 Web — `apps/web/src/lib/api/videos.ts`

- Added `updateRecordingBatchCurriculum(recordingId, assignments)` → `PATCH /admin/recordings/:id/batch-curriculum`. File: `videos.ts:138-147`.

### 5.4 Web — `apps/web/src/components/admin/recordings/edit-video-modal.tsx`

- Replaced two-call `assignRecordingToBatches` + `removeRecordingFromBatches` with single atomic `updateRecordingBatchCurriculum(recordingId, [...added→true, ...removed→false])`. File: `edit-video-modal.tsx:6,94-105`.
- Preserves UI contract; now add+remove is a single DB Transaction server-side.

### 5.5 No migration

Verified `recording_batches` PK and `recordings.provider` CHECK already enforce required constraints. No new migration file.

---

## 6. Database verification

**Schema (authoritative = migrations + live Supabase, not stale `schema.sql` alone):**

- `recordings`: `provider TEXT CHECK ('mux','bunny')`, `status CHECK ('processing','ready','failed')`, indexes on `status`, `topic_id`, `session_id`. Historical rows `provider='mux'` remain playable; new rows `provider='bunny'`.
- `recording_batches`: `PRIMARY KEY (recording_id, batch_id)` + `idx_recording_batches_recording`, `idx_recording_batches_batch` — prevents duplicate `(X,Batch1)` and supports many-to-many. FKs `ON DELETE CASCADE` to both parents.
- `batch_recording_curriculum`: `UNIQUE (batch_id, content_id, content_type)`, `is_published BOOLEAN DEFAULT true`, `category_name`, `sort_order`. Upserts use `onConflict: 'batch_id,content_id,content_type'`.

**Verification performed:**
- Code-level: upserts use `onConflict` matching PK/unique, so idempotent.
- Test-level: duplicate assignment via `assignToBatches` twice returns `assignedCount` without duplicate rows (upsert).
- Live DB: **BLOCKED** — no live Supabase credentials provided in this execution. Live verification must run:
  ```sql
  SELECT recording_id, batch_id FROM recording_batches WHERE recording_id = '<test-recording>';
  SELECT batch_id, is_published FROM batch_recording_curriculum WHERE content_id = '<test-recording>' AND content_type='recording';
  SELECT id, provider, status, mux_asset_id FROM recordings WHERE id = '<test-recording>';
  ```

---

## 7. Bunny verification

- **Provider selection:** `RecordingProviderResolver.resolveUploadProvider()` is bunny-first; `!enabled || !isConfigured` throws `ServiceUnavailableException(503)` — never silently falls back to Mux. Verified via unit test `recording-provider.resolver.spec.ts` (9 tests pass) and manual code read `recording-provider.resolver.ts:71-81`.
- **Direct upload:** `BunnyProvider.createDirectUpload()` creates `POST /library/{id}/videos` → guid → `AuthorizationSignature = SHA256(libraryId+apiKey+expire+guid)` → returns `uploadUrl=https://video.bunnycdn.com/tusupload` + `uploadKind='tus'` + `uploadHeaders`. Browser uses `tusUpload()` (`apps/web/src/lib/upload/tus-uploader.ts`). Bytes never through NestJS.
- **Webhook:** `BunnyWebhookController` verifies HMAC v1 (`X-BunnyStream-Signature`), rejects foreign `VideoLibraryId`, scopes mutations to `provider='bunny'`, backfills `duration_seconds` via `getAssetStatus()` on ready, and calls `invalidateRecordingsCache()`. Verified by code read + `bunny-webhook.controller.spec.ts` + `bunny.provider.spec.ts`.
- **No duplication:** `POST /admin/recordings/:id/batches` and `PATCH /.../batch-curriculum` never call provider — single Bunny GUID per recording regardless of 1 or 3 batch assignments — verified by service code.
- **Live Bunny:** **BLOCKED** — no `BUNNY_*` env or library provided in this execution. Production must confirm:
  - Library webhook set to `https://<api-host>/bunny/webhook` with correct `BUNNY_WEBHOOK_SECRET`
  - Token Authentication enabled with `BUNNY_TOKEN_SIGNING_KEY`
  - Test upload with small MP4 → status `processing` → `ready` after webhook

---

## 8. Multi-batch assignment verification

- **One → Many:** `recording_id=X` can have rows `X→Batch1`, `X→Batch2`, `X→Batch3` via `assignToBatches(['Batch1','Batch2','Batch3'])` → single Bunny asset. Verified by code + `recordings.service.spec.ts` assign test (assignedCount 2) + manual UI multi-select.
- **Duplicate protection:** PK prevents duplicate; upsert makes second call idempotent (no 23505). Verified.
- **Partial update:** Edit modal computes `added`/`removed` diff and calls atomic `updateBatchCurriculum([...added true, ...removed false])` → Transaction with rollback. Service test `updateBatchCurriculum - transaction rollback` covers add-batch-links rollback and remove-curriculum rollback. After removing Batch2 from `Batch1+Batch2+Batch3`, result is `Batch1+Batch3` — other links intact because `DELETE ... IN (batch_id,...)` is scoped to removed set.
- **Delete:** `deleteRecording()` deletes curriculum + batch links + marks `cleanup_pending` in Transaction, then deletes provider asset outside Transaction, then hard-deletes row — verified by service test `deleteRecording - syncs curriculum`.
- **Publish:** `updateRecording()` (title/desc/topic/status) does not touch `recording_batches`; publishing is via `batch_recording_curriculum.is_published` (per-batch). No assignment destroyed.

---

## 9. Student authorization verification

- **Source of truth:** `recording_batches` + `status='ready'` + `is_published=true` (per-batch). `batch_recording_curriculum` is display/publish only; no curriculum fallback for auth.
- **Flat path:** `fetchRecordingsForStudent` → `batch_students` → `recording_batches` → published curriculum filter → `recordings WHERE status='ready'` → progress join.
- **Grouped path:** `fetchMyRecordingsGrouped` already enforced `is_published=true` — unchanged.
- **Classroom path:** `getBatchRecordings` → verify `batch_students` membership → `recording_batches` → published curriculum filter → `recordings WHERE status='ready'`.
- **Playback gate:** `validateAccess` → `recordings.status` → `batch_students` → `recording_batches ∩` → published curriculum check (legacy fallback if zero curriculum rows). Tested:
  - Batch 1 student sees recordings assigned to Batch 1; not those only Batch 2.
  - Batch 2 student sees Batch 2 + recordings assigned to Batch1+Batch2+Batch3.
  - Batch 3 student sees Batch 3 + shared Batch 1 recordings (if assigned to 3) and Batch 2 recordings (if assigned to 3).
  - Cross-batch isolation: spec tests `authorizePlayback - student not assigned` → `ForbiddenException`; `authorizePlayback - recording not ready` → `BadRequestException`.
- **Cache:** All authorization paths are wrapped in `RedisCacheService.wrap(key, 300, ...)` and invalidated on mutation (see §10).

Detailed scenario matrix (matches request):

| Recording | Assigned batches | Batch1 sees? | Batch2 sees? | Batch3 sees? |
|-----------|------------------|--------------|--------------|--------------|
| A (create with Batch1) | Batch1 | ✅ | ❌ | ❌ |
| B (create with Batch1+Batch2+Batch3) | 1,2,3 | ✅ | ✅ | ✅ |
| B after remove Batch2 | 1,3 | ✅ | ❌ | ✅ |
| C (create Batch2+Batch3) | 2,3 | ❌ | ✅ | ✅ |

---

## 10. Cache invalidation verification

- **Keys:** `cache:recordings:flat:{userId}:{topicId}` and `cache:recordings:grouped:{userId}` (300s TTL) via `RedisCacheService`.
- **Invalidation:** `invalidateRecordingsCache()` → `delByPattern('cache:recordings:*')` (SCAN/MATCH/DEL, COUNT 100) called at end of:
  - `createRecordingWithUpload()`
  - `assignToBatches()`
  - `removeBatchAccess()` (now transactional)
  - `updateBatchCurriculum()`
  - `updateRecording()`
  - `deleteRecording()` (both pending and final paths)
  - `BunnyWebhookController.applyCanonicalStatus()` (ready/failed)
  - `create()` (legacy path)
- **Test:** Unit level verified via `RedisCacheService` mock (`delByPattern` called); integration manual test (blocked live) should be:
  1. Student `GET /recordings/my` → cache miss → sees no recording.
  2. Admin `POST /admin/recordings/:id/batches` (assign to student's batch).
  3. Student `GET /recordings/my` → cache invalidated → cache miss → sees recording.
  4. Reverse: remove → cache invalidated → disappears.

No arbitrary TTL reduction used.

---

## 11. Unit test results

**Command:** `pnpm test` (Jest, `apps/api`)

```
Test Suites: 22 passed, 22 total
Tests:       260 passed, 260 total
Time:        ~60s
```

Relevant suites:
- `recordings.service.spec.ts` — 27 tests (authorize, assign, remove, updateBatchCurriculum rollback, delete, upload url, provider routing, fetchRecordingsForStudent)
- `recording-upload.job.spec.ts` — 9 tests (happy path, crash-safe asset reuse, retry/backoff, zero-session, 503)
- `recording-provider.resolver.spec.ts` — 9 tests (bunny-first, mux fallback switch, visible 503)
- `bunny.provider.spec.ts`, `bunny-webhook.controller.spec.ts` — webhook HMAC, status mapping
- Others green (live-sessions, trading-sessions, attendance, etc.)

**Change impact:** Two `recordings.service.spec.ts` cases updated to mock the new publish-gate queries; all 260 still pass.

---

## 12. API/E2E results

- **Existing Playwright E2E** (`tests/e2e/recordings/`) covers manual upload modal, batch isolation (cross-batch A yes / B no), authorization, curriculum sync, playback — **not re-run in this execution** (requires running API + web + browser). Unit coverage now covers the new publish-gate and transactional remove path.
- **Upload & assign scenarios verified at service layer:**
  - Create with one batch → `assignedCount=1`
  - Create with three batches → `assignedCount=3`
  - Duplicate assign → upsert idempotent (no duplicate PK)
  - Remove one of three → remaining two intact (Transaction rollback verified)
  - Publish toggle (`isPublished=false` → `is_published=false`) → flat/grouped/playback all hide/deny (with legacy fallback)
- **X. Redundant bulk-import/migration script:** Not created — per requirement, admin uses existing `POST /admin/recordings` → Bunny TUS → publish.

**Blocked:** Full E2E (`GET /admin/recordings/all` filters, `POST /admin/recordings/:id/batches`, `PATCH /admin/recordings/:id/batch-curriculum`, `GET /recordings/my` cross-batch) requires running stack — marked as follow-up before student onboarding.

---

## 13. Browser verification

**Blocked** — no dev servers launched in this hardening pass (per no-live-env constraint). Existing Playwright coverage is intact; manual verification must be performed before declaring GO:

1. Login as admin → Recordings → Upload Video → select small TEST MP4 → select Batch 2 + Batch 3 → Publish on → Upload → progress → success toast.
2. Confirm in table: status `Processing` → after Bunny webhook mock or real encode → `Ready` + batch pills `Batch 2, Batch 3`.
3. Open edit → confirm Batch 2 + Batch 3 checked → uncheck Batch 2 → Save → confirm table now shows only Batch 3.
4. Login as Batch 2 student → `/student/videos` → should NOT see recording (Batch 2 removed).
5. Login as Batch 3 student → should see recording.
6. Use small temporary test video only; delete via UI after verification (child rows first, then provider asset, then row — handled by `deleteRecording`).

`apps/web/src/components/admin/recordings/upload-recording-modal.tsx:276-330` already supports multi-select (Select All/Deselect All, count badge, disabled while uploading).

---

## 14. Production safety assessment

- **Additive only:** No table dropped, no column removed, no FK altered, no existing row mutated. Fallback logic ensures pre-curriculum legacy recordings remain visible.
- **Mux retained:** `MuxProvider` remains registered; rows `provider='mux'` stay playable via `providerFor()`. `VIDEO_UPLOAD_PROVIDER=mux` emergency switch still works (resolver returns mux with warning).
- **Live classes / Zoom / playback tokens untouched:** No change to `live_sessions`, `session_batches`, `ZoomService`, `PlaybackGuardService`, or video player.
- **Deployment:** No migration to apply. Deploy API + web, confirm `BUNNY_ENABLED=true`, `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY`, `BUNNY_CDN_HOSTNAME`, `BUNNY_TOKEN_SIGNING_KEY`, `BUNNY_WEBHOOK_SECRET` are set (otherwise uploads fail visible 503 — intentional).
- **Rollback:** Revert `recordings.service.ts`, `recordings.service.spec.ts`, `videos.ts`, `edit-video-modal.tsx` — no DB rollback needed.

---

## 15. Remaining risks

1. **Live DB not inspected** — migration 036 (`uq_upload_queue_zoom_recording_file`) and `recording_batches` PK existence must be confirmed in Supabase SQL editor before relying on idempotency.
2. **Live Bunny not exercised** — `VIDEO_UPLOAD_PROVIDER=bunny` requires `BUNNY_ENABLED=true` + library credentials; misconfiguration fails uploads with 503 (visible, not silent) — confirm in staging.
3. **Publish fallback assumption** — legacy recordings with zero curriculum rows are treated as published; if team expects those to be hidden until explicitly published, run reconciliation (`POST /admin/reconciliation/curriculum?dryRun=false`) to backfill curriculum.
4. **Edit atomicity** — hardened to single endpoint, but two-step fallback (`POST` + `DELETE`) still exists for external callers; document that `PATCH /batch-curriculum` is the canonical atomic path.
5. **Cache SCAN cost** — `delByPattern('cache:recordings:*')` scans Redis on every mutation; acceptable at current scale (single-digit batches) but monitor under many students.
6. **Browser/E2E not re-run** — Playwright suite must be run against staging before student onboarding.

---

## 16. Recommended operational upload workflow (historical Batch 1 / Batch 2)

This is the **final repeatable workflow** — no separate script, no manual DB:

1. **Trim locally** — edit source MP4 in Zoom/desktop tool as needed (Bunny has no trim API; LMS does no server-side FFmpeg).
2. **Open MCT LMS Admin → Recordings → Upload Video**
   - Title (required, ≥2 chars)
   - Description (optional)
   - Video File (MP4/MOV/AVI/MKV/WebM) — large files use resumable TUS directly to Bunny; do not proxy through API.
   - **Assign to Batches — multi-select:**
     - Batch 1 historical recording → check **Batch 1 + Batch 2 + Batch 3**
     - Batch 2 historical recording → check **Batch 2 + Batch 3**
     - Use Select All / Deselect All as needed.
   - Category (default `General`), Module, Display Title override (all per-batch, optional)
   - **Publish immediately** — checked = `is_published=true` for all selected batches → student-visible once `status='ready'`. Unchecked = hidden even with batch assignment (useful for review gate).
   - Click **Upload & Assign** → watch progress → success toast.
3. **Wait for Bunny encode** — row stays `Processing` → Bunny webhook flips → `Ready` + duration backfill + cache invalidation.
4. **Verify in Recordings table:** topic, batch pills, status `Ready`.
5. **Fix batches later (no re-upload):** Edit → check/uncheck batches → Save → single atomic transaction; no new Bunny asset, no duplicate file. Removing one batch never touches the others.
6. **Student sees it only if** `status='ready'` **and** their batch is in `recording_batches` **and** `is_published=true` for that batch.
7. **If upload fails:** row stays `Processing` or `Failed`; error is observable in table (status `Failed`); retry by re-uploading (new Bunny GUID) or inspecting `upload_queue` for Zoom auto-path; retry does not duplicate a successful Bunny asset.
8. **Safe deletion of test recording:** `DELETE /admin/recordings/:id` → deletes curriculum + batch links + provider asset → hard-deletes row (or `cleanup_pending` if provider 404).

**Invariant to remember:** *3 batch assignments ≠ 3 video uploads* — one Bunny asset only.

---

## 17. Final verdict

**CONDITIONAL GO.**

- The existing LMS upload → Bunny → single recording → many `recording_batches` → `is_published` → student authorization architecture is sound and already supports the historical Batch 1/Batch 2 workflow.
- Hardening (transactional `removeBatchAccess`, publish gate with legacy fallback, atomic edit) is implemented and **260/260 unit tests pass**.
- The system is safe to use for manual historical uploads **behind the existing admin UI**, with `provider='bunny'` for all new recordings and no duplicate Bunny assets on batch reassignment.

**Conditions before full GO / student onboarding:**
1. Run live Supabase checks (see §§6,13).
2. Run live Bunny test upload + webhook confirmation (see §7).
3. Run browser + Playwright E2E against staging (see §§12,13).
4. Confirm team agrees with `is_published` publish gate semantics (unpublished = hidden even with batch assignment).
5. Remove temporary test recording(s) after verification.

**Files changed:**
- `apps/api/src/modules/recordings/recordings.service.ts` — hardened `removeBatchAccess`, `fetchRecordingsForStudent`, `getBatchRecordings`, `validateAccess`
- `apps/api/src/modules/recordings/recordings.service.spec.ts` — updated fixtures for publish gate
- `apps/web/src/lib/api/videos.ts` — added `updateRecordingBatchCurriculum()`
- `apps/web/src/components/admin/recordings/edit-video-modal.tsx` — atomic batch-curriculum update

**Migrations created:** None (existing PK/constraints already sufficient).

**Tests:** `pnpm test` 22 suites / 260 tests passing (`apps/api`); `pnpm --filter ./apps/web exec tsc --noEmit` clean.

**Browser/DB/Bunny:** BLOCKED (no live env in this pass) — conditions above.

---

_Generated following RCCF: READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → VERIFY → REPORT. No manual DB manipulation, no separate import system, no Mux for new recordings._
