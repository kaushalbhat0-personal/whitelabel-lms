# RCCF Phase 10A — Production Batch Management Hardening

**Phase:** 10A (H1 + H2 hardening on top of Phase 9.5 CONDITIONAL GO)
**Date:** 2026-09-15
**Scope:** READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → BROWSER VERIFY → DB VERIFY → REPORT — no batches, no student import, no commit
**Verdict:** **CONDITIONAL GO** — H1+H2 implemented, 266/266 tests green, tsc clean; live browser/DB remain blocked

---

## 1. H1 Root Cause

Student recording lists are derived from `batch_students` via:

- `recordings.service.ts:1037-1147 getRecordingsForStudent` → `batch_students(user_id) → recording_batches(batch_id) → batch_recording_curriculum.is_published → recordings`
- `recordings.service.ts:1159-1300 fetchMyRecordingsGrouped` same
- Cache wrapped `RedisCacheService.wrap('cache:recordings:flat:{userId}:{topicId}' | 'cache:recordings:grouped:{userId}', 300)` `recordings.service.ts:1038-1042,1160-1164`

Mutations to `recordings`/`recording_batches` correctly call `invalidateRecordingsCache() → delByPattern('cache:recordings:*')` (10 call sites in `recordings.service.ts:171,312,462,552,750,788,886,903,917` + `bunny-webhook:190`, `mux:204`).

**Gap:** `BatchesService` never invalidated recordings cache. Evidence:

- `apps/api/src/modules/batches/batches.service.ts:1-27` constructor injected only `SupabaseService, EmailService, ObservabilityService` — no `RedisCacheService`.
- `assignStudents:218-251`, `removeStudents:253-267`, `addStudent:356-444`, `assignStudentToBatch:446-468` — zero calls to `invalidateRecordingsCache*` or `delByPattern` (grep `invalidate` in `batches/**` returns 0) — documented in Phase 9.5 report `docs/rccf-phase9-5-batch-architecture-report.md:175-183,550`

Meal result: Student moved `Batch A (12–2) → Batch B (8–10)` retains stale `cache:recordings:flat:{userId}:*` for ≤300s (until TTL or unrelated recording mutation globally flushes). `validateAccess()` on playback is immediate (DB hit, no cache), but listing pages (`GET /recordings/my`) show old batch-only recordings until stale.

---

## 2. H1 Implementation

**Principle:** Prefer targeted per-user invalidation; DO NOT globally flush Redis.

### 2.1 RedisCacheService — new targeted API

File `apps/api/src/common/services/redis-cache.service.ts:78-97` (pre: only global `invalidateRecordingsCache(): delByPattern('cache:recordings:*')`):

```ts
async invalidateRecordingsCacheForUser(userId: string): Promise<void> {
  if (!userId) return;
  // Keys: cache:recordings:flat:{userId}:{topic}  cache:recordings:grouped:{userId}
  await this.delByPattern(`cache:recordings:flat:${userId}:*`);
  await this.del(`cache:recordings:grouped:${userId}`);
  // Future-proof fallback for any flat shape with userId substring
  await this.delByPattern(`cache:recordings:*${userId}*`);
}
async invalidateRecordingsCacheForUsers(userIds: string[]): Promise<void> {
  const unique = [...new Set((userIds ?? []).filter(Boolean))];
  for (const uid of unique) await this.invalidateRecordingsCacheForUser(uid);
}
```

Uses existing `del`/`delByPattern` (`scan MATCH COUNT 100` + `del`). No new Redis topology, no second cache system, reuses `RedisCacheService` per spec. The global `invalidateRecordingsCache()` remains for recording mutations (correct behavior — many students affected).

### 2.2 BatchesService — inject and call targeted invalidation

File `apps/api/src/modules/batches/batches.service.ts:1-27`:
```ts
import { RedisCacheService } from '../../common/services/redis-cache.service';
constructor(..., private readonly redisCache: RedisCacheService) {}
```
`AppModule:75-77` is `@Global()` and exports `RedisCacheService` — no `BatchesModule` import change needed.

Four membership mutations hardened:

| Method | Location | After success |
|--------|----------|---------------|
| `assignStudents(batchId, {studentIds})` | `batches.service.ts:218-251` after `upsert batch_students` | `await this.redisCache.invalidateRecordingsCacheForUsers(dto.studentIds)` |
| `removeStudents(batchId, studentIds)` | `batches.service.ts:253-276` after `delete` | `await this.redisCache.invalidateRecordingsCacheForUsers(studentIds)` |
| `addStudent(batchId, dto)` | `batches.service.ts:356-473` after `upsert batch_students` | `await this.redisCache.invalidateRecordingsCacheForUser(userId)` |
| `assignStudentToBatch(batchId, studentId)` | `batches.service.ts:446-483` after `upsert` | `await this.redisCache.invalidateRecordingsCacheForUser(studentId)` |

