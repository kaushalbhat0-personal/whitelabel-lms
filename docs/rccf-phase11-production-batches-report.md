# RCCF Phase 11 — Create Production Batches (Dhanlabh with Shubh)

**Phase:** 11 (Production batch creation — flat time-slot model)
**Date:** 2026-09-15
**Scope:** READ→RECON→VERIFY→PLAN→IMPLEMENT→TEST→BROWSER VERIFY→DB VERIFY→REPORT — real production `courses`/`batches` via Admin API, no students, no recordings, no commit
**Deployment base:** `ca8c0e2` (Phase 10C + 10A + 9) — Render/Vercel GREEN
**Verdict:** **GO** — 6 required production batches exist, 1 missing created, no duplicates, active, cross-module compatible, no student/recording data modified

---

## 1. Existing Dhanlabh with Shubh Course

**Live Supabase read-only (service-role REST, no SQL mutation beyond batch creation):**

`GET /rest/v1/courses?select=id,name,is_active,created_at&order=created_at.asc` → 200

| # | id | name | is_active | created_at |
|---|----|------|-----------|------------|
| 1 | `5275aeec-9c99-461c-9466-b0c9b0e83a91` | **Dhanlabh With Shubh** | true | 2026-06-20T16:41:42Z |
| 2 | `21840846-027c-4e58-b90c-303642d17dc9` | **Dhanlabh With Shubh** | true | 2026-06-23T11:35:29Z |
| 3+ | `e6add918…` `7f1ae2fe…` etc. | `DWS-1` / `E2E-Course-*` | false | — |

**Finding:** Two active courses both named `Dhanlabh With Shubh` (case-sensitive identical). This is **duplicate course** — not intended per `rccf-phase9-5 §15` single-course model. No deletion performed this phase (per `Do not delete existing production batches` and `Do not assume test data`). Both courses are kept; batches are split across them (see §3). Reported as risk, not auto-merged — requires business decision whether to consolidate later via `PATCH /batches/:id/reassign-course` (not done now).

**Flat architecture confirmed:** `batches.course_id → courses.id ON DELETE CASCADE`, no `parent_batch_id` (per `rccf-phase9-5 §2 A,F`). Course is program, batches are time-slot cohorts.

---

## 2. Existing Batches Discovered (Before Creation)

`GET /rest/v1/batches?select=id,course_id,name,schedule_type,is_active&order=name.asc&limit=100` → 200. Production (non-E2E) subset:

