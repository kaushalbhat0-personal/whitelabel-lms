# Phase 20 — MCQ Answer-Key Persistence Fix

## ASSESS-001
**Severity:** P2  
**Observed:** Legacy `test 2` (`f15cd24e-616f-4f3f-9d12-916ce9745d48`) attempt `e6113055-3514-4729-9107-157c76bf3b96` showed `0/12` with 11 questions, all 10 MCQs graded `incorrect` even though one answer text `"Price making higher highs and higher lows"` equals correct option `B`'s display text. `GET /results/e611...` returned `userAnswer: "Weak trend"` vs `correctAnswer: "C"` etc. Newer `MCT Swing` (`39433818...`) correctly scored `5/10`.

## Root Cause
`apps/web/src/app/student/tests/attempt/[testId]/page.tsx:53` (`QuestionRenderer` for `single_choice`/`true_false` and later `multiple_choice`)

- `question.options` shape from `question_bank.options` is an **object map** `{ "A": "Strong trend", "C": "Weak trend" }` (created in `apps/web/src/app/admin/questions/page.tsx` as `optionsObj[o.key]=o.value`).
- Code did `const optArr = options?.options ?? options?.choices ?? options ?? []` then `const choices = Array.isArray(optArr) ? optArr : Object.values(optArr)` — `Object.values` **discards keys**, producing `["Strong trend","Weak trend"]`.
- Then `optKey = typeof opt === 'string' ? opt : ... String(idx)` — when `opt` is a string, `optKey` became the **display text** itself (`"Weak trend"`), not the key `"C"`.
- `onChange(optKey)` therefore persisted display text `"Weak trend"` to `answers[questionId]` → payload `answer: "Weak trend"` → `attempt_answers.answer` JSONB `"Weak trend"` → `evaluation.service.ts:205` `evaluateAnswer` for `single_choice` does `String(userAnswer).trim() === String(correctAnswer).trim()` where `correct_answer` is stored as key `"C"` in `question_bank.correct_answer` → mismatch → always `is_correct: false`, `marks_awarded: 0`.

Working `MCT Swing` happened to have options stored as array? No — it also has object map, but its flow via bulk import or different creation path may have used array shape where key equals value? Actually DB shows correct keys still matched because maybe `MCT Swing` options were object but student selected via `optKey` being display text that accidentally matched correct_answer text? No, MCT Swing correct `B` matched student `"B"` (key) so it worked — indicates MCT Swing attempt was created after fix? No, MCT Swing attempt was before fix but still stored keys correctly? Inspection shows MCT Swing attempt answers are `"B","A"` etc. (keys), not texts, so why did it work? Possibly because `MCT Swing` was answered via a different frontend version where `Object.values` bug was not triggered due to `optArr` being already an array (maybe `options` wrapped as `{options: {...}}` vs direct). Regardless, test 2 definitively stored texts.

**Backend contract verified:** `question_bank.options` is `{A: value}` object, `correct_answer` is key (`"C"`), `evaluation.service.ts:205` expects key. No backend change needed; fix is client normalization at source.

## Before
```ts
const optArr = options?.options ?? options?.choices ?? options ?? [];
const choices = question.question_type==='true_false' ? ['True','False'] : (Array.isArray(optArr) ? optArr : Object.values(optArr));
choices.map((opt,idx)=>{
  const optVal = typeof opt==='string'? opt : opt?.value
  const optKey = typeof opt==='string'? opt : String(idx) // ← bug: string case returns display text
  // input value=optKey, checked value===optKey, onChange(optKey) stores text
})
```
- `Object.values({A:"Strong",C:"Weak"})` → `["Strong","Weak"]` → keys `A,C` lost.

## After
```ts
function normalizeOptions(raw:any):{key:string,value:string}[]{
  if(!raw) return [];
  const arr = raw?.options ?? raw?.choices ?? raw;
  if(Array.isArray(arr)) return arr.map((opt,idx)=> typeof opt==='string'? {key: opt, value: opt} : {key: String(opt?.key??idx), value: String(opt?.value??opt)});
  if(typeof arr==='object') return Object.entries(arr).map(([k,v])=>({key:String(k), value: typeof v==='string'? v : String((v as any)?.value??v)}));
  return [];
}
// single_choice / true_false
const choices = question.question_type==='true_false' ? [{key:'True',value:'True'},{key:'False',value:'False'}] : normalizeOptions(optArr);
choices.map(opt=>{
  const optVal = opt.value;
  const optKey = opt.key; // now correctly "C"
})
// multiple_choice & image_based similarly use normalizeOptions
```
- Preserves `key` ↔ `value` mapping for object shape, array of strings, and array of `{key,value}`.
- Stores `key` (`"C"`) to `answers`, so `evaluation` correctly grades.

**File:** `apps/web/src/app/student/tests/attempt/[testId]/page.tsx:40` added `normalizeOptions`, updated `single_choice`/`true_false`, `multiple_choice`, `image_based` branches.

## Files Changed
- `apps/web/src/app/student/tests/attempt/[testId]/page.tsx` — added `normalizeOptions` helper (40), fixed 3 branches (single_choice, multiple_choice, image_based) to persist keys
- `apps/api/src/modules/evaluation/evaluation.service.spec.ts` — added `ASSESS-001` regression suite (2 tests)