All calls are `await ... .catch(()=>{})` fire-safe — membership mutation never fails due to Redis.

**Bulk upload path:** `bulk-upload.service.ts:224-245` `processSingleRow` calls `batchesService.assignStudentToBatch(lookup.batchId, userId)` per row — hence bulk import automatically benefits from targeted invalidation per-row without global flush. No separate bulk cache code needed; each student's cache is invalidated individually even within `CHUNK_SIZE=5` parallel chunks.

**Unrelated students:** Pattern contains `userId` — `cache:recordings:flat:${userId}:*` only deletes keys where prefix `userId` appears; `invalidateRecordingsCacheForUsers([S1,S2])` never matches `cache:recordings:flat:S_OTHER:*` because Redis SCAN `MATCH` is literal glob.

**Other caches:** `tests` (`TestsService.getMyTests:290-334`) and `live-sessions` (`LiveSessionsService.getForStudent:805-881`) and `courses` are **not cached** — grep `wrap(` shows only recordings use `RedisCacheService.wrap`. No invalidation needed. Dashboard aggregates those three uncached services, so no dashboard cache exists.

---

## 3. H2 Root Cause

Admin `/admin/batches` search/pagination broken — identified in Phase 9.5 `rccf-phase9-5:498-550` and `components/admin/batches/batch-list.tsx:80`.

Files:
- `apps/web/src/app/admin/batches/page.tsx:11` RSC fetches `getAllBatches({isActive:false, page:1, limit:100})` — hard-coded arbitrary limit.
- `components/admin/batches/batch-list.tsx:19-88` original:
  ```tsx
  const [batches,setBatches]=useState(initialBatches)
  const refresh = ()=> getAllBatches({isActive:false, page:1, limit:100})
  // ...
  <AdminDataTable columns={columns} data={batches} showSearch searchPlaceholder="Search batches..." />
  ```
  Missing `searchValue/onSearchChange/searchKeys` → `AdminDataTable.tsx:105-114,177` search guard:
  ```tsx
  if (query && searchKeys && searchKeys.length>0) arr = arr.filter(...)
  {showSearch && onSearchChange && <input ...>}
  ```
  Without `searchKeys` + `onSearchChange`, toolbar input never renders and `sortedData` filtering never runs — admins see placeholder prop but no input.

  Pagination: `AdminDataTable` supports `page/pageSize/total/onPageChange/showPagination` (`AdminDataTable.tsx:40-42,159,350-401`), but `BatchList` passed none — hardcoded `limit:100 page:1` silos all batches on one page, no footer.

API agreement: `BatchesService.findAll:29-56` supports `page,limit,isActive` with `range(from,to)` + `{count:'exact'}` and `order created_at desc` — unused by UI.

Also batch name display: column `Name` `render: (b)=><Link>{b.name}</Link>` (`batch-list.tsx:42-43`) has no `title` or wrapping — long FQN like `Dhanlabh — Batch 1 — Weekday 12 PM–2 PM` may be ambiguous if truncated by parent overflow.

---

## 4. H2 Implementation

**Do NOT redesign `AdminDataTable`; use its existing search/pagination.**

Files `apps/web/src/components/admin/batches/batch-list.tsx:1-88` + `apps/web/src/app/admin/batches/page.tsx:11`:

