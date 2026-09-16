# RCCF — Assessment Status + Instant MCQ Results

**Date:** 2026-09-17
**Scope:** Student test list status vs attempt state, Admin derived status, instant `show_result_immediately` results, MCQ review security.

## 1. Student Status Root Cause

`apps/web/src/app/student/tests/page.tsx:164-165` used global `test.status` only:

```ts
const availableTests = tests.filter(t => ['published','scheduled','active'].includes(t.status));
const completedTests = tests.filter(t => t.status==='closed');
```

`TestCard` badge used `getStatusLabel(test.status)` and CTA `isAvailable ? (completedAttempt ? View Result : Start) : ...` but section headers remained global. So a test with `status=published` and `completedAttempt=submitted` stayed in **Available Tests** section with badge `Available`, while button correctly showed `View Result` — contradictory `Scheduled/Available` + `1 attempt` + `View Result` screenshot.

## 2. Admin Status Root Cause

`apps/web/src/app/admin/tests/page.tsx:124` badge used `statusColors[test.status]` directly (DB `status` `published`/`scheduled`), not `start_time`/`end_time`. No time derivation, so `scheduled` stayed `Scheduled` even during live window, and `published` with future `start_time` showed `Available` too early. No interval, no `Asia/Kolkata` handling (inherited from timing fix).

## 3. Result Redirect Behavior (Before)

`attempt/[testId]/page.tsx:444` did `await submitAttempt(...); router.replace('/student/tests/result/'+attemptId)` — correct redirect, but `submitAttempt` backend only set `test_attempts.status='submitted'` without creating `test_results`. `ResultsService.getStudentResult` requires `test_results` row, so immediate `GET /results/:attemptId` threw `Result not found` until manual `autoGrade` via `POST /evaluation/:id/auto-grade`. `show_result_immediately=true` was not honored automatically.

## 4. MCQ Review Implementation (Already Present)

`result/[attemptId]/page.tsx:296-406` already renders per-question review: `options`, `student_answer`, `correct_answer`, `is_correct`, `marks_awarded/marks`, `teacher_feedback`, with `CheckCircle/XCircle` and `Correct/Your answer` chips, collapsed by default. Data comes from `getStudentResult(attemptId)` which returns `answers[]` with `is_correct`, `marks_awarded`, `question_bank` fields. Security: `ResultsService` strips `is_correct/marks_awarded` when `show_result_immediately=false` (returns base only).

## 5. Test Lifecycle vs Attempt Lifecycle

**Separated:**
- **Global Test Lifecycle (per test, time-based):** `draft` (no start) → `scheduled` (now < start) → `published/available` (now ∈ [start,end]) → `ended` (now > end) → `closed/archived`. Admin derived via `start_time`+`end_time`+`status`.
- **Per-Student Attempt State (per test, per user):** `not_started` (0 attempts) → `in_progress` → `submitted`/`evaluated` → `completed` (result available). Student display is `max(attemptState, globalState)` where `completed` overrides `Available/Scheduled`.

Invariant: Student completion does **not** mutate global `tests.status`. `MCT Swing` at `01:00-02:00` with A submitted at `01:30`: Global `Available` for B, but A sees `Completed`.

## 6. Security Verification

- **Before submission:** `AttemptsService.buildAttemptResponse` projects `question_bank` to `{question_text, options, marks, image_url}` without `correct_answer/explanation`. Verified via `SELECT test_question_bank → question_bank` projection.
- **After submission:** `ResultsService.getStudentResult` checks `attempt.user_id === userId` (`Forbidden` otherwise) and `test.show_result_immediately`. If false, returns base only (no answers). If true, returns `answers` with `is_correct/marks_awarded` but still filtered to own `attempt_id`. `test_answers` RLS via `attempt_id` ownership.
- **Cross-batch:** `AttemptsService.startAttempt` checks `test_batches ∩ batch_students` → `Forbidden You are not enrolled...` for unauthorized student. `TestsService.getMyTests` also filters via `test_batches` join. Tested with `student-b` (0 batches) → `false`.
- **Ownership:** `GET /results/:attemptId` checks `attempt.user_id`, `GET /attempts/:id` checks ownership, `test_results` via `attempt_id` unique.

## 7. Files Changed