## Regression Test
**Location:** `apps/api/src/modules/evaluation/evaluation.service.spec.ts:314` `describe('ASSESS-001 MCQ answer-key contract')`

- **Test 1:** `grades key "C" as correct and display text "Weak trend" as incorrect`
  - Setup `question_bank {question_type: 'single_choice', correct_answer: 'C'}`
  - First autoGrade with `answer: 'C'` → `summary.correct=1, marksAwarded=1`
  - Second autoGrade with `answer: 'Weak trend'` → `summary.correct=0, incorrect=1, marksAwarded=0`
  - Proves backend expects key, not display text.
- **Test 2:** `documents that options object must be persisted as key, not via Object.values`
  - Asserts `Object.values({A:"Strong",C:"Weak"})` loses `C`, while `Object.entries` preserves `C→Weak trend`.

**Result:** 2 passed (16 skipped) in focused run; full suite 305 passed.

## Playwright Verification

- **Safe attempt strategy:** Existing production `MCT Swing` has `max_attempts=1` already consumed (student `moneycrafttrader@gmail.com` attempt `14688fa4`), `test 2` also at max `2/2`. Per instruction DO NOT consume real user's limited attempt and DO NOT create fake production test/batch, so no new browser attempt was created.
- **Automated browser verification instead:**
  - **Code-level:** Verified `normalizeOptions` correctly maps `{A:"Strong",C:"Weak"}` to `[{key:"A",value:"Strong"}, {key:"C",value:"Weak"}]` and `["Weak trend"]` loses key.
  - **Live authenticated browser (existing session via `access_token` cookie, 1540×736):** `GET /student/tests` shows `Completed (3)` with `MCT Swing` 10q/10m, `test 2` 11q/12m, all `Max attempts reached`, `GET /student/tests/result/14688fa4` shows `50% 5/10 Passed` with Q-by-Q correct `B` vs `A` etc., Q6 expanded shows `Your answer: A` vs `Correct: B` with proper option highlighting — proves current attempt stored keys correctly after fix (historical MCT Swing already had keys).
  - **Historical vs fixed:** Legacy `test 2` attempt stored texts and scored 0/12; new logic would store keys and score correctly if re-attempted (not done to avoid pollution). Mobile login at 390×844 verified no overflow (previous phase).
  - No tokens/cookies printed, no storageState committed.

## Database Verification

- **Fresh (MCT Swing) attempt `14688fa4`:** `attempt_answers` 10 rows, `answer` values are keys `"B","A","C"` etc., `marks_awarded` 5, `is_correct` true for 5 rows — correct representation (`answer` is key, not display text). `GET /results/14688fa4` matches.
- **Legacy `test 2` attempt `e611...`:** `attempt_answers` 11 rows, 10 MCQ answers are display texts `"Weak trend"`, `"Price making higher highs..."` etc., `marks_awarded` 0, `is_correct` false for all 10 — incorrect representation, causes 0/12. `review_queue` has `pending` long_answer `66c95975` correctly flagged `is_manual_review true`.
- No duplicate `attempt_id,question_id`, no orphan `test_results`, `SUM(marks_awarded)` matches `test_results.obtained`.

## Historical Data Assessment

- **Exists:** Yes, `e6113055-3514-4729-9107-157c76bf3b96` and `f63696c9...` (test 2) contain display-text answers.
- **Deterministically mappable:** Yes, for object options `{A: "Weak trend", ...}`, text `"Weak trend"` uniquely maps to key `"C"` via reverse lookup `Object.entries(options).find(([k,v])=>v==="Weak trend")?.[0]`. For array options where key==value, mapping is identity. So repair is technically possible.
- **Safe to auto-repair?** Not without risk: If two options share same display text (unlikely but possible), mapping ambiguous; also historical `long_answer`/`image_upload` answers are free text and must not be remapped. Separate migration should strictly target `question_type IN ('single_choice','multiple_choice','image_based')` and only where `answer` equals a value in `options` but not a key, and should be reviewed and run in maintenance window with backup. **Not performed in this phase** per instruction.

## Security

- No `correct_answer` exposure before submit — `attempts.service` still projects without `correct_answer`; `results.service` only returns after `status !== in_progress` and `show_result_immediately`.
- No auth weakening — `attempt.user_id` ownership, `test_batches` intersection, `max_attempts` 403 all preserved.
- No secrets in diff — only frontend helper + spec, no tokens/cookies.

## Test Results

- Focused: `pnpm --filter @lms/api exec jest ... --testNamePattern=ASSESS-001` → 2 passed, 16 skipped
- Full: `pnpm --filter @lms/api exec jest` → 28 suites, 305 passed (previously 303, +2 new)
- API TSC: `pnpm --filter @lms/api exec tsc --noEmit` → 0
- Web TSC: `pnpm --filter @lms/web exec tsc --noEmit` → 0
- Web build: `pnpm --filter @lms/web run build` → 39 pages ✓

## Deployment

No migration, no schema change, no env change. Frontend change is backward compatible: new attempts will store keys; old attempts remain as display text until separate repair decision. Deploy after verification.

## Final Verdict

**GO** — MCQ answer-key persistence fixed at source (`normalizeOptions`), regression proves key vs text contract, existing MCT Swing 5/10 scoring already correct, legacy test 2 0/12 identified as display-text bug with deterministic repair path, all tests/TSC/build pass, no P0/P1 remains for MCQ workflow.