### BatchList changes
```tsx
const [searchValue,setSearchValue]=useState('')
const [page,setPage]=useState(1)
const [pageSize]=useState(20)
const fetchPage=async(nextPage)=>{ const r=await getAllBatches({isActive:false, page:nextPage, limit:pageSize}); setBatches(r.items); setTotal(r.total) }
const refresh=()=>fetchPage(page)
const handlePageChange=(next)=>{ setPage(next); fetchPage(next) }

columns Name render: <Link title={b.name} className="break-words whitespace-normal">{b.name}</Link>
           Course render: <span title={course.name} className="break-words whitespace-normal">{course.name}</span>

<AdminDataTable
  data={batches}
  searchValue={searchValue}
  onSearchChange={setSearchValue}
  searchKeys={['name']}
  page={page} pageSize={pageSize} total={total} onPageChange={handlePageChange}
  ... showSearch searchPlaceholder ...
/>
```
- `searchKeys={['name']}` enables client-side filtering `sortedData.filter(searchKeys.some(key => String(item[key]).includes(query)))` (`AdminDataTable.tsx:108-113`) — sufficient for 6–50 time-slot batches. For larger installs, API search can later be added without breaking UI.
- `page/pageSize/total/onPageChange` wire server pagination footer `Showing {(page-1)*pageSize+1}–{min(page*pageSize,total)} of {total}` (`AdminDataTable.tsx:353`) and Previous/Next/5-button strip (`AdminDataTable.tsx:356-401`).
- Empty state now guarded `batches.length===0 && !searchValue` to avoid showing empty when filter hides all.
- Hard-coded `limit:100` removed; documented `pageSize 20` via state, RSC initial `limit:20` (`page.tsx:11` changed from 100 to 20) — API and UI now agree.
- Full FQN preserved via `title` attribute and `break-words whitespace-normal` — no abbreviation, distinguishes `Weekday 12–2` vs `8–10` vs `Weekend` even with identical `schedule_type`.

Course side unchanged — `BatchForm` etc. already allow FQN names (`create-batch.dto: name MaxLength 100`).

---

## 5. Batch Membership Flow (After Hardening)

```
Admin action
  POST /batches/:id/students {studentIds}              → BatchesService.assignStudents      → upsert batch_students → invalidateRecordingsCacheForUsers(studentIds)
  POST /batches/:id/add-student {first,last,email}     → BatchesService.addStudent          → auth.createUser→profile upsert→batch_students→ invalidateRecordingsCacheForUser(userId)
  DELETE /batches/:id/students {studentIds}             → BatchesService.removeStudents      → delete batch_students → invalidateRecordingsCacheForUsers(studentIds)
  POST /bulk-upload/students (CSV name,email,phone,     → BulkUploadService.processSingleRow → lookupBatchByName ilike + assignStudentToBatch per row → targeted invalidate per row
       batchName,courseName) chunked 5 parallel
  (internal helper) assignStudentToBatch                → direct upsert → invalidateRecordingsCacheForUser

All paths:
  - Validate @Roles(ADMIN) via BatchesController/BulkUploadController JWT guard (no student self-enroll)
  - Validate batch exists (findById), student role=STUDENT
  - Idempotent upsert onConflict batch_id,user_id
  - Targeted Redis invalidation only for affected userIds — no global flush
```

Student move `S: Batch A → Batch B` is two calls `removeStudents(A,[S])` + `assignStudents(B,[S])` → two targeted invalidations for same `S` (first clears old flat/grouped, second clears again after new mapping). Next `GET /recordings/my` cache miss recomputes `batch_students(S) → [B] → recording_batches(B) → recordings`.

---

## 6. Cache Behavior

| Key | TTL | Populated by | Invalidated by (post-fix) |
|-----|-----|--------------|---------------------------|
| `cache:recordings:flat:{userId}:{topicId}` | 300s | `getRecordingsForStudent` wrap | Recording mutations (global) + `BatchesService.*` targeted for `userId` |
| `cache:recordings:grouped:{userId}` | 300s | `getMyRecordingsGrouped` wrap | Same |
| Tests / live-sessions / courses | uncached | — | not cached → always DB-fresh |

Targeted patterns (see §2):
- `cache:recordings:flat:{userId}:*` (via `delByPattern`)
- `cache:recordings:grouped:{userId}` (via `del`)
- Fallback `cache:recordings:*{userId}*` covers future shapes

Global flush `cache:recordings:*` remains only for recording-centric mutations (adding a recording to a batch should affect many students) — correct trade-off per `ADR-005-caching-strategy.md:62-69`.

---

## 7. Search/Pagination Behavior

- **Search:** client-side via `AdminDataTable` `searchKeys=['name']` `searchValue` on `data` (`AdminDataTable:108-113`). Typing `Batch 1` matches `Dhanlabh — Batch 1 — Weekday 12 PM–2 PM` but not `Batch 2`; typing `Weekend` matches only weekend batches; typing full FQN matches uniquely. Works on current page's `batches` slice (pageSize 20 covers the expected 6 operational batches in one page; larger installs would need server-search future).
- **Pagination:** server-driven via `BatchesService.findAll(page,limit)` `range(from,to)` + `count exact`. `AdminDataTable` footer `Showing … of total` + Previous/Next + 5 page buttons (`AdminDataTable:350-401`). `batch-list` state `page,pageSize=20,total` from `getAllBatches` response `items/total/page/limit` (`courses.ts:178-188`). Hard-coded 100 removed.
- **Full name:** `title` attr + `break-words whitespace-normal` ensures FQN not abbreviated; time-slot suffixes distinguish otherwise-similar rows.

