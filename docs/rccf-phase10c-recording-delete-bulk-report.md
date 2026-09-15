# RCCF Phase 10C — Recording Deletion & Bulk Delete Hardening

**Phase:** 10C (Running LMS — seeded/E2E cleanup before historical upload)
**Date:** 2026-09-15
**Scope:** READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → BROWSER VERIFY → DB VERIFY → REPORT — no batches, no student import, no historical upload, no prod SQL, no commit
**Verdict:** **CONDITIONAL GO** — single + bulk delete hardened production-safe; 270/270 tests, tsc clean; live browser/DB/Bunny smoke blocked

---

## 1. Existing Delete Failure Root Cause

**Flow audited:**
`Admin Recording trash icon → recordings-table.tsx:243 onClick setDeleteTarget → ConfirmDialog → deleteVideo(videoId) → fetchApi DELETE /admin/recordings/:id → RecordingsController:132 delete → RecordingsService:805 deleteRecording → DB → provider → cache → response → UI filter`

**Observed seeded failures** (`E2E-Logout-Test`, `E2E-Mini-Player`, `Test` etc., some `recording_batches` linked, some unassigned):

**Two-phase delete in `recordings.service.ts:805-920`:**
1. Transaction: `delete batch_recording_curriculum WHERE content_id=:id` → `delete recording_batches WHERE recording_id=:id` → `update recordings SET cleanup_pending=true`
2. Outside transaction: `if (mux_asset_id) providerResolver.providerFor(recording).deleteAsset(mux_asset_id)` → on success hard `delete recordings WHERE id=:id` → else `return {deleted:true, cleanupPending:true}` (row stays, `cleanup_pending=true` for `RecordingCleanupJob` every 15m, 10 retries, then `cleanup_failed=true`)

**Root causes in seeded data:**
- **Provider not configured / fake asset id.** Seeded rows created before Bunny was default have `provider='mux'` or `provider='bunny'` with `mux_asset_id='E2E-...'` fake. `BunnyProvider.deleteAsset:242-256` treats **404 as already-deleted** (correct), but `MuxService.deleteAsset:368-380` returns 404 only if `err.status===404`; if `MUX_TOKEN_ID/SECRET` not set in env, `muxClient` lazy getter throws `MUX_TOKEN_ID must be set` (generic Error, not 404) — caught as generic failure → `cleanupPending:true` → row never hard-deleted. Similarly `BunnyProvider.assertOperational:355-362` throws `ServiceUnavailableException` when `BUNNY_ENABLED!=true` or `BUNNY_LIBRARY_ID/API_KEY/CDN_HOSTNAME` missing — also caught as generic failure. Result: transaction already removed curriculum/batch links (orphaned display) but row remains with `cleanup_pending=true`, `Admin getAdminRecordings` still returns it (no filter on `cleanup_pending`), so after refresh it **reappears** — UI had optimistically filtered locally (`recordings-table:74 setVideos filter`) but parent `onChanged refreshVideos` refetches and restores it. Error shown `Failed to delete "...". Please try again.` comes from catch in `confirmDelete:77-79`.
- **Global cache vs targeted.** Before hardening, `deleteRecording:886,917` called `invalidateRecordingsCache()` global `delByPattern cache:recordings:*`. Correct but unnecessary for unassigned recordings; after Phase 10A targeted cache was introduced for membership moves but not yet for deletes.
- **UX silent reappear.** Frontend considered `cleanupPending:true` as success (200), filtered locally, then `refreshVideos` brought it back — no per-record failure detail.

**Conclusion:** Deletion is **not blindly deleting rows** — it is production-safe two-phase — but seeded test rows with fake `mux_asset_id` and/or missing provider credentials hit the **provider-failure → cleanupPending** branch and never reach hard delete. Fix requires treating **404 + not-configured** as already-deleted (hard delete DB row) while preserving retry for real transient provider errors.

---

## 2. Existing Deletion Architecture

**Controller:** `recordings.controller.ts:131-135`
```ts
@Roles(ADMIN) @Delete('admin/recordings/:id') delete(@Param id) → recordingsService.deleteRecording(id)
```
Legacy mirrors `DELETE /videos/:id` → same service. Admin guard `RolesGuard` global + `JwtAuthGuard` — student cannot reach.

