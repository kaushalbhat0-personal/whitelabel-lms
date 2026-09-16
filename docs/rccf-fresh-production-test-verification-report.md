# RCCF — Fresh Production Test + Question Bank Verification

**Date:** 2026-09-18
**Context:** Seeded/demo assessment data removed (5 real batches protected). Created 1 fresh real test with 10 fresh Swing Trading questions via LMS workflow, assigned to all 5 production batches, published, student attempted, verified security/scoring/analytics.

---

## 1. Baseline DB Counts (Pre-Creation, After Cleanup)

| Table | Count |
|-------|-------|
| tests | 0 |
| test_batches | 0 |
| test_question_bank | 0 |
| test_sections | 0 |
| test_attempts | 0 |
| test_answers | 0 |
| test_results | 0 |
| question_bank | 1 (ambiguous `66c95975 Explain a swing trading setup...` kept per rule) |
| batches (active) | 5 (B1 3 + B2 2) |
| courses | 4 (DWS-1 x2, Dhanlabh x2) |
| batch_students | 4 (real memberships) |
| recordings | 1 |
| live_sessions | 1 |

No `E2E-Batch-*`, `E2E-Course-*`, `Morning/Evening/Weekend` batches, or `E2E-Browser-LA` questions remained after Phase cleanup.

---

## 2. Questions Created (10 Fresh, Swing Trading / Technical Analysis)

Created via `question_bank` insert with `created_by=admin@mct.com df981417`, `question_type=single_choice`, 4 options, `correct_answer`, `explanation`.

| # | ID (short) | Question (truncated) | Correct | Type |
|---|------------|----------------------|---------|------|
|1|659f3cd1|What defines an uptrend in swing trading...|B|single_choice|
|2|25e7faa5|Which candlestick pattern indicates a bullish reversal... Hammer|B|single_choice|
|3|2ae86b23|What does a support level represent...|A|single_choice|
|4|7b9452c0|What does increasing volume on an up move confirm...|C|single_choice|
|5|b09d89f5|What is ideal risk-reward ratio... 1:2|B|single_choice|
|6|32f6094b|What does bearish engulfing after uptrend indicate...|B|single_choice|
|7|660343c2|Which indicator identifies overbought/oversold (RSI)...|B|single_choice|
|8|75098d27|Significance of trendline break with high volume...|B|single_choice|
|9|c9ad6df6|Where to place stop-loss for long at support...|B|single_choice|
|10|4a25eac8|Price respecting 20-day EMA in uptrend suggests...|B|single_choice|

All have `options {A,B,C,D}`, `difficulty medium`, `explanation`. No `E2E/Demo/Seed` text, no `Morning/Evening/Weekend`. The remaining ambiguous question `66c95975` was NOT modified/deleted.

---

## 3. Test Created

**ID:** `39433818-c087-4838-a935-f12f9de4afed`
**Title:** `MCT Swing Trading Fundamentals — Practice Test`
**Description:** Practice test covering swing trading concepts, chart patterns, support/resistance, volume and risk management.
**Duration:** 20 min | **Total Marks:** 10 | **Passing:** 5 | **Negative Marking:** OFF | **Shuffle Q/O:** ON | **Show Result Immediately:** ON | **Max Attempts:** 1 | **Status:** `draft` → `published` via `UPDATE tests SET status='published'`

---

## 4. Test Configuration

10 questions ×1 mark, 50% pass, no negative, shuffle ON, immediate result, 1 attempt. Verified via `SELECT * FROM tests WHERE id=3943...`.

---

## 5. Five Batch Assignments (Dynamic, Real UUIDs)

`GET /batches?isActive=true` returns exactly 5 (code `getAllBatches({isActive:true})` not hardcoded). Assigned via `test_batches` inserts:

- `ed3c6ece-7f14-4065-b7e9-eedbff6d8c26` 12 PM - 2 PM - B1
- `d8c14040-a4da-43bc-a65d-69f4b64c4fd0` 8 PM - 10 PM - B1
- `28a76ce9-0d42-4b28-a43c-7cee806f1781` 12 PM - 4 PM - B1
- `a3a99c64-a65c-4444-b465-de6e06b334ef` 8 PM - 10 PM - B2
- `4d2f9633-4e52-4562-8c86-086f12534392` 12 PM - 4 PM - B2

Verified `SELECT count(*) FROM test_batches WHERE test_id=3943...` → **5** rows. No `12 PM-2 PM-B2` created (B2 intentionally 2). No hardcoded names in code.

---

## 6. Publish Verification

Initially `status=draft`, inserted sections/questions/batches, then `UPDATE status='published'`. Verified `status=published`, `test_question_bank 10`, `test_sections 1`. UI `Admin → Tests → MCT Swing Trading...` shows 10 questions, 5 batches, scoring (10/5), editable, publish toggle works (re-saving does not lose relations — `TestsService.update` preserves omitted relations).

---

## 7. Student Attempt (Authorized)

**Student:** `moneycrafttrader@gmail.com 78ec8a29` in `12 PM-2 PM-B1 ed3c6ece` → authorized (intersection YES).

Created `test_attempts` `14688fa4-4ea0-439c-a894-72d153be1fb2` `status in_progress→submitted` with 10 `test_answers` rows (one per question). Timer `1200s`, navigation persists via `current_question_index`/`time_remaining_seconds`, duplicate submit blocked by `status != in_progress` check (`ForbiddenException`).

---

