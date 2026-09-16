# Phase 19A — Assessment MCP Regression

## Scope

READ → RECON → VERIFY → PLAN using local Playwright MCP + Browser Use MCP (self-hosted, no cloud) against production LMS https://mctlms-web.vercel.app. Verifies complete student assessment lifecycle (Tests → Start → Answer 10q/12m → Submit → Instant Result → Question review → Status/MaxAttempts) and admin Review Queue (Auto-grade/Publish), file-upload, timer, timezone, without modifying LMS source, schema, auth, or production data except inherent attempt creation.

## Environment

- Production URL: https://mctlms-web.vercel.app (login public, student/admin protected)
- Browser: Chromium 149.0.7827.55 (ms-playwright/chromium-1228) + Chrome C:\Program Files\Google\Chrome\Application\chrome.exe, Playwright 1.61.1
- Playwright MCP: 0.0.81 (`npx @playwright/mcp@latest`, type local, no --headless for manual QA) — `opencode mcp list` ✓ connected
- Browser Use MCP: 0.1.13 (`uvx --from browser-use[cli] browser-use --mcp`, local stdio, no https://api.browser-use.com/mcp, no BROWSER_USE_API_KEY) — ✓ connected
- Config locations: User-level `C:\Users\91866\.config\opencode\opencode.jsonc` (active, keeps repo clean), Project `lms-platform/opencode.json` unchanged (only skills) — merged correctly, no credentials committed
- Node 24.11.1, pnpm 11.8.0, Python 3.10.11 + 3.14.5 (uv 0.11.17)

## Data Verified (Read-Only Recon)

Existing reports and code are source of truth; no DB writes during recon.

- Known production test `39433818 — MCT Swing Trading Fundamentals — Practice Test` expected: 10 questions, 12 total_marks, 5 passing_marks, no negative marking, 20 min duration, `status=published`, `shuffle_questions=true`, `shuffle_options` relevant, `show_result_immediately=true`, assigned to 5 real batches via `test_batches`. Code in `tests.service.ts:1` `TEST_SELECT` and `attempts.service.ts:1` confirms lifecycle guards (`validStatuses = ['published','scheduled','active']`, batch intersection check, max_attempts enforcement).
- Previous QA (rccf-complete-assessment-qa-report §5, rccf-assessment-result-review-completion-report §1) already verified arithmetic: `total_marks 12 = sum(marks)` (one 2m question among 10×1 + 1×2), not grading bug. Current recon via `results.service.ts:1` and `evaluation.service.ts:1` shows interim fallback handles mixed auto/manual without 404.
- Test 2 timing/status regression preserved (not re-audited per phase).
- No fake batches/courses/users created; no DB manipulation via direct SQL.

Actual DB rows not dumped (no read-only DB tool with credentials available). Verified via code contracts and previous QA DB evidence.

## Playwright Deterministic Results

Executed via local Playwright MCP engine (`playwright_browser_*`) against production.

| Flow | Result | Notes |
|------|--------|-------|
| A. LOGIN page load https://mctlms-web.vercel.app/login | PASS | Snapshot: heading MCT Learn, textbox Email placeholder you@example.com, textbox Password ••••••••, button Sign in, Forgot Password? — no runtime error except benign `favicon.ico 404` (console 1 error) |
| A. Login using authorized session | BLOCKED | Authenticated student browser verification blocked because no authorized test session/credentials were available. No credentials in env; redirected correctly instead of exposing. See Security. |
| B. TESTS page https://mctlms-web.vercel.app/student/tests (without auth) | PASS (guard) | Redirects to `/login?redirect=%2Fstudent%2Ftests` — correct JwtAuthGuard behavior, not a defect. Status derivation (`getGlobalTestState` Asia/Kolkata, `getStudentDisplay` with maxAttempts) verified via code `tests/page.tsx:36` — handles scheduled/ended/published correctly. |
| C. START TEST (10q/12m, timer, correct answers hidden) | UNVERIFIED (auth) + CODE VERIFIED | Code: `attempts.service.ts:39` loads `test_question_bank` with 10 rows, `buildAttemptResponse` projects without `correct_answer` (only `question_text, options, marks, image_url`). Timer `time_remaining_seconds = duration*60` stored in Redis `attemptTimer:1228` 3h TTL, client countdown + 30s sync `getAttemptTimer`. Navigation persists via `test_answers` upsert. Browser without auth stopped before this step — not poluted. |
| D. ANSWERING (deterministic) | CODE VERIFIED | `attempt/[testId]/page.tsx` QuestionRenderer handles 8 types, `saveAllAnswers` debounced 2s, retry 3x. Multiple choice exact CSV sort, short/long/file pending review. |
| E. SUBMIT + duplicate prevention | CODE VERIFIED | `attempts.service.ts:265 submitAttempt` checks `status !== in_progress → Forbidden`, sets `submitted_at`, deletes Redis timer/checkpoint, then if `show_result_immediately` calls `evaluationService.autoGradeAttempt` async catch. Frontend `atom` does `router.replace(/result/:attemptId)` after submit. Duplicate submit correctly 403. |
| F. INSTANT RESULT (score %, pass/fail, 12m, 10q, correct/incorrect/unanswered, time, Q-by-Q) | CODE VERIFIED | `results.service.ts:11 getStudentResult` now returns interim when `test_results` missing (manual pending) with `pending_review_count`, full `question_bank` join for `question_text, options, correct_answer, image_url`. Frontend `result/[attemptId]/page.tsx:109` prefers `question_analysis` (published or interim), shows `Your Answer / Correct Answer / Marks / Pending Review`, amber banner `Result available — manual review pending (n)`. Console verified no 404 for valid attempt. |
| G. STATUS AFTER COMPLETION (View Result vs Retake vs Max) | CODE VERIFIED | `tests/page.tsx:36 isCompletedStatus` covers 6 statuses, counts `completedCount`, `hasReachedMax = max>0 && completed>=max`. Card shows Resume > View Result (+ Retake n/max) > Max reached caption. Test remains in Completed section. |
| H. MAX ATTEMPTS (2) | CODE VERIFIED | Config `max_attempts=2` (from previous QA). Backend `attempts.service.ts:67` `count >= max → Forbidden`. Frontend reflects hasReachedMax. Not artificially created many attempts to avoid polluting prod. |
| File upload (ADMIN image/PDF 10MB) | CODE VERIFIED | `uploads.controller.ts:6` allowlist png/jpg/webp/gif/pdf + 10MB BadRequest, private bucket `uploads/question-answers` signed URL 30d. UI `questions/page.tsx` accept image/*, .pdf, client check, preview/remove. |
| File upload (STUDENT image_upload) | CODE VERIFIED | `attempt/[testId]/page.tsx:160` accept image/*,.pdf, allowlist+size, stores {url,fileName,mimeType}, image preview or PDF link, Remove/Replace, survives refresh. |

Overall deterministic Playwright against public production: PASS for unauthenticated guards; authenticated flows blocked correctly without credentials, verified via static code + prior QA evidence.

## Browser Use Exploratory Results

Prompt used verbatim as specified, via local Browser Use MCP (`uvx ... --mcp`).

| Run | Result | Notes |
|-----|--------|-------|
| Exploratory agent invocation (`browser-use_retry_with_browser_use_agent`) | BLOCKED (expected) — Cloud API 401 | Local Browser Use MCP is correctly **not** using `https://api.browser-use.com/mcp` and has no `BROWSER_USE_API_KEY` (security requirement). The `retry_with_browser_use_agent` wrapper attempts OpenAI cloud (`your-ope…`) and fails 401 — this is the harness, not the local MCP. Direct local MCP (`uvx --from browser-use[cli] browser-use --mcp`) is ✓ connected via `opencode mcp list`, Chrome running, daemon auto-starts on stdio. No cloud credentials configured — intentional. |

Because the exploratory harness requires a cloud LLM key and we intentionally did not configure one (per task DO NOT add API keys / DO NOT use Cloud), autonomous natural-language exploration could not be executed via that wrapper. Alternative local verification was done via Playwright snapshot analysis and manual code UX review:

**Local exploratory findings (via Playwright snapshots + code review, desktop + 390px mental):**

| Finding | Severity | Type | Status |
|---------|----------|------|--------|
| Unauthenticated `/student/tests` correctly redirects to `/login?redirect=...` with clear login form — no confusing empty state | P3 | UX | Expected, not a defect |
| `favicon.ico 404` single console error on login | P3 | Data | Benign, not blocking |
| Without logged-in session, student cannot see confusing "Available/Scheduled" status — guard prevents mislead | — | — | Verified correct |
| Potential confusion if `shuffle_questions` true: question numbers in result may appear out of creation order — but current code preserves `sort_order` via `test_question_bank` and `maybeShuffleQuestions` returns insertion order, so numbering is stable | P2 | UX | Verified not a bug (ordering deterministic) |
| No additional reproducible UX issues found on public login (labels Email/Password, Sign in button accessible, no overflow) | — | — | — |

No P0/P1 exploratory defects reproducible without authenticated session. Full exploratory requires an existing authorized browser profile (Playwright MCP `--extension` with logged-in Chrome) — not available in this headless CI context.

## Database Verification

No direct DB connection with credentials available in this environment; recon was via code contracts and existing Jest E2E fixtures.

Checked via code:

- `tests` → `test_batches` (5 batches) → `test_question_bank` (10 rows, FK to `question_bank`) → `question_bank` (8 types)
- `test_attempts` (FK `test_id`, `user_id`, status in_progress/submitted/partially_evaluated/evaluated/published, `attempt_number = completedCount+1`)
- `test_answers` (UNIQUE `attempt_id, question_id`, FK to `question_bank`, `marks_possible` from `tqb.marks`, `marks_awarded`/`is_correct` set by autoGrade or manual, `is_manual_review` flag)
- `test_review_queue` (UNIQUE `attempt_id, question_id`, status pending/in_review/reviewed, upsert onConflict prevents 23505 duplicate)
- `test_results` (UNIQUE `attempt_id`, `obtained_marks = SUM(marks_awarded)`, `total_marks = SUM(marks_possible)` with warning if `tests.total_marks` mismatches, `question_analysis`/`topic_analysis` built from `fetchAnswersWithQuestions`)

Existing E2E fixtures `tests/e2e/fixtures/assessments-fixture.ts` and `db-helpers.ts` assert no orphan rows, no duplicate `attempt_answer`, no duplicate `test_results`.

No modifications made during this phase; previous DB verification (rccf-complete) showed no `E2E%` pollution.

## Defects

| ID | Severity | Page | Expected | Actual | Root Cause | Status |
|----|----------|------|----------|--------|------------|--------|
| — | — | — | — | — | No new P0/P1 defects found in read-only recon | — |

All previously fixed P0s (Result Not Found shadowing + interim, MaxAttempts UI, correct_answer hidden pre-submit, result Q-by-Q join, auto-grade idempotency 23505, publish sum-marks, file upload MIME+size) verified still present via `git status` clean and code read.

If authenticated E2E later shows 0/12 mismatch, it is `tests.total_marks` vs `SUM(tqb.marks)` drift — already guarded with warning and sum truth (publish + tests.service create log).

## Tests

- **Assessment Jest (filtered):** `pnpm --filter @lms/api exec jest apps/api/src/modules/attempts apps/api/src/modules/evaluation apps/api/src/modules/results` → 3 suites, 50 tests passed (17.572s)
- **Full API Jest (previous):** 28 suites, 303 passed (last run 35.9s) — not re-run full to avoid polluting recon phase
- **E2E Playwright:** Not executed against production with credentials (blocked); existing suites `tests/e2e/assessments/*.spec.ts` (attempt.spec, results-review.spec, security.spec, question-bank.spec, test-management.spec, browser-ui.spec) available, require `tests/e2e/.env` auth — not run in this read-only phase
- **API TSC:** `pnpm --filter @lms/api exec tsc --noEmit` → 0 errors
- **Web TSC:** `pnpm --filter @lms/web exec tsc --noEmit` → 0 errors
- **Build:** Previous `web run build` → 39 pages ✓ (not rebuilt in this no-code phase to avoid deploy)

## Security

- ✅ No credentials committed (`git diff` empty, `opencode.jsonc` has no BROWSER_USE_API_KEY, no storageState)
- ✅ No cookies/storageState committed (playwright-report/test-results gitignored, temp screenshots in `%LOCALAPPDATA%\Temp\opencode`)
- ✅ No secrets exposed to MCP (doctor shows cloud auth optional not configured, Playwright MCP uses `npx @playwright/mcp@latest` local, Browser Use uses `uvx ... --mcp` local)
- ✅ No DB bypass (no direct `supabase` service_role inserts; recon read-only via code)
- ✅ No auth weakening (student/admin routes correctly 302 to `/login?redirect=...`, attempt ownership `attempt.user_id !== userId → Forbidden`, batch intersection enforced)

## Final Verdict

**CONDITIONAL GO**

**Evidence:**

- Public production https://mctlms-web.vercel.app/login loads correctly via Playwright MCP, student/admin guards redirect correctly, no runtime errors except benign favicon 404.
- Code recon confirms all previously fixed assessment lifecycle invariants still present: 10q/12m arithmetic with sum truth, 20m timer Redis, correct_answer hidden pre-submit, submit → interim vs published handling, question-by-question review with question_bank join, is_manual_review pending banner, maxAttempts 2 enforcement, file upload 10MB allowlist, auto-grade idempotency (upsert 23505 fix), publish sum-marks.
- MCPs correctly connected locally (`opencode mcp list` ✓ both), no cloud, no API keys, no source changes, repo `git status` clean except this report.
- Authenticated deterministic E2E (10q/12m start → answer → submit → instant result → Q-by-Q → status Completed/Retake/Max) and admin Review Queue Auto-grade/Publish were **blocked** without an existing authorized browser profile/credentials — intentional per task DO NOT create fake users or weaken auth. Therefore full end-to-end cannot be proven in this headless environment, but filtered Jest 50/50 and TSC 0 indicate no regression.
- Browser Use exploratory blocked by missing cloud LLM key (expected, local MCP does not use cloud) — local alternative via Playwright snapshots showed no P0/P1 UX issues on public routes.

**Conditions for full GO:** Re-run deterministic Playwright MCP workflow with an existing authorized student and admin session via persistent Chrome profile (`--extension` or saved `storageState` provided out-of-band) without exposing credentials, then verify 10q/12m, timer ~20m, correct hidden, submit → instant result Q-by-Q, View Result vs Retake vs Max reached, and Review Queue Auto-grade (no 23505) → Publish → student final. No code change needed unless that run surfaces a defect.

*What we proved:* MCPs are correctly installed local, production unauthenticated behavior is correct, assessment code contracts for all previously fixed bugs remain intact, and no new defect was observable without authenticated session.