API + UI now agree `pageSize 20`, `limit:20` initial RSC, `getAllBatches({page,limit})` reused on page changes.

---

## 8. Tests

### New unit tests

File `apps/api/src/modules/batches/batches.service.spec.ts:1-120` (6 tests, created this phase):

| # | Test | Asserts |
|---|------|---------|
| 1 | `assignStudents → invalidates each affected user` | `invalidateRecordingsCacheForUsers([S1,S2])`, no global |
| 2 | `removeStudents → invalidates each removed user` | `invalidateRecordingsCacheForUsers([S1])` |
| 3 | bulk via `assignStudents` `affected cache invalidated` | array containing all three |
| 4 | batch switch `remove old + add new` invalidates and next query uses new batch | two targeted calls for same S |
| 5 | unrelated cache remains untouched | not called with `[S_OTHER]`, no global flush |
| 6 | `assignStudentToBatch single → targeted` | `invalidateRecordingsCacheForUser(S1)` |

### Existing suite

```
pnpm test (apps/api, apps/web tsc)
────────────────────────────────────────
Test Suites: 23 passed (was 22, + batches.service.spec)
Tests:       266 passed (was 260, +6)
Time:        ~39s
Apps/web:    pnpm --filter web tsc --noEmit → PASS (0 errors)
```

No tests weakened; `recordings.service.spec` etc. unchanged except new targeted calls are mocked and not asserted against.

---

## 9. Browser Verification

**Attempted:** No dev server available (`localhost:3000/3001` not listening, no `pnpm dev` running in this execution, no staging credentials). Manual checks would be:

1. Admin → Batches → verify `<input placeholder="Search batches...">` renders (now requires `onSearchChange` present — fixed), typing `Weekday 12 PM` filters to matching rows via `AdminDataTable` `sortedData`.
2. Pagination footer `Showing 1–20 of N` + Next/Previous enabled when `total>20`.
3. Batch row `Name` column shows full FQN on hover (`title`) and wraps `break-words`.
4. Open batch → Students tab → membership UI still shows `remove` per row.
5. Do NOT create production batches/students.

**Result:** `BROWSER VERIFY = BLOCKED` — do not fabricate. Fix is structurally sound (wiring validated via static read of `batch-list.tsx:70-88` and `AdminDataTable.tsx:177` guard, and `tsc --noEmit` clean); requires staging run to observe.

---

## 10. DB Verification

**Attempted:** No live Supabase credentials (`SUPABASE_URL/SERVICE_ROLE_KEY` absent). Read-only checks not run.

**Schema sufficient (static verification):**
- `batches: id, course_id→courses.id CASCADE, name, schedule_type CHECK, is_active` `scripts/schema.sql:111-125`
- `batch_students PK (batch_id,user_id) FK CASCADE` `scripts/schema.sql:128-133`
- `recordings/provider CHECK (mux,bunny)` `scripts/schema.sql:354`, `recording_batches PK (recording_id,batch_id)` `scripts/schema.sql:372-380`, `batch_recording_curriculum UNIQUE(batch_id,content_id,content_type)` `migrations/018:24`
- Indexes `idx_batch_students_user`, `idx_recording_batches_*` present

No migration created — flat model remains sufficient.

**Result:** `DB VERIFY = BLOCKED`.

---

## 11. Security Verification

- **Student cannot self-move:** All membership mutations `@Roles(UserRole.ADMIN)` in `BatchesController:45-88` (`POST /batches`, `PATCH /batches/:id`, `POST :id/students`, `DELETE :id/students`, `POST :id/add-student`) + `BulkUploadController:51-60 POST /bulk-upload/students @Roles(ADMIN)`. JWT `RolesGuard` global. No student-exposed endpoint accepts `batchIds` for self-enroll.
- **Server-side enforcement:** Batch existence via `findById` (`BatchesService:219,254,357,447`), student role checked `profiles.role=STUDENT` (`BatchesService:221-225,275-276,450-454`), idempotent upsert `onConflict batch_id,user_id` prevents injection via duplicate.
- **Cache isolation:** Targeted key `cache:recordings:flat:{userId}:*` only deletes keys containing that `userId`; `invalidateRecordingsCacheForUsers([S1,S2])` loops exact ids — `S_OTHER` keys never matched because SCAN `MATCH cache:recordings:flat:S_OTHER:*` not issued. No global flush introduced.
- **No exposure:** Invalidation is `del`/`scan+del`, not `get` — no student data returned; next `GET /recordings/my` recomputes via `batch_students∩recording_batches` per-requester `user.id` from JWT.

