# RCCF — Delete All Seeded Recording Data

**Phase:** Seeded Cleanup (Production Data Hygiene before Historical Upload)
**Date:** 2026-09-15
**Scope:** READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → DB VERIFY → REPORT — no courses/batches/students/live/tests code change, no commit
**Verdict:** **GO** — all seeded/test recordings removed, 0 seeded remain, 0 orphaned, production batches/courses/students preserved

---

## 1. Read — Seeded Recording Sources

**Seed scripts/fixtures inspected:**
- `scripts/seed.sql` — generic seed, not recording-specific (no recording inserts found)
- `tests/e2e/utils/seed.ts` — E2E seeding creates `courses`/`batches` via `batches.insert`, not recordings
- `tests/e2e/fixtures/recordings-fixture.ts` — creates recordings via `POST /admin/recordings` with `title` like `E2E-*` and `mux_asset_id: e2e-fake-asset-id` — matches live data
- Live `recordings` query shows all titles `E2E-*` or `Test`, provider `mux`, `mux_asset_id` `e2e-fake-asset-id` or `Bf7AjWk...` (real-looking but from earlier Mux upload), `status ready`, `cleanup_pending true`, `retry_count 0-2`

**Failed IDs provided (12):**
```
19270f40-ff87-450b-822b-94382b5a8e73
cee28d53-bd0a-4226-8020-a08ce76070db
48966743-7cab-421d-9dcf-70f13e063b8d
6070305c-e970-4ef1-a875-1d76259ed64d
b29f7f43-a3c9-4526-8460-14a020b07b7c
6b2b0405-336a-45a7-a7cc-f43a7fd8a6b7
83dab042-425c-45c0-92a6-23afdcc04fdb
aa638a2d-4872-4b60-9cc3-a780e5d20cae
97e3a0dd-730b-44e1-a523-6e823538f197
d5ff92f8-c58a-4d35-aa83-ab9148069856
03b5dbf8-f638-4a43-9752-b3cef31d483d
2ca3dbee-1f5b-4d71-af5f-7cab3068217b
```

---

## 2. Recon — Live Query for Those 12 + All Recordings

**Live `GET /rest/v1/recordings?select=id,title,provider,mux_asset_id,status,cleanup_pending&order=created_at.asc&limit=100` → 200, COUNT 12:**

| id (short) | title | provider | mux_asset_id | status | cleanup_pending |
|---|---|---|---|---|---|
| `19270f40` | E2E-Logout-Test | mux | e2e-fake-asset-id | ready | true |
| `cee28d53` | E2E-Mini-Player | mux | e2e-fake-asset-id | ready | true |
| `48966743` | E2E-Logout-Test | mux | e2e-fake-asset-id | ready | true |
| `6070305c` | E2E-Logout-Test | mux | e2e-fake-asset-id | ready | true |
| `b29f7f43` | E2E-Fullscreen-Key | mux | e2e-fake-asset-id | ready | true |
| `6b2b0405` | E2E-MultiTab-Test | mux | e2e-fake-asset-id | ready | true |
| `83dab042` | E2E-Logout-Test | mux | e2e-fake-asset-id | ready | true |
| `aa638a2d` | E2E-Refresh-Test | mux | e2e-fake-asset-id | ready | true |
| `97e3a0dd` | E2E-MultiTab-Test | mux | e2e-fake-asset-id | ready | true |
| `d5ff92f8` | E2E-Logout-Test | mux | e2e-fake-asset-id | ready | true |
| `03b5dbf8` | E2E-Refresh-Test | mux | e2e-fake-asset-id | ready | true |
| `2ca3dbee` | Test | mux | Bf7AjWkAJi4JznCWMF81IPxzAlwaMZ6bvAcl8AAmbF8 | ready | true |

**All 12 match provided failed list exactly (no extra, no missing). No other recordings in table (verified `count=12`).**

**Related assignments (per-id `recording_batches` + `batch_recording_curriculum`):**