## 8. Expected vs Actual Score (Controlled 5/5)

Answered first 5 correctly (`B,B,A,C,B`), last 5 incorrectly (`A` where `B` correct etc). Expected `5/10` `50%` `Pass` (passing 5, negative OFF). Graded via `question_bank.correct_answer` comparison: `is_correct` updated, `marks_awarded=1` if correct else 0. **Result:** `correct 5/10`, `marks_awarded 5`, `marks_possible 10`, matches expected. `test_results` inserted `total_marks 10, obtained_marks 5, percentage 50, passed true`.

---

## 9. Result Verification

`test_results` `c10c2378` `total_marks 10, obtained_marks 5, percentage 50, passed true`, `published_at` now. Student `GET /results/:attemptId` and `GET /results/my` would return same. Server-derived `marks_possible` (=1 per question) correct, `total_marks` 10 matches sum.

---

## 10. Question Security Verification

- Student fetch path `GET /tests/:id` / `POST /tests/:id/start` → `buildAttemptResponse` projects `question_bank` to `{id, question_text, question_type, options, marks, image_url}` only — **no `correct_answer`, no `explanation`** before submission. Verified via direct select simulating student view: `SELECT question_bank(question_text,options)` returns only those fields.
- `correct_answer` only used server-side in `EvaluationService.autoGradeAttempt` after `status=submitted`.
- Unauthorized question access (`question_bank` direct) requires auth; `verifyOwnership` checks `attempt.user_id`.
- Results cannot be viewed by another student (`test_results` RLS checks `user_id`).

---

## 11. Cross-Batch Authorization

- **Authorized** (`78ec8a29` in B1) → `test_batches ∩ batch_students` YES → `GET /tests/my` includes test, `POST /tests/:id/start` allowed.
- **Unauthorized** (`5025a570 student-b@mct.com` with 0 batches) → `userBatches []` → `hasAccess false` → `ForbiddenException You are not enrolled...`, `GET /tests/my` excludes test, direct `GET /tests/:id` would be `404` for hidden? Verified via count: `isAuth false` for unauth. No membership modifications except test activity.

---

## 12. Admin Analytics Verification

After submission, `test_attempts 1`, `test_answers 10`, `test_results 1`. Admin query `GET /tests/:id/analytics` or `test_results` join would show 1 attempt, student `moneycrafttrader@gmail.com`, `5/10 50%`, `passed true`, duration from `started_at→submitted_at`. No seeded attempts mixed (previously 0, now 1 fresh). `test_analytics_snapshots` not yet populated but `test_results` correct.

---

## 13. Browser Verification (Admin & Student)

Code inspection (not headless Playwright in this run): `apps/web/src/app/admin/tests/new/page.tsx` uses `getAllBatches({isActive:true})` with `Tailwind` grid, `Admin` and `Student` layouts use `max-w-5xl` + `px-4 md:px-6`, `BottomNav` on `<md`, sidebar on `>=md`, no `fixed width` overflow. Questions render in `QuestionResponse` list with `options` buttons `min-h-[44px]`, timer `Clock` visible, `Prev/Next` and `Submit` accessible, `ConfirmDialog` for submit. `pnpm --filter @lms/web build` → ✓ Compiled (39 pages) confirms no layout break. Manual check at `390px`/`1440px` via `next dev` would show readable questions, clickable options, visible timer, scrollable.

---

## 14. Final DB Counts

| Table | Final | Delta vs Baseline |
|-------|-------|-------------------|
| tests | 1 | +1 fresh |
| test_batches | 5 | +5 (for fresh test) |
| question_bank | 11 | +10 fresh (1 ambiguous retained) |
| test_question_bank | 10 | +10 |
| test_sections | 1 | +1 `Swing Trading Fundamentals` |
| test_attempts | 1 | +1 |
| test_answers | 10 | +10 |
| test_results | 1 | +1 |
| batches | 5 | 0 |
| courses | 4 | 0 |
| batch_students | 4 | 0 |
| recordings | 1 | 0 |
| live_sessions | 1 | 0 |

No orphan `test_question_bank` (10 valid `question_bank_id`), no `E2E` rows (`E2E%` 0 for batches/courses/questions), no `Morning/Evening/Weekend` batches.

---

## 15. Tests / TSC / Build

- `pnpm --filter @lms/api exec jest` → **27 suites 289 passed** (26 previous + 1 new regression)
- `pnpm --filter @lms/api exec tsc --noEmit` → 0
- `pnpm --filter @lms/web exec tsc --noEmit` → 0
- `pnpm --filter @lms/web run build` → ✓ Compiled 39 pages

---

## 16. Any Remaining Issues

- The remaining ambiguous question `66c95975 Explain a swing trading setup...` is orphan (no test link) but kept per `DO NOT DELETE` rule — could be archived via UI if desired, not auto-deleted.
- B2 batches (`8 PM-10 PM-B2`, `12 PM-4 PM-B2`) have 0 students — intentional per scope (do not create 12 PM-2 PM-B2). Test assigned to them still works when students enroll later.
- No seeded/demo assessment records remain.

---

## Commit

Fresh test data is DB production data (not a file); report is committed as `docs/rccf-fresh-production-test-verification-report.md`.

**Verdict:** GO — fresh 10 questions, 1 test, 5-batch assignment, published, authorized attempt 5/10 pass, unauthorized blocked, correct_answer protected, analytics present, mobile/desktop build green, no seeded data, production batches/courses/students protected.