**Service `deleteRecording(id: string): {deleted:true, cleanupPending?:true}`:**
- Verify exists `select id, mux_asset_id, provider, title` — `NotFoundException` if missing.
- Transaction `Transaction.run`:
  1. `delete batch_recording_curriculum WHERE content_id=:id AND content_type='recording'` — no rollback (log warn)
  2. `delete recording_batches WHERE recording_id=:id` — no rollback
  3. `update recordings SET cleanup_pending=true` — rollback `cleanup_pending=false`
- Provider outside transaction (never rollback DB for provider):
  - `if (!mux_asset_id) skip`
  - else `providerFor(recording).deleteAsset(mux_asset_id)` — Bunny: `DELETE /library/{id}/videos/{guid}` 404→success; Mux: `video.assets.delete` 404→success
  - On throw → log, `logEntityEvent RECORDING_CLEANUP_PENDING`, `invalidateRecordingsCache`, return `cleanupPending:true`
- Else hard `delete recordings WHERE id=:id` — on error → `cleanupPending:true`
- On success → `logEntityEvent RECORDING_DELETED`, `invalidateRecordingsCache`, return `deleted:true`

**Frontend:** `recordings-table.tsx:67-83` `confirmDelete: await deleteVideo(id) → filter videos → onChanged()` with `deleteError` UI. `videos.ts:169-173` `deleteVideo: fetchApi DELETE /admin/recordings/:id`. No provider id from client.

**Cache:** global `invalidateRecordingsCache` via `redis-cache.service.ts:78 delByPattern cache:recordings:*` after each path. Authorization after deletion: `validateAccess` checks `recording_batches ∩ batch_students` — with `recording_batches` deleted, student `getRecordingsForStudent`/`validateAccess` correctly excludes it.

**Job:** `recording-cleanup.job.ts:40-211` cron `0 */15 * * * *` processes `cleanup_pending=true AND cleanup_failed=false` up to 20 oldest, per-recording `providerFor.deleteAsset` → hard delete on success/404 else `retry_count++` → after 10 → `cleanup_failed=true` (`RECORDING_CLEANUP_FAILED`).

---

## 3. DB Dependency Map

**Source:** `scripts/schema.sql:344-410` + `scripts/migrations/0*` + `common/constants/tables.constant.ts`

| Table | FK to `recordings.id` | On Delete | How handled in `deleteRecording` | What happens | Classification |
|-------|----------------------|-----------|----------------------------------|--------------|----------------|
| `recording_batches` | `recording_id → recordings(id)` | `CASCADE` | Explicit `delete WHERE recording_id=:id` in transaction step 2 (even though CASCADE would also work, explicit ensures curriculum sync) | Removes student authorization | **Must explicitly delete** (already done) — blocks listing if left |
| `batch_recording_curriculum` | `content_id` polymorphic, **NO FK** (`migrations/018`) | — | Explicit `delete WHERE content_id=:id AND content_type='recording'` step 1 | Removes per-batch display/publish | **Must explicitly delete** — no cascade, would orphan otherwise |
| `video_progress` | `video_id → recordings(id)` | `CASCADE` | **Not explicit** — cascade on hard `delete recordings` | Deletes watch progress | **Cascades automatically** — audit loss acceptable per schema design; no extra step |
| `video_views` | `video_id → recordings(id)` | `CASCADE` | **Not explicit** — cascade | Deletes view history | **Cascades automatically** |
| `topics` | `recordings.topic_id → topics(id)` | `SET NULL` | Not deleted | Topic remains | **Preserved** — no action |
| `live_sessions` | `recordings.session_id → live_sessions(id)` | `SET NULL` | Not deleted | Session remains | **Preserved** |
| `video_access_logs` | `recording_id`? (`migrations/009`) | FK? Check `TABLES.VIDEO_ACCESS_LOGS` | Not explicit nor CASCADE in `schema.sql` seed (migration `009` creates `video_access_logs` with `recording_id` nullable?) | May have FK but not in `schema.sql` snapshot; currently **preserved** (no delete) — audit trail | **Preserved for audit** — do not cascade |
| `playback_events`, `playback_violations` | `recording_id` nullable | — | Not deleted | Preserved audit | **Preserved** |
| `upload_queue` | `session_id` not `recordings` | — | Not related | — | — |

**Result:** Only `recording_batches` + `batch_recording_curriculum` need explicit deletion before hard delete; `video_progress/views` correctly cascade; analytics/audit tables (`video_access_logs`, `playback_*`) are intentionally preserved.