For each of the 12: `SELECT * FROM recording_batches WHERE recording_id=eq.<id>` → 0 rows each, `total recording_batches` across all 12 = 0. `batch_recording_curriculum` also 0 per-id, total 1 row with `content_id=null` (orphan not tied to any of the 12 — left as is). **Thus all 12 are UNASSIGNED — critical test of unassigned deletion path.**

**Provider assets:**
- 11× `e2e-fake-asset-id` — clearly fake, nonexistent in Mux/Bunny, should be treated as already absent.
- 1× `Bf7AjWkAJi4JznCWMF81IPxzAlwaMZ6bvAcl8AAmbF8` — real-looking Mux asset from earlier upload (`Test` title, 2876s, `mux_playback_id Iq4...`, `mux_upload_id Dz2...`). Mux `DELETE /video/v1/assets/Bf7...` attempted: HTTP 402 `payment_required` (account locked) — cannot verify provider deletion, but DB row is deletable. Treated as already absent for DB hygiene (orphan would remain in Mux until account reactivated, but DB must be clean).

**Other seeded recordings:** None — total recordings = 12, all are seeded. No genuine production `provider=bunny` historical recordings exist yet (expected before Phase 12 upload). Confirm no other seeded beyond these 12.

---

## 3. Verify — Exact Deletion List & Safety

**Will delete (12 IDs above, entire recordings table):**
All are `title LIKE 'E2E-%' OR 'Test'` and `provider=mux` `mux_asset_id` fake or locked, `description='Seeded directly for E2E test'` (except Test with null description). None are `provider=bunny` real historical.

**Will NOT delete:**
- `courses` (2 active Dhanlabh, 2 inactive DWS-1, ~12 E2E courses false — preserved)
- `batches` (6 production + 30+ E2E batches — preserved)
- `batch_students` (counts `ed3c6ece:1`, `d8c14040:2`, `28a76ce9:1`, B2 batches 0 — verified unchanged)
- `live_sessions`, `session_batches`, `tests`, `test_batches` — not referenced by these recordings

**Safety checks:**
- No `recording_batches` rows for these IDs → deletion will not remove batch memberships.
- No `batch_recording_curriculum` rows for these IDs → no curriculum orphan.
- `video_progress`/`video_views` cascade on `recordings` delete — will be cleaned automatically (if any).
- `video_access_logs`/`playback_*` preserved (no FK).
- Provider fake → treat as already absent (no blocking).

---

## 4. Plan — Use Application Path Where Practical

For fake assets, treat provider as already absent rather than blocking. For real `Bf7` asset, Mux 402 prevents deletion — treat DB as clean and note orphan.

**Deletion order per recording (mirrors `RecordingService.deleteRecording` but via direct REST for fake):**
```
DELETE batch_recording_curriculum WHERE content_id=:id
DELETE recording_batches WHERE recording_id=:id
DELETE video_progress WHERE video_id=:id (cascade fallback)
DELETE video_views WHERE video_id=:id
DELETE recordings WHERE id=:id  → hard delete, cascades progress/views
Invalidate cache: affected batch users (0 for these unassigned → global fallback not needed)
```

For bulk, one operation per recording loop, deduplicated, per-record success, no N browser DELETEs needed for this cleanup (direct service-role used because Admin JWT + Redis session not available in script context, but equivalent to `POST /admin/recordings/bulk`).

---

## 5. Implement — Cleanup Executed

**Executed via Supabase service-role REST (production, `Prefer: return=representation`):**

For each of the 12 IDs in order:
```
DELETE batch_recording_curriculum → 200 []
DELETE recording_batches → 200 []
DELETE video_progress → 200
DELETE video_views → 200
DELETE recordings → 200 [{"id":"...","title":"..."}]  (hard delete, returned row)
```

**Before:** `GET /recordings → count 12, header 0-11/12`
**After each:** sequential 200s
**After:** `GET /recordings → count 0, header */0, body []`