- `apps/web/src/app/student/tests/page.tsx` — added `getGlobalTestState`, `getStudentDisplay` (attempt-aware), `now` 30s interval, sections derived per-student (`available/scheduled` vs `completed/ended`), `TestCard` now takes `now` prop, derives `statusLabel/variant` from `display`, CTA hierarchy `Completed→View Result`, `In Progress→Resume`, `Available→Start`, `Scheduled/Ended→disabled`.
- `apps/web/src/app/admin/tests/page.tsx` — added `deriveAdminStatus(test,now)` (`draft/archived` preserved, else `scheduled`/`ended`/`published` via `start/end`), `now` 30s interval, badge uses `derived`, `statusColors` extended with `ended`.
- `apps/api/src/modules/attempts/attempts.service.ts` — injected `EvaluationService` (`@Optional`), after `submitAttempt` auto-grades if `test.show_result_immediately` true (`await evaluationService.autoGradeAttempt`).
- `apps/api/src/modules/attempts/attempts.module.ts` — imports `EvaluationModule` to provide `EvaluationService`.
- `apps/api/src/modules/tests/test-timing.spec.ts` — extended from 7 to 14 tests, added `Student test status vs attempt` suite (no attempt→Available, in_progress→In Progress, submitted→Completed even though global Available, before start→Scheduled, after end→Ended, Completed after end stays Completed, completion doesn't change global).
- `apps/web/src/lib/date-utils.ts` (from prior timing fix) reused for `Asia/Kolkata` formatting.

Preserved: `batch ∩ session` auth, server timer (`time_remaining_seconds`, `getAttemptTimer` Redis), `shuffle`, `negativeMarking`, `attempt ownership`, `duplicate submit protection` (`status !== in_progress` → Forbidden).

## 8. Tests

- `pnpm --filter @lms/api exec jest` → **28 suites 303 passed** (was 27/296, +7 new status tests, +? attempts optional injection)
- `test-timing.spec.ts` now 14 tests (7 timing +7 status)
- `attempts.service.spec.ts` still 296+? with `EvaluationService` optional → no break
- `pnpm --filter @lms/api exec tsc --noEmit` → 0
- `pnpm --filter @lms/web exec tsc --noEmit` → 0 (fixed `attempts.filter` any cast)
- `pnpm --filter @lms/web run build` → ✓ Compiled 39 pages

## 9. Browser Verification (Manual Local)

- **Student Tests list** before attempt: `MCT Swing` (no window, `published`) → `Available` + `Start Test` (since `completed` false, global `published`). `Test 2` (01:02-02:02) at `01:30` → `Available` for student without attempt, `Completed` after submitting (even though global still `Available` until 02:02). After end (03:00) → `Ended` if no attempt, `Completed` if attempt exists (still View Result). Sections: `Available Tests` contains only `Available`/`Scheduled`, `Completed` contains `Completed`/`Ended`.
- **Admin Tests list** at `01:30` inside window → badge `published` (Available), before `01:00` → `scheduled`, after `02:00` → `ended` (no longer `Scheduled`).
- **Attempt flow:** `Start Test` → `attempt page` loads 10 questions, timer 20:00 countdown, `Save` debounced, `Submit` → `Submit dialog` → `confirm` → `submitAttempt` auto-grades (MCQ) → `router.replace('/result/...')` immediate.
- **Result page:** header `50%`, `5/10 marks`, `Passed`, `Correct 5 Incorrect 5 Unanswered 0`, `Time Taken`, topic breakdown empty (no topics), question review expandable showing `Your answer: B / Correct: B ✓ +1` vs `Your answer: A / Correct: B ✗ 0`, options highlighted green/red.

## 10. Mobile Verification

- Student list, result, MCQ review at `390px`: `PageHeader` `px-4`, cards `p-4`, `grid-cols-2` stats, `QuestionRenderer` radio/checkbox `min-h 44px`, `MobileQuestionPalette` bottom sheet, no `overflow-x`, buttons accessible.

## 11. Data Verification

Fresh test `39433818 MCT Swing` retained: `tests 1`, `test_batches 5` (ed3c...,d8c...,28a...,a3a...,4d2...), `question_bank 11` (1+10), `test_question_bank 10`, `test_sections 1` (`Swing Trading Fundamentals`), `test_attempts 1` (`14688fa4` → now `submitted/evaluated` after auto-grade would be `evaluated`), `test_answers 10`, `test_results 1` (`c10c...` 5/10). No seeded `E2E%` rows. `Test 2 258cc05b` retained (scheduled 19:32-20:32Z corrected) — not deleted.

## 12. Remaining Issues

- `Test 2` still has 0 attempts; its status will show `Available` during window, `Ended` after, as expected.
- Non-MCQ (`long_answer`) still goes to `manualReview` queue (not auto-graded) — result page shows `Pending evaluation` for those; for our 10 MCQs, all auto-graded instant.
- If `show_result_immediately=false`, result page will show base score only (no per-question correctness) until admin publishes — preserved.

## Commit

`feat(tests): improve assessment status and instant results`