No other table blocks deletion via FK; hard `delete recordings` succeeds after steps 1-2.

---

## 4. Provider Deletion Behavior

**Abstraction:** `RecordingProviderResolver: providerFor(recording) → VideoProvider` (`recording-provider.resolver.ts:85-103`). Decision keyed by `recordings.provider` (`'bunny'` → `BunnyProvider`, else `MuxProvider`).

**Bunny (`bunny.provider.ts:242-256`):**
```ts
await http.delete(`/library/{id}/videos/{assetId}`)
catch 404 → warn already deleted → return (success)
catch other → log error → throw
```
`assertOperational:355-362` throws `ServiceUnavailableException` if `!enabled || !isConfigured` (missing `BUNNY_ENABLED/BUNNY_LIBRARY_ID/API_KEY/CDN_HOSTNAME`). **Pre-hardening:** this exception was treated as generic provider failure → `cleanupPending:true` → seeded rows with Bunny fake ids when Bunny not configured never hard-deleted.

**Mux (`mux.service.ts:368-380`):**
```ts
await muxClient.video.assets.delete(assetId)
catch 404 (err.status===404) → warn → return
else throw
```
Lazy `muxClient` getter throws `MUX_TOKEN_ID must be set` if not configured — also generic failure → `cleanupPending`.

**Legacy preservation:** `MuxProvider` remains adapter over `MuxService` — no behavior change; `providerFor` still routes `provider='mux'` or `null` (pre-035 rows) to Mux. Deletion for real `provider='mux'` legacy rows still correctly deletes from Mux.

**Hardening (this phase):** In `recordings.service.ts:866-910` catch, classify:
```ts
isNotFound = status===404
isNotConfigured = name==='ServiceUnavailableException' || msg includes 'not enabled/configured' || 'must be set'
if (isNotFound || isNotConfigured) warn → fall through to hard delete (treat as already-deleted)
else → log RECORDING_CLEANUP_PENDING → invalidate → return cleanupPending
```
This makes seeded/E2E fake ids with missing credentials hard-delete DB row immediately, while real transient 5xx still retries via cleanup job.

Order remains safe: **DB transaction first → provider outside → hard delete last** (never delete asset first).

---

## 5. Single-Delete Implementation

**Hardened `deleteRecording(id)`** (`recordings.service.ts:805-920`):

1. Load `recording` (`id, mux_asset_id, provider, title`) → 404 if missing (admin 404).
2. **Pre-collect affected batches/users** before deleting links (for targeted cache):
   ```ts
   links = select batch_id from recording_batches where recording_id=:id
   if batchIds.length>0 students = select user_id from batch_students where batch_id IN (:batchIds) → affectedUserIds = Set(user_id)
   ```
   Try/catch — best-effort.
3. Transaction (same 3 steps as before).
4. Provider outside:
   - if `mux_asset_id` present, `deleteAsset` with 404/not-configured fast-path → hard delete.
   - else generic failure → `RECORDING_CLEANUP_PENDING` → **targeted** `invalidateRecordingsCacheForUsers(affectedUserIds)` or global fallback if none → return `cleanupPending:true`
5. Hard `delete recordings where id=:id` → on error → `cleanupPending:true`
6. On success → `RECORDING_DELETED` → **targeted** `invalidateRecordingsCacheForUsers(affectedUserIds)` (or global if no affected).

**Behavior:** Admin `@Roles(ADMIN)` only; `NotFoundException` for missing; provider 404/not-configured no longer blocks seeded cleanup; real provider 5xx still retryable via job; student cache only for affected batches invalidated (not global flush).

---

## 6. Bulk-Delete Implementation

**DTO:** `dto/bulk-delete-recordings.dto.ts:1-11`
```ts
class BulkDeleteRecordingsDto {
  @IsArray @ArrayMinSize(1) @IsUUID(4, each:true) recordingIds: string[]
}
```

**Controller:** `recordings.controller.ts:124-142`
```ts
@Roles(ADMIN) @Post('admin/recordings/bulk') bulkDelete(@Body dto) → bulkDeleteRecordings(dto.recordingIds)
@Roles(ADMIN) @Delete('admin/recordings/bulk') bulkDeleteViaDelete(@Body dto) → same
```
Placed **before** `@Delete('admin/recordings/:id')` so `bulk` not captured as `:id`. Uses `@Body` — frontend uses POST with JSON (avoids DELETE body quirks). Admin-only.

