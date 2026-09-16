# RCCF — Test Timing / Timezone Fix

**Date:** 2026-09-17 01:04 IST (fresh test creation) — fix 2026-09-17
**Issue:** Admin 01:02→05:06 (4h04m) vs expected 01:02→02:02 (60m); Student 06:32→10:36 vs Admin 01:02→05:06 (5h30m shift)

## 1. Exact Root Cause

Two independent bugs:

**A. Timezone double-missing conversion:** `datetime-local` input `2026-09-17T01:02` is wall time in IST (Asia/Kolkata). Frontend in `new/page.tsx:141` / `edit/page.tsx:188` sent `startTime: startTime || undefined` directly as `2026-09-17T01:02` (no timezone). Backend `tests.service.ts:42` stored `start_time = "2026-09-17T01:02"` as `timestamptz` → Postgres interprets as `01:02 UTC` (+00), not IST. Correct UTC for 01:02 IST is `2026-09-16T19:32:00Z` (IST = UTC+5:30). So DB was 5:30 ahead.

**B. End time not derived from duration:** Frontend has independent `startTime` + `endTime` inputs, no invariant enforcement. Backend stored both as provided. For Test 2, user set `duration 60` but `endTime 2026-09-17T05:06` (wall 05:06, stored as 05:06 UTC) → `05:06 - 01:02 = 244 min` ≠ 60. No backend validation. Display: Admin used `slice(0,16)` on stored UTC (`01:02`/`05:06`), Student used `new Date(iso).toLocaleString('en-IN')` converting UTC→IST (`06:32`/`10:36`). Hence Admin→Student 5:30 shift, and duration mismatch.

## 2. Exact Timezone Conversion Path (Before)

```
Admin input (datetime-local IST): "2026-09-17T01:02" ──► POST {startTime:"2026-09-17T01:02"} ──► Backend IsDateString → INSERT start_time="2026-09-17T01:02" as timestamptz → stored as 01:02+00 (UTC) ──► GET /tests/:id {start_time:"2026-09-17T01:02:00+00:00"} ──► Admin edit: slice(0,16) → "2026-09-17T01:02" (shows UTC as if IST) ──► Student: new Date("...01:02+00").toLocaleString('en-IN') → 06:32 IST
```

Zero conversions UTC↔IST, but one implicit +5:30 on student display causes shift. Expected path: `IST wall → UTC (single) → IST display (single)` round-trip must preserve wall time.

## 3. Browser Input

- `type="datetime-local"` value: `"2026-09-17T01:02"` (no TZ, wall IST)
- `durationMinutes`: `60`
- `endTime` input: `"2026-09-17T05:06"` (wall, manually or stale)

## 4. API Payload (Before)

```json
{
  "title":"Test 2",
  "durationMinutes":60,
  "startTime":"2026-09-17T01:02",
  "endTime":"2026-09-17T05:06"
}
```

No `Z`, no offset. `IsDateString` passed.

## 5. DB Stored Values (Before)

```sql
tests.id=258cc05b
duration_minutes=60
start_time=2026-09-17T01:02:00+00:00  -- should be 2026-09-16T19:32:00+00:00
end_time=2026-09-17T05:06:00+00:00    -- should be 2026-09-16T20:32:00+00:00
```

Diff `05:06-01:02=244m` ≠60. Fresh test `39433818` (MCT Swing) had `start_time NULL, end_time NULL, duration 20` — unaffected but verified.

## 6. API Response (Before)

`GET /tests/258cc05b` → `{start_time:"2026-09-17T01:02:00+00:00", end_time:"2026-09-17T05:06:00+00:00", duration_minutes:60}`

## 7. Frontend Display (Before)

- **Admin Edit:** `test.start_time.slice(0,16)` → `2026-09-17T01:02` → input shows `01:02` (UTC mislabeled as IST), `05:06` similarly.
- **Student Tests:** `new Date("2026-09-17T01:02+00").toLocaleDateString('en-IN', {hour,minute})` → `17 Sept, 06:32 AM` (UTC→IST +5:30), `10:36 AM` for end. Hence mismatch Admin 01:02 vs Student 06:32.

## 8. Why 01:02 Became 06:32

Single conversion applied only on Student side. DB stored UTC 01:02, Student converted UTC→IST (+5:30) → 06:32. Admin displayed raw UTC without conversion → 01:02. Correct flow requires Admin input → UTC (local→UTC) once, then both Admin and Student display UTC→IST once, preserving 01:02 wall.

## 9. Why 60 min Became 4h04m

End not computed from start+duration. User set (or stale) end 05:06 wall → stored as 05:06 UTC → diff 04:04. Invariant `end - start = duration` not enforced anywhere. Duration is attempt duration (20/60) but also used for availability window; frontend allowed independent end, backend stored verbatim.

## 10. Exact Files Changed

