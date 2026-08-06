# RCCF Report — Phase 5: Assessments & Tests Production Hardening (Audit)

**Scope:** Complete production audit of the Assessment/Tests ecosystem. Source + browser + API + DB + e2e verification. No feature work. Verified bugs were fixed.

**Result:** **7 verified production bugs found and fixed (2 P0, 4 P1, 1 P2)**. The assessment module's core lifecycle (start → save → submit → auto-grade → manual review → publish → result) was **entirely broken** — a student could not start a fresh test, and no submission could be graded or published. All fixed and browser/API/DB verified.

---

## Executive Summary

The Assessments module was the least-tested, most-broken module in the platform. Unlike Recordings (which had 62 e2e + 34 unit tests), **Assessments has ZERO unit tests and ZERO e2e tests**. The audit found the entire attempt lifecycle was non-functional due to two DB-schema drift bugs (`sort_order` insert on `test_answers`, `updated_at` update on `test_attempts`), plus a test-visibility bug (`test_batches!inner`), a review-queue UI crash, and a correct-answer leakage. All were fixed with minimal code changes (5 files + 1 migration), and the full lifecycle now works end-to-end.

| Metric | Result |
|--------|--------|
| Verified bugs | 7 (2 P0, 4 P1, 1 P2) — **all fixed** |
| Files changed | 6 (5 source + 1 migration) |
| API Jest tests | 43/43 pass |
| Playwright e2e | 62/62 pass |
| Assessment browser pages | All 200, 0 errors |
| Assessment unit/e2e tests pre-existing | **0** (major gap) |

---

## 1. Architecture (Phase 1)

### Modules (6)
| Module | Controllers | Services | DTOs |
|--------|-------------|----------|------|
| `tests` | `tests.controller`, `admin-tests.controller` | `tests.service` | create/update |
| `questions` | `questions.controller` | `questions.service` | create-question |
| `attempts` | `attempts.controller` | `attempts.service` | start-attempt (3 DTOs) |
| `results` | `results.controller` | `results.service` | results |
| `evaluation` | `evaluation.controller` | `evaluation.service` | evaluate |
| `analytics` | `analytics.controller` | `analytics.service` | — |

### Render/flow diagrams (text)
```
Admin: create question → question_bank → create test → test_sections/test_question_bank/test_batches → publish
Student: start → test_attempts + test_answers → save/submit → evaluation:auto-grade → publish → test_results
```

### Single source of truth
- `test_attempts` is the attempt lifecycle owner (status transitions: `in_progress → submitted → evaluated/partially_evaluated → published`)
- `test_results` is the published-result source of truth (one per attempt, UNIQUE attempt_id)
- `test_review_queue` is the manual-grading queue

### Known gaps found
- **`shuffle_options` is stored but never implemented** — the DTO/test column accept it, but `startAttempt` never shuffles options (P2).
- **`section_title` mapping bug** — `buildAttemptResponse` reads `q.section?.title` but the embed key is `test_sections` → always `undefined` (P2, fixed).
- **`calculateAnalytics`/`calculateRank` unbounded scans** — full table reads, no pagination (P2 perf).
- Legacy duplicate: `admin-tests.controller` `GET /admin/tests` duplicates `GET /tests` (dead-ish, P3).

## 2. Database (Phase 2)

### Tables (from migration 013 + 014 + 028 + 029)
| Table | Purpose | Key columns | Notes |
|-------|---------|-------------|-------|
| `tests` | Test definition | status, total_marks, passing_marks, duration_minutes, max_attempts, shuffle_*, negative_* | has `updated_at` |
| `test_sections` | Question groups | test_id FK CASCADE | |
| `question_bank` | Reusable questions | question_text, question_type, options, correct_answer, explanation, difficulty, topic_id, is_archived | has `updated_at` |
| `test_question_bank` | Test↔question links | test_id FK, question_bank_id FK, marks, sort_order, section_id | UNIQUE(test_id,question_bank_id) |
| `test_batches` | Test↔batch links | test_id, batch_id | UNIQUE(test_id,batch_id) |
| `test_attempts` | Attempt lifecycle | status, current_question_index, time_remaining_seconds, last_saved_at, attempt_number | **NO `updated_at`** (bug) |
| `test_answers` | Per-question answers | attempt_id FK, question_id FK, answer JSONB, marks_*, is_correct, is_manual_review, feedback | **NO `sort_order`** (bug) |
| `test_review_queue` | Manual grading queue | test_id, attempt_id, answer_id, status, assigned_to | UNIQUE(attempt_id,question_id) |
| `test_results` | Published results | attempt_id UNIQUE, obtained/total_marks, rank, percentage, passed, topic/question_analysis | |
| `test_analytics_snapshots` | Analytics cache | test_id, aggregate JSONB | |

### DB-schema drift (root causes of the P0/P1 bugs)
- **`test_attempts` lacks `updated_at`** but code updates it in 5 places → every grade/publish/review 500s (P0).
- **`test_answers` lacks `sort_order`** but code inserts it → fresh attempt start 500s (P0).
- Both columns are referenced in `attempts.service.ts`, `evaluation.service.ts`, `results.service.ts`.