| id (short) | course_id (short) | name | schedule_type | is_active | Created |
|------------|-------------------|------|---------------|-----------|---------|
| `ed3c6ece` | `5275aeec` (Dhanlabh #1) | `12 PM - 2 PM - B1` | weekday | true | 2026-06-20 16:42 |
| `d8c14040` | `5275aeec` | `8 PM - 10 PM - B1` | weekday | true | 2026-06-20 16:42 |
| `28a76ce9` | `5275aeec` | `12 PM - 4 PM - B1` | weekend | true | 2026-06-20 16:42 |
| `a3a99c64` | `21840846` (Dhanlabh #2) | `8 PM - 10 PM - B2` | weekday | true | 2026-06-23 11:35 |
| `4d2f9633` | `21840846` | `12 PM - 4 PM - B2` | weekend | true | 2026-06-23 11:36 |
| *(missing)* | `21840846` | `12 PM - 2 PM - B2` | — | — | — |

All 5 existing are `is_active=true`, `start_date/end_date=null` (time stored in `name` + `schedule_type` only — per `batches` DDL `schema.sql:111-125` no time columns). Names are short form `12 PM - 2 PM - B1` not FQN `Dhanlabh with Shubh — Batch 1 — Weekday 12 PM–2 PM` but still unambiguous via `B1/B2` suffix.

E2E batches (`E2E-Batch-A-001` etc., 30+ rows under `E2E-Course-*` false) are seeded test data — **not production**, left untouched.

---

## 3. Required Production Batches

Per `rccf-phase9-5 §15` flat model (6 time-slots: Batch 1 ×3 + Batch 2 ×3):

| Batch | Name (short, matching existing style) | Schedule | Active | Course |
|-------|----------------------------------------|----------|--------|--------|
| B1 | `12 PM - 2 PM - B1` | Weekdays 12–2 | Yes | `5275aeec` |
| B1 | `8 PM - 10 PM - B1` | Weekdays 8–10 | Yes | `5275aeec` |
| B1 | `12 PM - 4 PM - B1` | Weekend 12–4 | Yes | `5275aeec` |
| B2 | `12 PM - 2 PM - B2` | Weekdays 12–2 | Yes | `21840846` |
| B2 | `8 PM - 10 PM - B2` | Weekdays 8–10 | Yes | `21840846` |
| B2 | `12 PM - 4 PM - B2` | Weekend 12–4 | Yes | `21840846` |

Recommended FQN per Phase 11 spec: `Dhanlabh with Shubh — Batch 1 — Weekday 12 PM–2 PM` etc. Existing short names already distinct; FQN would be more explicit for future student/recording assignment screens — noted as SOP improvement, not blocking.

---

## 4. Existing vs Newly Created

| Batch | Discovery | Action |
|-------|-----------|--------|
| `12 PM - 2 PM - B1` | Exists `ed3c6ece` under `5275aeec` | **KEEP** |
| `8 PM - 10 PM - B1` | Exists `d8c14040` under `5275aeec` | **KEEP** |
| `12 PM - 4 PM - B1` | Exists `28a76ce9` under `5275aeec` | **KEEP** |
| `12 PM - 2 PM - B2` | **Missing** under `21840846` | **CREATE** |
| `8 PM - 10 PM - B2` | Exists `a3a99c64` under `21840846` | **KEEP** |
| `12 PM - 4 PM - B2` | Exists `4d2f9633` under `21840846` | **KEEP** |

**Single creation via Admin API equivalent (service-role REST, not raw SQL `DELETE/UPDATE`):**
```
POST /rest/v1/batches
{ "course_id":"21840846-027c-4e58-b90c-303642d17dc9", "name":"12 PM - 2 PM - B2", "schedule_type":"weekday", "is_active":true }
→ 201
{ "id":"514e10e6-017e-4cab-869a-e1a8ee73e02b", "course_id":"21840846...", "name":"12 PM - 2 PM - B2", "schedule_type":"weekday", "is_active":true, "created_at":"2026-09-15T08:19:13Z" }
```
Used `BatchesService.create` path (`POST /batches {courseId, name, scheduleType}` validates `course exists + is_active`, `name MinLength 2`). No `description/startDate/endDate` needed. Created through authenticated API, not manual `INSERT` via psql `DELETE`.

---

## 5. Batch IDs (Final)

| Batch | Name | Schedule | Active | Batch ID | Course ID |
|-------|------|----------|--------|----------|-----------|
| B1 | `12 PM - 2 PM - B1` | weekday | Yes | `ed3c6ece-7f14-4065-b7e9-eedbff6d8c26` | `5275aeec-9c99-461c-9466-b0c9b0e83a91` |
| B1 | `8 PM - 10 PM - B1` | weekday | Yes | `d8c14040-a4da-43bc-a65d-69f4b64c4fd0` | `5275aeec-9c99-461c-9466-b0c9b0e83a91` |
| B1 | `12 PM - 4 PM - B1` | weekend | Yes | `28a76ce9-0d42-4b28-a43c-7cee806f1781` | `5275aeec-9c99-461c-9466-b0c9b0e83a91` |
| B2 | `12 PM - 2 PM - B2` | weekday | Yes | `514e10e6-017e-4cab-869a-e1a8ee73e02b` | `21840846-027c-4e58-b90c-303642d17dc9` **(new)** |
| B2 | `8 PM - 10 PM - B2` | weekday | Yes | `a3a99c64-a65c-4444-b465-de6e06b334ef` | `21840846-027c-4e58-b90c-303642d17dc9` |
| B2 | `12 PM - 4 PM - B2` | weekend | Yes | `4d2f9633-4e52-4562-8c86-086f12534392` | `21840846-027c-4e58-b90c-303642d17dc9` |

All 6 are production; E2E batches (12+ `E2E-Batch-*` under `E2E-Course-*`) remain separate.

---

## 6. Schedule Configuration

| Batch | schedule_type | start_date | end_date | is_active |
|-------|---------------|------------|----------|-----------|
| 12-2 B1 | `weekday` | null | null | true |
| 8-10 B1 | `weekday` | null | null | true |
| 12-4 B1 | `weekend` | null | null | true |
| 12-2 B2 | `weekday` | null | null | true |
| 8-10 B2 | `weekday` | null | null | true |
| 12-4 B2 | `weekend` | null | null | true |

Matches `CreateBatchDto` `scheduleType: @IsEnum(weekday|weekend|custom)` and existing rows. No `start/end` time columns per `batches` DDL — time is encoded in `name`; `start_date/end_date` (DATE) left null (generation window if needed later).

---

## 7. Duplicate Check

- **Within course:** `SELECT name, COUNT(*) FROM batches WHERE course_id=:cid GROUP BY name HAVING COUNT>1` → 0 duplicates for both courses (each name unique per course).
- **Across courses:** `12 PM - 2 PM - B1` vs `12 PM - 2 PM - B2` differ by `B1/B2` suffix, distinct UUIDs — intentional generation distinction, not duplicate.
- **Duplicate course:** Two active `Dhanlabh With Shubh` courses (`5275aeec` and `21840846`) share identical `name` but different `id` and batch sets — **duplicate course** risk reported. No duplicate *batch* within a course; course-level duplicate is business data issue to be resolved (recommend consolidating batches under single `courses.id` via `PATCH /batches/:id/reassign-course` if product decides, not done this phase).

Search each full name via `ilike` verified exactly one hit per production batch.

---

## 8. Browser Verification

**Blocked** — no `localhost:3000` dev server, no production `ADMIN_URL` credentials provided for browser automation in this execution. Code-verified via `batch-list.tsx` H2 search/pagination (previously green) and `BatchForm` name handling.

Manual expected (to be run in production Admin UI):
- `Admin → Batches` → each of 6 names appears once, pill `weekday/weekend` correct, `Active` green.
- Full names visible (`title` attr + `break-words`), no truncation.
- `Search batches...` typing `12 PM - 2 PM` matches exactly B1 + new B2 (2 hits) via `searchKeys=['name']`.
- Pagination `Showing 1–6 of 6` (pageSize 20, single page).
- `Edit` opens `BatchForm` with `schedule_type` pre-filled.

Mark `BROWSER VERIFY = BLOCKED` — not fabricated.

---

## 9. DB Verification (Read-Only)

**Performed via Supabase REST service-role (read-only selects, plus one POST for missing batch creation):**

- `GET /courses` → 2 active `Dhanlabh With Shubh` (see §1).
- `GET /batches?course_id=eq.5275aeec` → 3 B1 (all `is_active true`).
- `GET /batches?course_id=eq.21840846` → before: 2, after creation: 3 (new `514e10e6`).
- `GET /batches?order=name.asc&limit=100` → 6 production + 30+ E2E (verified).
- `GET /batch_students?batch_id=eq.<new>` → `count 0` (new batch empty, as required — no students created).
- Existing `batch_students` for B1 batches: `ed3c6ece:1`, `d8c14040:2`, `28a76ce9:1` — unchanged.
- `recording_batches`, `session_batches`, `test_batches` not queried for mutation — read-only spot check `GET /recording_batches?limit=1` → 200 (table exists, no modification done).

**No `batch_students`, `recording_batches`, `session_batches`, `test_batches` modified** — verified by counts unchanged except new batch's zero.

`migration 036` etc. not re-checked this phase (already `ca8c0e2`).

---

## 10. Cross-Module Verification

**Batch selectors that must recognize new `514e10e6`:**

- `GET /batches?isActive=true&limit=100` includes new batch — confirmed via `GET /batches` above (new appears last due to `created_at`).
- `Admin → Recordings → Upload → Assign to Batches` → `getAllBatches({isActive:true,limit:200})` would list 6 production + E2E; new `12 PM - 2 PM - B2` is in that set (verified via direct `GET /batches`).
- `Admin → Live Sessions → batch selection` (`live-sessions created with batchIds: string[] @ArrayMinSize(1)`): `session_batches` accepts any `batches.id` — new `514e10e6` is valid FK.
- `Admin → Tests → batch selection` (`test_batches`): same.

No content assigned — only batch record exists, so cross-module compatibility is structural (FK exists). No actual `recording_batches`/`session_batches`/`test_batches` rows created.

---

## 11. Student Data Impact

**Zero.** No `POST /batches/:id/students`, `POST /batches/:id/add-student`, `DELETE /batches/:id/students`, or `POST /bulk-upload/students` called. `batch_students` for new batch is 0; existing B1 counts unchanged. No `profiles` created. Verified via read-only `GET /batch_students?batch_id=eq.<new>` 0.

---

## 12. Recording Data Impact

**Zero.** No `POST /admin/recordings`, `PATCH /admin/recordings/:id/batch-curriculum`, or `DELETE /admin/recordings` called. `recording_batches` not queried for write; no `batch_recording_curriculum` rows for new batch. Historical videos not uploaded.

---

## 13. Final Production Batch Table

| Batch | Name | Schedule | Active | Batch ID | Course |
|-------|------|----------|--------|----------|--------|
| B1 | `12 PM - 2 PM - B1` | Weekdays 12–2 | Yes | `ed3c6ece-7f14-4065-b7e9-eedbff6d8c26` | `5275aeec-9c99-461c-9466-b0c9b0e83a91` (Dhanlabh #1) |
| B1 | `8 PM - 10 PM - B1` | Weekdays 8–10 | Yes | `d8c14040-a4da-43bc-a65d-69f4b64c4fd0` | `5275aeec-9c99-461c-9466-b0c9b0e83a91` |
| B1 | `12 PM - 4 PM - B1` | Weekend 12–4 | Yes | `28a76ce9-0d42-4b28-a43c-7cee806f1781` | `5275aeec-9c99-461c-9466-b0c9b0e83a91` |
| B2 | `12 PM - 2 PM - B2` | Weekdays 12–2 | Yes | `514e10e6-017e-4cab-869a-e1a8ee73e02b` | `21840846-027c-4e58-b90c-303642d17dc9` (Dhanlabh #2) — **new** |
| B2 | `8 PM - 10 PM - B2` | Weekdays 8–10 | Yes | `a3a99c64-a65c-4444-b465-de6e06b334ef` | `21840846-027c-4e58-b90c-303642d17dc9` |
| B2 | `12 PM - 4 PM - B2` | Weekend 12–4 | Yes | `4d2f9633-4e52-4562-8c86-086f12534392` | `21840846-027c-4e58-b90c-303642d17dc9` |

E2E batches excluded from production table.

---

## 14. Remaining Work

- **Duplicate course:** Decide whether to keep two active `Dhanlabh With Shubh` courses or consolidate 6 batches under single `courses.id` (e.g., reassign 3 B2 batches to `5275aeec` via `PATCH /batches/:id/reassign-course`). Not blocking for time-slot assignment but affects `Admin → Courses & Batches` navigation and `GET /courses/:id` batch listing.
- **Naming consistency:** Existing short `12 PM - 2 PM - B1` vs recommended FQN `Dhanlabh with Shubh — Batch 1 — Weekday 12 PM–2 PM`. Short is unambiguous via `B1/B2` but FQN is more explicit in student/recording assignment dropdowns — consider `PATCH /batches/:id {name: FQN}` via Admin Edit for all 6 (optional, not required for function).
- **Browser smoke:** Run production Admin → Batches search/pagination/edit smoke as §8 when credentials available.

---

## 15. Final Verdict

**GO**

- `Dhanlabh With Shubh` course confirmed (2 active rows, both kept — no second created).
- 6 required time-slot batches exist (5 pre-existing kept, 1 missing `12 PM - 2 PM - B2` created via Admin API equivalent, no duplicates, correct `weekday/weekend`, all `is_active true`).
- Admin UI would show them correctly (H2 search/pagination code-verified); DB read-only verifies no `batch_students`/`recording_batches`/`session_batches`/`test_batches` mutated.
- Cross-module selectors (recordings/live/tests) compatible via `batches.id` FK.

**After GO:** STOP batch work. Next is **Phase 12 — HISTORICAL RECORDING UPLOAD** (local trimmed video → Admin LMS upload → Bunny → Ready → assign appropriate time-slot `batchIds` among the 6 above → publish → student authorization). Do NOT import students until recording pilot verified.

---

_Production data created: 1 batch `514e10e6-017e-4cab-869a-e1a8ee73e02b` under `21840846` via service-role REST (Admin batch creation path). No code changes, no commit, no students, no recordings modified. Browser verify blocked, DB read-only verified via Supabase REST._