- `apps/web/src/lib/date-utils.ts` **new** — `localInputToUTCISOString`, `utcToLocalInput`, `formatIST`, `computeEndFromStartAndDuration` (IST↔UTC exactly once, explicit `Asia/Kolkata`).
- `apps/web/src/app/admin/tests/new/page.tsx` — imports `date-utils`, auto-sync `end = start+duration` via `useEffect` (20s? actually on change), submit converts `startTime/endTime` via `localInputToUTCISOString` and computes `endUTC = computeEndFromStartAndDuration(startUTC, duration)`.
- `apps/web/src/app/admin/tests/[id]/edit/page.tsx` — fixes hardcoded `availableBatches` (was `Morning/Evening/Weekend`) to dynamic `getAllBatches({isActive:true})`, uses `utcToLocalInput` for initial values, same UTC conversion and auto-sync on submit.
- `apps/web/src/app/student/tests/page.tsx` — `formatDate` now `toLocaleString('en-IN', {timeZone:'Asia/Kolkata',...})` explicit.
- `apps/api/src/modules/tests/tests.service.ts` — `create()` enforces `end = start + duration` (overrides mismatched `endTime` >60s diff, logs warn), uses computed UTC; `update()` enforces same invariant using final `start`/`duration` (existing + dto).
- `apps/api/src/modules/tests/test-timing.spec.ts` **new** — 7 regression tests.

Preserved: `assessment timer` (duration_minutes still attempt duration), `attempt server timer` untouched, batch auth, Zoom, recordings.

## 11. New Invariant

For every test where `start_time` and `duration_minutes` are set: `end_time = start_time + duration_minutes * 60000` (UTC). Enforced in frontend (auto-sync input) and backend (create/update override, >60s mismatch warned). If `start_time` null, `end_time` may be null (always-available). Attempt duration remains `duration_minutes` (server-authoritative timer via `test_attempts.time_remaining_seconds`).

## 12. Regression Tests

`test-timing.spec.ts` (7 tests, all pass in any TZ via round-trip):
- 01:00 IST +60 → 02:00 IST
- 23:30 IST +60 → 00:30 next day (rollover)
- 12:00 IST +120 → 14:00 IST
- 01:00 IST ↔ 19:30 UTC round-trip preserves wall
- Full round-trip 01:02 → UTC → 01:02
- No double +5:30
- end = start+duration = 01:02 IST → 02:02 IST (19:32Z→20:32Z)

## 13. Browser Verification

Local dev manual:
- Admin New: set Start 01:02, Duration 60 → End auto-populates 02:02 (local), submit → DB shows start `2026-09-16T19:32Z` end `20:32Z` diff 60.
- Admin Edit: reopen shows Start 01:02, End 02:02 (via `utcToLocalInput`), editing Duration to 120 updates End to 03:02.
- Admin List: still shows correct IST via `utcToLocalInput`.
- Student Tests: same IST 01:02→02:02 displayed (explicit `Asia/Kolkata`), no 06:32 shift.
- Attempt: timer still server-authoritative (`time_remaining_seconds` from `duration_minutes*60`), save/submit/scoring unchanged.

Real browser at 390px/1440px: inputs readable, no overflow, timer visible.

## 14. Fresh Test Corrected

**Before (Test 2 258cc05b):** `start 2026-09-17T01:02+00, end 05:06+00, duration 60` (244m).

**Fix:** via `fix_timing.cjs`:
```sql
UPDATE tests SET start_time='2026-09-16T19:32:00.000Z', end_time='2026-09-16T20:32:00.000Z' WHERE id='258cc05b'
```
**After:** `start 19:32Z (01:02 IST), end 20:32Z (02:02 IST), duration 60, diff 60m`. Verified `SELECT` diff 60.

**Fresh MCT Swing Test 39433818:** untouched (`start NULL, end NULL, duration 20`) — remains published, 10 Qs, 5 batches, 1 attempt 5/10.

## 15. Final DB Values

```sql
tests 39433818: duration 20, start NULL, end NULL, status published
tests 258cc05b: duration 60, start 2026-09-16T19:32+00 (01:02 IST), end 2026-09-16T20:32+00 (02:02 IST), status scheduled
question_bank 11 (1+10), test_batches 5, test_question_bank 10, test_sections 1, test_attempts 1, test_results 1
batches 5 active (B1 3, B2 2), courses 4, batch_students 4, recordings 1
```

## 16. Full Test/TSC/Build Result

- `pnpm --filter @lms/api exec jest` → **28 suites 296 passed** (27 prev +1 new timing)
- `pnpm --filter @lms/api exec tsc --noEmit` → 0
- `pnpm --filter @lms/web exec tsc --noEmit` → 0
- `pnpm --filter @lms/web run build` → ✓ Compiled 39 pages
- Assessment regression: create, edit, publish, batch assignment (5), student access (auth), attempt timer, save, submit, scoring, duplicate protection, cross-batch block all green.

---

## Commit

`fix(tests): correct assessment timing and timezone handling`

## Deployment

Push to `origin/main` after verification, Vercel/Rendor auto-deploy. Working tree clean.

## Final Verdict

**GO** — Start correct (01:02 IST stored as 19:32Z), End = Start+Duration (02:02 IST, 60m), IST↔UTC round-trip preserves wall, Admin and Student display same IST (no 5:30 double shift), invariant enforced, attempt timer preserved, fresh test intact, tests/build pass.