## 3. Workflows (Phase 3)

### Verified broken → now fixed
| Workflow | Before | After |
|----------|--------|-------|
| Create test without batches | **404 "Test not found"** | 201 ✅ |
| Admin view/edit test with no batches | **404** / hidden from list | 200 + visible ✅ |
| Student fresh attempt start | **500** (sort_order), orphan attempt w/ 0 answers | 201, answers created ✅ |
| Save answers | worked (last_saved_at) | ✅ |
| Submit attempt | worked | ✅ |
| Auto-grade | **500** (updated_at) | 201 ✅ |
| Manual review submit | **500** (updated_at) | 200 ✅ |
| Publish results | **500** (updated_at) | 201 ✅ |
| View result | blocked by grade failure | 200 (5/5, rank 1, passed) ✅ |
| Review queue UI expand | **React crash #31** | renders answer ✅ |

### Verified working (no change)
- Question CRUD, bulk import, archive, topics
- Test create/duplicate/archive/delete with batches
- Review queue list/filter/assign
- Student tests list, results list, result detail
- Attempt resume (in_progress return)
- Timer endpoint (ownership-guarded)

## 4. API (Phase 4)

### Endpoint inventory (all verified)
| Method+Path | Roles | Status |
|-------------|-------|--------|
| POST `/questions` | admin/teacher | ✅ |
| POST `/questions/bulk-import` | admin/teacher | ✅ |
| GET `/questions` (topic/difficulty/type/search/page) | admin/teacher | ✅ |
| GET `/questions/topics` | admin/teacher | ✅ |
| GET/PATCH/DELETE `/questions/:id`, archive/unarchive | admin/teacher | ✅ |
| POST `/tests` | admin/teacher | ✅ (no-batch now OK) |
| POST `/tests/:id/duplicate` | admin/teacher | ✅ |
| GET `/tests` (status/batchId/search/page) | admin/teacher | ✅ (all tests now visible) |
| GET `/tests/my` | student | ✅ |
| GET/PATCH `/tests/:id` | admin/teacher | ✅ |
| PATCH `/tests/:id/status`, POST `/tests/:id/archive`, DELETE | admin/teacher | ✅ |
| GET `/admin/tests` | admin/teacher | ✅ (legacy dup) |
| POST `/attempts/tests/:testId/start` | student | ✅ (fixed) |
| GET `/attempts/my`, GET `/attempts/:id` | student | ✅ |
| PATCH `/attempts/:id/answer`, `/answers` | student | ✅ |
| POST `/attempts/:id/submit`, GET `/attempts/:id/timer` | student | ✅ |
| POST `/evaluation/:attemptId/auto-grade` | admin/teacher | ✅ (fixed) |
| GET `/evaluation/review-queue`, PATCH assign/review | admin/teacher | ✅ (fixed) |
| POST `/evaluation/:attemptId/publish` | admin/teacher | ✅ (fixed) |
| GET `/results/my`, `/results/:attemptId` | student | ✅ |
| GET `/results/test/:testId`, `/results/test/:testId/analytics` | admin/teacher | ✅ |
| GET `/results/student/:userId/analytics`, `/results/admin/overall` | admin | ✅ |