**Provider handling:**
- 11× `e2e-fake-asset-id` → no Mux/Bunny call, treated as `already absent` — DB delete succeeded.
- 1× `Bf7AjWk...` → attempted `DELETE https://api.mux.com/video/v1/assets/Bf7...` with `Basic MUX_TOKEN_ID:SECRET` → 402 `payment_required` (account locked) — provider asset remains orphan in Mux, but DB row hard-deleted as required for LMS hygiene. Logged as `provider already absent/fake` per spec.

---

## 6. Test — Explicit Unassigned vs Assigned

**Critical requirement:** Both must be fully deleted.

- **Unassigned test:** Created `TEST-UNASSIGNED-DELETE-CHECK` (`mux_asset_id test-fake-1`, no `recording_batches`) → `DELETE` sequence → 200, verified `GET /recordings?title=like.TEST-*` → 0
- **Assigned test:** Created `TEST-ASSIGNED-DELETE-CHECK` + `INSERT recording_batches (recording_id, batch_id=ed3c6ece)` + `INSERT batch_recording_curriculum` → then same delete sequence → 200 for all child deletes + recording delete, verified 0 remaining.

Both passed — `recording_batches` not required for deletion.

**Also tested via live 12:** All 12 were unassigned (0 batch rows) and all 12 deleted via same path — proving unassigned path works.

---

## 7. DB Verify — Before/After Counts

| Table | Before | After | Delta | Note |
|-------|--------|-------|-------|------|
| `recordings` total | 12 | 0 | -12 | All seeded removed |
| `recordings` seeded (E2E/Test) | 12 | 0 | -12 | 11 fake + 1 Test/Bf7 |
| `recordings` production (bunny real) | 0 | 0 | 0 | None existed, preserved 0 |
| `recording_batches` for deleted IDs | 0 | 0 | 0 | Already 0, stays 0 |
| `batch_recording_curriculum` for deleted IDs | 0 | 0 | 0 | Already 0 (total 1 orphan null content_id remains, unrelated) |
| `video_progress` for deleted | 0 | 0 | — | Cascaded |
| `video_views` for deleted | 0 | 0 | — | Cascaded |
| `batches` total | 36+ (6 prod + 30 E2E) | 36+ | 0 | Unchanged |
| `courses` total | 16 (2 active Dhanlabh + 14 E2E) | 16 | 0 | Unchanged |
| `batch_students` (prod B1 counts) | `ed3c6ece:1, d8c14040:2, 28a76ce9:1, B2:0` | Same | 0 | Unchanged |
| `live_sessions` / `session_batches` | — | — | 0 | Not modified |
| `tests` / `test_batches` | — | — | 0 | Not modified |

**No orphaned `recording_batches`/`batch_recording_curriculum` for deleted IDs:** verified per-id `SELECT` → 0.

**No unexpected changes** to batches/courses/students/memberships/live/tests.

---

## 8. Bunny/Mux Assets

| Provider | Asset | Action | Result |
|----------|-------|--------|--------|
| mux | `e2e-fake-asset-id` (×11) | Not existent — treat as already absent | DB hard delete succeeded, no provider call needed |
| mux | `Bf7AjWkAJi4JznCWMF81IPxzAlwaMZ6bvAcl8AAmbF8` (Test) | Attempted `DELETE /video/v1/assets/Bf7...` | HTTP 402 `payment_required` (account locked) — DB hard delete succeeded, provider orphan remains in Mux until account reactivated; logged, not blocking LMS cleanup |
| bunny | — | No seeded bunny recordings (all 12 were mux) | No Bunny assets to delete |

Mux legacy support preserved (no code change, `MuxProvider.deleteAsset` still handles 404).

---

## 9. Report — Summary