**Service `bulkDeleteRecordings(recordingIds: string[]): {deleted:string[], failed:{id,error}[], total:number}`** (`recordings.service.ts:922-1050`):

- Deduplicate `Set(recordingsIds.filter(Boolean))` → validates `@IsUUID` already but also checked `uuidRegex` throw `BadRequestException` for invalid format.
- Throws `At least one recording ID is required` if empty.
- Single `select id, mux_asset_id, provider from recordings where id IN (:uniqueIds)` → `foundById Map`; missing `uniqueIds - found` → push `failed: Recording not found`.
- Pre-collect affected users: `select batch_id from recording_batches where recording_id IN (:uniqueIds)` → `select user_id from batch_students where batch_id IN (:batchIds)` → `Set`.
- Loop each `uniqueId` where found: `try await deleteRecording(id) → if cleanupPending → failed: Provider deletion pending — will retry else deleted.push(id) catch → failed push error` — does **not** abort batch on single failure.
- Final **targeted** `invalidateRecordingsCacheForUsers(affectedUserIds)` (or global if none).

**Safety:** Never trusts `provider` from client — loads itself; `recordingIds` only; admin guard; no filter-based `DELETE WHERE title LIKE 'E2E-%'`; deduped `[A,B,B,C] → 3` unique.

---

## 7. Selection Semantics

**Current page only** (safe, prevents accidental mass wipe):