### Findings
- **Timer bypass (P2)**: `submitAttempt` accepts `timeRemainingSeconds: 0` (server doesn't enforce elapsed-time expiry). A student can submit after time runs out. DTO only rejects negatives.
- **Inflated timer (P2)**: `saveAnswer` accepts `timeRemainingSeconds` far above test duration (no server-side cap).
- **Partial-update destructive (P2)**: `PATCH /tests/:id` with only `batches` deletes sections/questions and re-inserts only batches (data-loss risk via direct API; normal UI always sends all relations).

## 5. Browser (Phase 5)

| Page | Result |
|------|--------|
| /admin/tests | 200, 0 errors, shows previously-hidden test ✅ |
| /admin/tests/new | 200, 0 errors |
| /admin/tests/[id]/edit | 200 (was 404) ✅ |
| /admin/questions | 200, 0 errors |
| /admin/review-queue | 200, expands answer without crash ✅ |
| /admin/analytics | 200, 0 errors |
| /student/tests | 200, 0 errors |
| /student/results + result detail | 200, 0 errors |

No console errors, no HTTP errors, no overflow on any assessment page after fixes.

## 6. UX (Phase 6)
- **`section_title` never displays** (embed key bug) — fixed.
- **`shuffle_options` has no effect** (stored, unused) — P2.
- Review queue answer for long-answer was rendered as raw object (crash) — fixed.
- Tests list: draft tests previously invisible to admin (confusing "empty" list) — fixed.
- No missing confirmations; archive/delete have confirm dialogs. Good loading/empty/error states present.

## 7. Security (Phase 7)

| Check | Result |
|-------|--------|
| Cross-user attempt access | **403** ✅ |
| Cross-user result access | **403** ✅ |
| Student → admin endpoints (tests/questions/review-queue/results-admin) | **403** ✅ |
| **Correct answer / explanation leakage in start-attempt response** | **P1 — FIXED** (removed from student-facing payload) |
| Timer expiry bypass | P2 — server doesn't enforce |
| Attempt ownership (verifyOwnership) | ✅ enforced on all attempt mutations |
| Question-in-test validation (`validateQuestionsBelongToTest`) | ✅ prevents saving answers for questions not in the test |
| Batch authorization on start | ✅ |

The correct-answer leak was the highest-severity security issue: `buildAttemptResponse` included `correct_answer` and `explanation` in the questions returned to the student during an attempt (visible via DevTools). Removed.

## 8. Performance (Phase 8)
- **N+1**: `saveAllAnswers`/`submitAttempt` loop per-answer upserts (N queries); `autoGradeAttempt` loops per-answer updates (N+1); `calculateRank` scans all attempts+answers (O(n)); `calculateAnalytics` fetches all answers (unbounded).
- `buildAttemptResponse` = 2 queries (answers + full test).
- No Redis caching on reads (attempts timer/checkpoint only). Fine for current scale; flagged for growth.

## 9. Code Quality (Phase 9)
- No TODO/FIXME/HACK/console.log in any assessment module (backend or web). Clean.
- Dead/legacy: `admin-tests.controller` `GET /admin/tests` duplicates `GET /tests` (P3).
- Transaction usage: `submitReview` + `publishResults` use `Transaction` correctly (rollback on failure). `create`/`update` test relations are **not** transactional (partial-write risk on relation insert failure — P2).
- `maybeShuffleQuestions` was dead logic referencing a nonexistent column — simplified (P2).

## 10. Tests (Phase 10)
- **Unit tests: ZERO** for attempts/questions/tests/results/evaluation/analytics.
- **E2E tests: ZERO** for assessments (all 13 specs are recordings/playback).
- The two P0 schema-drift bugs would have been caught by any test exercising the attempt lifecycle. **Recommendation: add attempt-lifecycle unit + e2e tests (create→start→save→submit→grade→publish→result).**

## 11. Production Readiness (Phase 11)

### Score
| Dimension | Score |
|-----------|-------|
| Architecture | 6/10 (partial transactions, shuffle_options gap, legacy dup) |
| Security | 7/10 (leak fixed; timer bypass remains) |
| Performance | 6/10 (N+1s, unbounded scans) |
| UX | 7/10 (solid, minor gaps fixed) |
| Code Quality | 8/10 (clean, no TODOs) |
| Testing | **1/10** (zero assessment tests) |
| Reliability | 7/10 (core lifecycle now works) |
| Scalability | 5/10 (N+1s, no caching) |
| **Overall** | **59/100** (was ~20/100 before fixes — core lifecycle was broken) |

### Prioritized backlog
| # | Sev | Item | Effort |
|---|-----|------|--------|
| 1 | P1 | **Add unit tests** for attempt lifecycle (would have caught both P0s) | M |
| 2 | P1 | **Add e2e tests** for assessment workflows (browser) | M |
| 3 | P1 | **Server-side timer enforcement** on submit/save (prevent expired/inflated timers) | S |
| 4 | P2 | Implement `shuffle_options` | S |
| 5 | P2 | Transaction wrap `tests.create`/`update` relation inserts | S |
| 6 | P2 | Batch `saveAllAnswers`/`submitAttempt` upserts (single query) | S |
| 7 | P2 | Paginate/optimize `calculateRank` + `calculateAnalytics` | M |
| 8 | P3 | Remove legacy `GET /admin/tests` duplicate | S |
| 9 | P3 | Apply migration 033 (`updated_at` on test_attempts) on deploy for schema alignment | S |

## Files Changed (fixes)
- `apps/api/src/modules/attempts/attempts.service.ts` — removed `sort_order` insert; removed `correct_answer`/`explanation` leakage; fixed `section_title` key; simplified `maybeShuffleQuestions`; made `test_batches` embed optional
- `apps/api/src/modules/evaluation/evaluation.service.ts` — replaced `updated_at` → `last_saved_at` on `test_attempts` (5 places)
- `apps/api/src/modules/results/results.service.ts` — removed nonexistent `sort_order` read
- `apps/api/src/modules/tests/tests.service.ts` — made `test_batches` embed optional (removed `!inner`)
- `apps/web/src/app/admin/review-queue/page.tsx` — safe stringify of object answers
- `scripts/migrations/033-assessment-attempt-columns.sql` — adds `updated_at` to `test_attempts` (aligns schema with code intent; code works without it)

## Verification Evidence
| Check | Result |
|-------|--------|
| Fresh test start (no prior attempt) | 201, 1 question, no leaked answers ✅ |
| Save/submit/auto-grade/publish/result | 200/201 all ✅ (5/5, rank 1, passed) |
| Create test without batches | 201 ✅ |
| findOne + admin list of no-batch test | 200 + visible ✅ |
| Review queue browser | expands, 0 errors ✅ |
| Submit review | 200 → result published ✅ |
| 43 API tests | pass |
| 62 e2e tests | pass |

---

_End of RCCF Phase 5 report_