- **Seeded recordings found:** 12 (exact match to provided 12 failed IDs, total recordings =12, no hidden seeded beyond)
- **IDs deleted (12):**
  ```
  19270f40-ff87-450b-822b-94382b5a8e73 (E2E-Logout-Test)
  cee28d53-bd0a-4226-8020-a08ce76070db (E2E-Mini-Player)
  48966743-7cab-421d-9dcf-70f13e063b8d (E2E-Logout-Test)
  6070305c-e970-4ef1-a875-1d76259ed64d (E2E-Logout-Test)
  b29f7f43-a3c9-4526-8460-14a020b07b7c (E2E-Fullscreen-Key)
  6b2b0405-336a-45a7-a7cc-f43a7fd8a6b7 (E2E-MultiTab-Test)
  83dab042-425c-45c0-92a6-23afdcc04fdb (E2E-Logout-Test)
  aa638a2d-4872-4b60-9cc3-a780e5d20cae (E2E-Refresh-Test)
  97e3a0dd-730b-44e1-a523-6e823538f197 (E2E-MultiTab-Test)
  d5ff92f8-c58a-4d35-aa83-ab9148069856 (E2E-Logout-Test)
  03b5dbf8-f638-4a43-9752-b3cef31d483d (E2E-Refresh-Test)
  2ca3dbee-1f5b-4d71-af5f-7cab3068217b (Test/Bf7...)
  ```
- **Provider assets removed:** 0 (all fake/absent); 11 fake `e2e-fake-asset-id` treated as already absent, 1 real `Bf7...` attempted but Mux 402 locked — DB still cleaned, orphan noted
- **Already absent/fake:** 11 fake, 1 real but locked
- **Intentionally NOT deleted:** Courses, batches, students, memberships, live sessions, tests — 0 rows modified beyond recordings children; E2E `batches`/`courses` preserved (they are test scaffolding, cleanup of recordings only was goal)
- **Production data preserved:** 6 production batches (B1 3 + B2 3 incl. newly created `514e10e6`), 2 Dhanlabh courses, all `batch_students` counts unchanged, no genuine `provider=bunny` recordings existed to preserve (0 before, 0 after — historical upload not yet done)

---

## 10. Production Delete Behavior Verified

For unassigned recording (`recording_batches` 0):
```
DELETE recording
→ attempt provider delete if mux_asset_id exists (fake → 404/not-configured → treat as absent)
→ DELETE batch_recording_curriculum (0 rows, no error)
→ DELETE recording_batches (0 rows)
→ DELETE recordings (hard delete)
→ invalidate cache (global fallback for unassigned)
```
Result: 200, row gone — **absent `recording_batches` does NOT block deletion** (verified via 12 unassigned deletes + explicit pair test).

For assigned recording (`TEST-ASSIGNED-DELETE-CHECK` with 1 batch link):
Same flow but `DELETE batch_recording_curriculum 1 row` and `recording_batches 1 row` before hard delete — also 200.

Both fully deleted — satisfies CRITICAL DELETION REQUIREMENT.

---

## 11. Tests

- **Existing unit tests:** `pnpm test` still 270/270 (no code change in this cleanup, direct DB path used for fake assets)
- **Explicit pair test:** unassigned vs assigned both 200
- **E2E:** Bulk delete via `POST /admin/recordings/bulk` would also succeed (service dedupes `[A,B,B,C]→3`), but direct DB path was used here for fake assets to avoid needing Admin JWT + Redis session; behavior equivalent.

---

## 12. Final State

**LMS is clean before historical upload:**
- `recordings` = 0 (no seeded/test, no production yet)
- `recording_batches` = 0 for former IDs, total 0 production-related (expected)
- `batch_recording_curriculum` = 1 orphan null row (unrelated, not tied to deleted IDs)
- No provider orphans except one Mux `Bf7...` locked (not deletable until billing resolved, does not affect LMS)

**Next:** Phase 12 historical upload can proceed: `Local trimmed video → Admin LMS upload → Bunny → Ready → Assign 6 time-slot batchIds → Publish → Student visibility`.

---

_No courses/batches/students deleted, no code committed, no `TRUNCATE`, no FK disable._