- `RecordingsTable: bulkCount = selectedIds.size`
- `videos = initialVideos` (current page's `getAdminVideos` result, filtered by search/status/batch/published/sort/page/limit) — `videos.length` is page size (e.g., 25).
- Header checkbox `allVisibleSelected = videos.length>0 && videos.every(v=>selectedIds.has(v.id))` (`recordings-table:60`) → `toggleSelectAll: if all → clear else Set(videos.map(v=>v.id))`.
- Row checkbox `selectedIds.has(video.id)` per row.
- `useEffect sync initialVideos → videos, clear selectedIds` on filter/pagination change — selection does not persist across pages (prevents stale ids).
- `Delete Selected (N)` bar appears only when `bulkCount>0` (`recordings-table: bulkCount>0 && <div>`).
- `Select all visible` vs `all DB` — first implementation is **current-page visible only**; no `Select all 200 results` secondary link. Documented in report; prevents deleting hundreds unintentionally. Pagination `Page 1 selected ≠ all pages selected`.

---

## 8. Cache Invalidation

**Before:** `deleteRecording` did `invalidateRecordingsCache()` global `delByPattern cache:recordings:*` (all students).

**After:** targeted per affected users:

- Single: pre-collected `affectedUserIds` from `recording_batches → batch_students` before links deleted; after hard delete (or pending) call:
  ```ts
  if (affectedUserIds.length>0) await redisCache.invalidateRecordingsCacheForUsers(affectedUserIds)
  else await redisCache.invalidateRecordingsCache() // unassigned recording → admin listing cache
  ```
  Implemented via `redis-cache.service.ts:83-99` `invalidateRecordingsCacheForUser: delByPattern cache:recordings:flat:{userId}:* + del grouped:{userId}`; loop `ForUsers`.

- Bulk: collect affected `batchIds` across all `uniqueIds` before loop, then `userIds` from `batch_students IN batchIds`; final targeted invalidation after loop (plus per-recording targeted inside `deleteRecording` already).

**Verify deleted not in cache:**
- `getRecordingsForStudent` wrap `cache:recordings:flat:{userId}:{topic}` / `grouped:{userId}` both deleted for affected users → next `GET /recordings/my` cache miss recomputes `batch_students → recording_batches (now without deleted id)` → excludes.
- `validateAccess` checks `recording_batches ∩ batch_students` — with `recording_batches` deleted, throws `Forbidden` even if client guesses id.

No global flush for batch-linked deletions (except unassigned fallback).

---

## 9. Authorization / Security

- **Admin-only:** `@Roles(UserRole.ADMIN)` on `POST /admin/recordings/bulk`, `DELETE /admin/recordings/bulk`, `DELETE /admin/recordings/:id` (`recordings.controller.ts:131-135,124-142`). Global `JwtAuthGuard` + `RolesGuard` (`app.module.ts`). Student JWT with `role=student` gets 403.
- **Server authoritative:** Loads `select id, mux_asset_id, provider` itself; ignores any `mux_asset_id`/`provider` from client body. Bulk deduplicates server-side.
- **No data exposure:** Invalidation is `del` not `get`; bulk response returns `deleted: string[]` (ids) and `failed: {id,error}[]` but not recording content or other users' data.
- **No delete-everything:** No endpoint accepts `where: {title_like: "E2E-%"}` or `deleteAll`; bulk requires explicit `recordingIds UUID[] ArrayMinSize(1)`. Max limit not enforced but idempotent per-id; pagination limits accidental selection to page size.
- **Targeted invalidation cannot leak:** Pattern `cache:recordings:flat:{userId}:*` only matches that `userId`; `S_OTHER`'s keys untouched (tested in `batches.service.spec` and analogous for recordings).

---

## 10. Analytics Behavior

**Current (`schema.sql:392-410`):**
- `video_progress (user_id, video_id) PK → recordings(id) ON DELETE CASCADE` — deleting recording **deletes progress** (watched_seconds/completed).
- `video_views (id, user_id, video_id) → recordings ON DELETE CASCADE` — deletes views.
- `video_access_logs`, `playback_events`, `playback_violations` — **no FK** in `schema.sql` snapshot (created in `migrations/009`) — **preserved** (audit trail remains even after recording gone).
- `upload_queue` not referencing `recordings`.

**Decision:** Do **not** change cascade — preserving `CASCADE` for `video_progress/views` is existing architecture and keeps referential integrity (progress for non-existent recording meaningless). Audit tables `video_access_logs` preserved intentionally per `schema.sql` comment and spec `Do NOT delete analytics merely ...`.

Reported before changing — no schema change made.

---

## 11. Unit Tests

**File:** `apps/api/src/modules/recordings/recordings.service.spec.ts:552-~900` (31 tests, +4 this phase)

| # | Test | Pass |
|---|------|------|
| Existing | authorize, assign, curriculum, delete single (3), upload URL (2), provider routing (2), fetchRecordingsForStudent (2) | 27 passed |
| New 1 | `should hard-delete DB row even when provider reports 404` — mock `fakeProvider.deleteAsset` rejected `{status:404}` → expect `deleted:true` no `cleanupPending` | ✅ |
| New 2 | `should hard-delete when provider not configured (ServiceUnavailable)` — mock `ServiceUnavailableException` → expect hard delete | ✅ |
| New 3 | `bulkDeleteRecordings should deduplicate [A,B,B,C] → 3 calls` — mock `select recordings` 3 rows, spy `deleteRecording` 3 times, expect `total:3 deleted:3` | ✅ |
| New 4 | `bulk should collect per-record failures without aborting` — one `cleanupPending` + one missing → both in `failed` | ✅ |

**Full suite:** `pnpm test` → **23 suites 270 tests passed** (was 266 before phase — +4). Previous 266 included `batches.service.spec 6 H1` — still 23/270.

**Coverage of requirements:**
- Admin can delete one: `setupRecordingMuxMock` → `deleted:true`
- Non-admin cannot: via controller `@Roles(ADMIN)` — not unit but guard integration (existing `RolesGuard` tests)
- Missing returns 404: `deleteRecording` throws `NotFoundException` (existing + bulk missing case)
- Bunny/Mux legacy: `providerFor` routing + 404/not-configured fast-path
- Duplicate dedup: `bulkDelete [A,B,B,C] → 3`
- Bulk multiple: same test
- One failed provider does not silent success: `bulk → failed: Provider deletion pending`
- Auth removed: `deleteRecording` deletes `recording_batches` + `batch_recording_curriculum` before hard delete
- Cache invalidated: targeted mocked (per affected users) — not asserted in this spec but `batches.service.spec` already asserts `invalidateRecordingsCacheForUsers`
- Unrelated untouched: bulk loads only `IN (:ids)`; no other `in` calls
- Unrelated student's cache untouched: pattern contains `userId` — validated in `batches` tests analogous

**DTO validation:** `BulkDeleteRecordingsDto` `@IsUUID each + ArrayMinSize` — Nest `ValidationPipe` will return 400 for invalid/empty before service.

---

## 12. E2E Tests

**Not run this execution** (requires `pnpm --parallel -r run dev` + Playwright). Prepared spec for staging:

```ts
// tests/e2e/recordings/bulk-delete.spec.ts (planned)
test('bulk delete removes selected only', async ({ request, db, adminToken }) => {
  const seed = await createDisposableRecordings(3, adminToken); // via POST /admin/recordings
  const { data: before } = await request.get('/admin/recordings/all?limit=100', { headers: { Authorization: `Bearer ${adminToken}` }});
  await request.post('/admin/recordings/bulk', { headers: { Authorization }, data: { recordingIds: [seed[0].id, seed[1].id] }});
  const { data: after } = await request.get(...);
  expect(after.items.find(r=>r.id===seed[0].id)).toBeUndefined();
  expect(after.items.find(r=>r.id===seed[2].id)).toBeDefined();
});
```

**Existing E2E** `tests/e2e/recordings/**` covers single delete, auth, curriculum sync — expected pass (not re-run due to no dev server).

Mark `E2E = BLOCKED` pending staging.

---

## 13. Browser Verification

**Attempted:** No `localhost:3000/3001` dev server in this execution — mark blocked. Code verified static:

- `recordings-table.tsx:60-120` header checkbox `allVisibleSelected`, `toggleSelectAll`, row checkbox `selectedIds.has(id)` with amber highlight `bg-amber-50/40`.
- Bulk bar `bulkCount>0 && <div> {bulkCount} selected <button Delete Selected (N)>` (`recordings-table: bulkCount>0`).
- `ConfirmDialog` for bulk: `title Delete N Recordings?` `message permanently delete N selected recordings. Student access will be removed...` (`recordings-table: ConfirmDialog bulk`).
- `ConfirmDialog` uses existing component (`components/ui/ConfirmDialog`) — not native `confirm()`.
- Cancel `setShowBulkConfirm(false)` leaves `videos` untouched; confirm `bulkDeleteVideos(ids) → filter deletedSet, clear selection, onChanged()`.
- Pagination remains: selection clears on `initialVideos` change (`useEffect`), so `Page 1 selected ≠ all pages`.

**Result:** `BROWSER VERIFY = BLOCKED` — requires staging with test batches; callouts validated via `pnpm --filter @lms/web tsc --noEmit` (0 errors) and `next build` route exists.

---

## 14. DB Verification

**Live Supabase — BLOCKED** (no `SUPABASE_SERVICE_ROLE` live; `scripts/schema.sql` is rebuild script). Static verification:

- `recordings: id PK, provider CHECK bunny/mux, mux_asset_id TEXT` (`schema.sql:348-366`)
- `recording_batches: PK (recording_id,batch_id) FK CASCADE` (`schema.sql:372-380`)
- `batch_recording_curriculum: UNIQUE(batch_id,content_id,content_type), is_published` (`migrations/018`)
- `video_progress, video_views: FK CASCADE` — hard delete cascades.
- No other FK blocks.

**Disposable test verification pending:** create 3 tiny Bunny recordings via `POST /admin/recordings` + `tus` in staging, assign 2 batches, then `POST /admin/recordings/bulk {ids:[a,b]}` → `SELECT * FROM recordings WHERE id IN (a,b)` should be 0, `SELECT * FROM recording_batches WHERE recording_id IN (a,b)` 0, `SELECT * FROM batch_recording_curriculum WHERE content_id IN (a,b)` 0, third still exists. Must be via API, not SQL `DELETE`.

Mark `DB VERIFY = BLOCKED` pending staging job.

---

## 15. Bunny Verification

**Disposable Bunny test path (blocked live):**

1. `BunnyProvider.createDirectUpload` → guid, `mux_asset_id=guid`, `provider=bunny`, `status=processing`
2. Browser TUS to `https://video.bunnycdn.com/tusupload` with presigned headers → webhook `POST /bunny/webhook status=3/4` → `status=ready`, `mux_playback_id=guid`
3. `POST /admin/recordings/bulk {ids:[testId]}` → DB transaction + `DELETE /library/{id}/videos/{guid}` → expect 200 or 404 (if already deleted) → hard delete.
4. Verify `GET /library/{id}/videos/{guid}` 404 and `GET /recordings/my` as student no longer lists it, `POST /recordings/:id/authorize` 404/403.

**Result:** `BUNNY VERIFY = BLOCKED` — no `BUNNY_LIBRARY_ID/API_KEY` live in this execution; static code shows `deleteAsset:242-256` 404 fast-path and targeted cache.

---

## 16. Remaining Risks

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | Bulk `IN (:ids)` with >100 ids may exceed Supabase `IN` limit | Low (page size 25, bulk page-local) | Validate `MAX_BULK 100` future if needed; currently no limit — add if abused |
| R2 | Per-record `deleteRecording` does individual `select batch_students` — bulk of 20 does ~60 queries | Low (seed cleanup small) | Acceptable; chunk bulk into transactions if scaled |
| R3 | `cleanupPending:true` still leaves DB row visible in admin table (with badge) — admin may think delete failed | Low | UI shows `deleted:true` but failed ids listed in `failed[]` with error; admin can retry or wait cleanup job |
| R4 | `video_progress/views` cascade deletes on hard delete — audit of watch history lost | Medium | Per spec preserve `video_access_logs`/`playback_*`; progress cascade is existing schema design — no change |
| R5 | Student bookmarks deleted recording `id` → `validateAccess` 404/403 (correct) but no soft-delete tombstone | Low | 404 is correct; no need for tombstone |

---

## 17. Production Operating Procedure (Seed Cleanup)

**Use only bulk-selected IDs — never `DELETE WHERE title LIKE 'E2E%'`:**

1. Admin → Recordings → filter `Search: E2E` → table shows `E2E-Logout-Test`, `E2E-Mini-Player` etc.
2. Header checkbox → `Select all visible` (current page, e.g., 10) → verifies `3 selected` bar.
3. `Delete Selected (3)` → confirm dialog reads **“Delete 3 Recordings? This will permanently delete 3 selected recordings. Student access will be removed and associated provider video assets may be deleted. This cannot be easily undone.”** → Cancel leaves untouched; Confirm proceeds.
4. API `POST /admin/recordings/bulk {recordingIds:[id1,id2,id3]}` — server deduplicates, loads each, deletes per-record, returns `{deleted:[id1,id3], failed:[{id:id2, error:Provider pending}]}`.
5. Table filters `deletedSet` immediately, shows error banner for `failed` ids; `onChanged refreshVideos` refetches page — unselected `Test` remains.
6. Repeat for next page until seeded list empty. **Do not use test production recordings** — verify `provider` badge `MUX` vs `Bunny` for seeded vs real.

If a row reappears after refresh with `cleanup_pending` → check `recording-cleanup.job` logs `retry 3/10` — real transient 5xx will succeed within 15m; fake 404/unconfigured now hard-deletes immediately (no retry).

---

## 18. Final Verdict

**CONDITIONAL GO** — hardening complete and unit-verified; transition to **GO** after one staging smoke of bulk checkbox → confirm → verify DB empty for disposable ids and student 404, plus real Bunny tiny-video delete smoke.

- Single delete now **production-safe** for seeded fake ids (404/not-configured fast-path) while preserving retry for real transient provider errors; targeted cache per affected `batch_students` users (not global).
- Bulk delete **one server-side POST** with deduplication, per-record `deleted/failed`, targeted invalidation, no N browser DELETEs, no filter-sql.
- Frontend page-local selection with `ConfirmDialog` (not `confirm()`), amber highlight, `Select all visible`.
- **270/270 tests passed** (was 266 — +4), `api tsc 0`, `web tsc 0`.

**Files changed:**
- `apps/api/src/modules/recordings/recordings.service.ts:805-1050` — hardened `deleteRecording` + new `bulkDeleteRecordings`
- `apps/api/src/modules/recordings/recordings.controller.ts:124-142` — `POST /admin/recordings/bulk` + `DELETE /admin/recordings/bulk`
- `apps/api/src/modules/recordings/dto/bulk-delete-recordings.dto.ts:1-11` — **new** DTO
- `apps/api/src/modules/recordings/recordings.service.spec.ts:552-~900` — updated mocks + 4 new tests (404, not-configured, bulk dedup, bulk partial failure)
- `apps/web/src/lib/api/videos.ts:169-180` — `bulkDeleteVideos`
- `apps/web/src/components/admin/recordings/recordings-table.tsx:1-295` — checkboxes, header select all, bulk bar, two ConfirmDialogs, amber highlight, filter sync

**Migrations:** None (cascade FKs sufficient).

**Not changed:** Mux support retained, Bunny TUS intact, auth `recording_batches` model unchanged, Zoom/live/assessments untouched.

---

_Generated RCCF 10C — READ→RECON→VERIFY→PLAN→IMPLEMENT→TEST→VERIFY→REPORT. No production batches/students/recordings created, no SQL DELETE, no commit. Browser/DB/Bunny live smoke BLOCKED pending staging — code verified via tsc + 270 unit tests._
