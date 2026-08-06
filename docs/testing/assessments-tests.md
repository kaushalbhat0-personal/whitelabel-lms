# Assessments Module — Test Documentation

Production safety net for the Assessment ecosystem (questions, tests, attempts, evaluation, results, analytics).

## Suites

| Suite | Location | Tests | Scope |
|-------|----------|-------|-------|
| Unit (Jest) | `apps/api/src/modules/{attempts,questions,tests,results,evaluation,analytics}/*.spec.ts` | 81 | Service methods, validation, transactions, security rules |
| E2E (Playwright) | `tests/e2e/assessments/*.spec.ts` | 28 | API + DB + browser workflows |

## Run Commands

```bash
# Unit tests
pnpm --filter api test

# Assessment e2e
npx playwright test --config=tests/e2e/playwright.config.ts --project=assessments-api

# Full regression (recordings + assessments)
pnpm test:e2e
```

## Fixture

`tests/e2e/fixtures/assessments-fixture.ts` seeds per-test: 2 batches + 2 questions + 1 draft test assigned to batch A, enrolls student A (batch A) and student B (batch B), and tears everything down in FK-correct order (answers → review_queue → results → attempts → batches → tqb → sections → analytics → tests → questions → batches/courses/topics).

## Unit Test Inventory

### QuestionsService (`questions.service.spec.ts`) — 15 tests
- create (defaults, difficulty default, error)
- findAll (filters, pagination defaults)
- findOne (found, NotFound)
- update (partial, NotFound)
- archive / unarchive
- remove (success, DB error)
- bulkImport (sequential)
- getTopics (ordered)

### TestsService (`tests.service.spec.ts`) — 14 tests
- create (with relations, passing-marks default, insert error)
- findAll (pagination, defaults)
- findOne (found, NotFound)
- updateStatus (valid, invalid→Conflict)
- archive, remove
- getMyTests (no batches → empty; batch+status filter; no matching tqb → empty)

### AttemptsService (`attempts.service.spec.ts`) — 22 tests
- startAttempt (fresh create, NotFound, wrong status, not-enrolled, max attempts, resume-existing, concurrent-dup 23505, shuffle)
- getAttempt (owner, NotFound, non-owner 403)
- saveAnswer (success+checkpoint, not-in-progress, foreign question)
- saveAllAnswers
- submitAttempt (success+redis del, not-in-progress)
- getAttemptsByUser
- getAttemptTimer (redis cache, DB value, elapsed calc, non-owner 403)

### EvaluationService (`evaluation.service.spec.ts`) — 16 tests
- autoGradeAttempt (all-auto→publish, manual-review routing, negative marking, NotFound)
- evaluateAnswer matrix (multi-choice exact, numerical tolerance, true_false case)
- getReviewQueue, assignForReview (success, NotFound)
- submitReview (review→publish, NotFound)
- publishResults (success+rank+analytics, NotFound)
- calculateRank (no-others→rank1)
- calculateAnalytics (aggregates)

### ResultsService (`results.service.spec.ts`) — 12 tests
- getStudentResult (sanitized answers, NotFound, non-owner 403, hide-when-not-immediate)
- getMyResults, getTestResults (rank/marks ordering), getTestAnalytics (found, NotFound)
- getStudentAnalytics (empty, averages+topics), getOverallAnalytics

### AnalyticsService (`analytics.service.spec.ts`) — 2 tests
- getAdminOverview (aggregate 4 queries, graceful failure)

## E2E Test Inventory

| Spec | Tests | Coverage |
|------|-------|----------|
| `attempt.spec.ts` | 4 | Full lifecycle, resume-no-dup, max attempts, draft-blocked |
| `question-bank.spec.ts` | 4 | CRUD+archive+delete, bulk import, validation, student 403 |
| `security.spec.ts` | 7 | Role guards, cross-user attempt/result, batch authz, no answer leak, foreign-question save, admin-can't-student |
| `results-review.spec.ts` | 5 | Manual review→publish, results list/detail, test results+analytics, rank ordering |
| `test-management.spec.ts` | 6 | Create, duplicate, status transitions, delete, validation, batch visibility |
| `browser-ui.spec.ts` | 3 | Student attempt in browser, admin review queue, mobile overflow |

## Verified Production Bugs Caught

| Bug | Where Caught |
|-----|--------------|
| Fresh attempt start 500 (test_answers.sort_order schema drift) | e2e `attempt.spec.ts` full lifecycle |
| Grade/publish 500 (test_attempts.updated_at schema drift) | e2e `attempt.spec.ts`, `results-review.spec.ts` |
| Tests without batches invisible (test_batches!inner) | e2e `test-management.spec.ts` |
| Review queue React crash (object-as-child) | e2e `browser-ui.spec.ts` |
| correct_answer leakage in start response | e2e `security.spec.ts` + unit `attempts.service.spec.ts` |
| `calculateAnalytics` profiles.batch_id wrong join | e2e `results-review.spec.ts` (analytics) |
| `getTestAnalytics` orders by nonexistent created_at | e2e `results-review.spec.ts` (analytics) |