---

## 12. Remaining Risks

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | `BatchList` client search only searches current page (20) — not all batches if >20 | Low (expected 6) | If batches exceed 20, add `GET /batches?search=` server ilike param later |
| R2 | `assignStudents/removeStudents` invalidates even if upsert was no-op (user already in batch) | Low | Harmless extra delete; avoids conditional logic |
| R3 | Bulk upload per-row invalidation does `N` Redis SCANs (N students) | Low (chunk 5, job Batches few) | Acceptable; global flush would be `1` SCAN but flushes all students — targeted is correct trade-off |
| R4 | `validateAccess` for playback is DB-fresh but listing is 300s cached — stale still possible if Redis down | Low | `RedisCacheService` `catch(()=>{})` fallback to miss — safe |
| R5 | Tests/live-sessions not cached — no invalidation needed but move not reflected if future caching added | Very low | Document that any future `tests`/`live-sessions` cache must also hook `BatchesService` membership mutations |

---

## 13. Production Readiness

**Batch management hardening is complete for onboarding.** Flat `Dhanlabh with Shubh` course + 3–6 time-slot batches (per `rccf-phase9-5:622`) is safe:

- H1 ensures batch switch `A→B` is reflected in next recording listing without 5-min stale window, per-user only.
- H2 ensures admin can reliably find and page batches by FQN without artificial 100 cap, and time-slot suffixes are unambiguous.
- Membership flows (`POST :id/students`, `POST :id/add-student`, `DELETE :id/students`, `assignStudentToBatch` via bulk CSV `batchName`+`courseName` ilike lookup) all share same targeted invalidation path.
- No schema change, no hierarchy, no Bunny/recording/live/assessment rework.

**Conditions for GO:** Stage browser QA (search input appears, typing filters, pagination footer) and read-only DB `SELECT` of `courses/batches` — both BLOCKED this pass but code-verified (`batch-list` wiring + `tsc` + 266 tests).

---

## Verdict

**CONDITIONAL GO** — hardening implemented and unit-verified; transition to **GO** after one staging smoke run of `/admin/batches` search/pagination and a batch switch cache-miss check (`GET /recordings/my` before vs after moving a test student). No further code required before student import.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/common/services/redis-cache.service.ts:78-97` | Added `invalidateRecordingsCacheForUser(userId)` + `invalidateRecordingsCacheForUsers(userIds[])` targeted via `delByPattern`/`del` |
| `apps/api/src/modules/batches/batches.service.ts:1-27,218-483` | Inject `RedisCacheService`; after `assignStudents/removeStudents/addStudent/assignStudentToBatch` call targeted invalidation for affected userIds only |
| `apps/web/src/components/admin/batches/batch-list.tsx:19-88` | Added `searchValue/page/pageSize/fetchPage/handlePageChange` state, wired `AdminDataTable` `searchValue/onSearchChange/searchKeys=['name'] page/pageSize/total/onPageChange`, full FQN wrapping (`break-words title`), fixed hard-coded 100→20 and empty-state guard |
| `apps/web/src/app/admin/batches/page.tsx:11` | `limit:100→20` to agree with client pageSize |
| `apps/api/src/modules/batches/batches.service.spec.ts:1-120` | **New** — 6 tests for H1 targeted invalidation, unrelated untouched, no global flush |

**Migrations:** None.

**Not changed:** recording authorization, Bunny, live-sessions, assessments, `AdminDataTable` itself, schema.

---

## Exact Tests/Results

| Suite | Result |
|-------|--------|
| `pnpm test` `batches.service.spec` | 6 passed |
| `pnpm test` all | **23 suites 266 tests passed** (was 22/260) |
| `pnpm --filter web tsc --noEmit` | PASS |
| E2E `tests/e2e/recordings/**` | Not re-run this phase (unchanged area) — expected pass per Phase 9 |

## Browser / DB

| Verification | Result |
|--------------|--------|
| Browser (search, pagination, FQN) | **BLOCKED** — no dev server; code wiring + tsc verified |
| DB (batches, batch_students, recording_batches indexes) | **BLOCKED** — no live Supabase; schema verified static |

---

_Generated RCCF 10A — H1 recordings cache targeted for batch membership moves, H2 admin batch search/pagination repaired. No production batches created, no students imported, no commit._
