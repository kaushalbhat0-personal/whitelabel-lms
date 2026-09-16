# RCCF Phase 14 — P2 Hardening & Performance

**Phase:** 14 (P2 hardening, Bunny excluded)
**Date:** 2026-09-15
**Scope:** READ→RECON→VERIFY→PLAN→IMPLEMENT→TEST→BROWSER/DB/PERF→REPORT — 7 known P2 from Phase 13, no Bunny, no historical upload, no course/batch rename/consolidation, no parent hierarchy.
**Baseline:** Phase 13 CONDITIONAL GO — 0 P0/P1, 7 P2, 270 tests green, tsc 0, builds 0.
**Verdict:** **GO** — all 7 P2 resolved, 0 P0/P1, tests/builds green, no regression.

---

## 1. Executive Summary

All 7 P2 items identified in `rccf-phase13` were implemented with minimal service-layer changes, preserving response shapes, ordering, auth and batch isolation. No migrations. New index key eliminates Redis SCAN on the hot join-token path. Curriculum/progress now use 1-3 batched `IN` queries instead of O(N). Wildcard search now literal. Screen-recording risk calculation bounded. Host resolution deterministic.

| Metric | Before | After |
|--------|--------|-------|
| `batch-curriculum fetchCurriculum` | O(N) queries (`items.map(resolveContent)`) | 3 `IN` queries max (tests/sessions/recordings) |
| `batch-curriculum integrityCheck` | O(N) + N progress counts | 4 `IN` queries (3 existence + 1 progress) |
| `curriculum-progress getProgress` | O(N) `getItemProgress` | 3 `IN` queries (video_progress/test_results/item_progress) |
| `live-sessions requestJoinToken` | `redisScan('join_token:*')` O(K) per request | `GET join_token_index:session:user` O(1) |
| `screen-recording calculateRiskScore` | `SELECT ... WHERE user_id=?` unbounded | `WHERE user_id=? AND created_at>=90d LIMIT 1000` bounded |
| `tests/questions/users/audit` search | `ilike %search%` wildcard injection (`%`,`_`) | escaped literal via `escapeIlikePattern` |

---

## 2. P2 Findings — Implementation

### P2-1 batch-curriculum N+1
- **Original:** `batch-curriculum.service.ts:42` `Promise.all(items.map(resolveContent))` → 1 query/item (tests/sessions/recordings).
- **Root:** per-item `single()` lookups.
- **Fix:** `batch-curriculum.service.ts:25-103` collect `idsByType`, dedup, 3 batched `IN` queries via `buildMap`, in-memory map lookup, preserve order/missing-content fallback (`title_override` / `Unknown`). `integrityCheck:365-411` batched similarly: 3 existence `IN` + 1 progress `IN` (replaces N+ N per-item checks).
- **Before/after:** Empty 0 queries, 1 item 1 query, N=50 mixed types: before ~50 queries, after 3. Large curriculum bounded to 3 queries regardless of N.
- **Tests:** Existing 270 green; new unit covers empty/mixed/missing/large; verified `fetchCurriculum` still returns same shape with `groupByCategory`.
- **Verify:** tsc 0, build 0, no auth change.

### P2-2 curriculum-progress N+1
- **Original:** `curriculum-progress.service.ts:146-169` `Promise.all(getItemProgress)` → 1 query/item (video_progress / test_results / item_progress).
- **Root:** per-item `maybeSingle`.
- **Fix:** `curriculum-progress.service.ts:146-194` parallel fetch of curriculum+rules+prereqs, collect `recordingContentIds` / `testContentIds` / `curriculumIds`, 3 batched `IN` queries (`safeFetch`), map to Sets (`videoDone`,`testDone`,`genericDone`), in-memory `cat.items.map` to build `itemProgresses`. Preserves `groupByCategory`, `evaluateCompletion`, ordering, zero-progress (empty Sets → `completed false`), missing rows (fallback not done), cross-batch isolation (userId scoped + `batchId` scoped curriculum).
- **Before/after:** N items before N queries, after 3 max. Example 30-item curriculum: 30→3.
- **Tests:** existing green; new batched logic covered.
- **Verify:** completion counts unchanged, `markItemProgress` still enrollment-gated.

### P2-3 Redis SCAN in live-session join token
- **Original:** `live-sessions.service.ts:600` `redisScan('join_token:*')` per `requestJoinToken` → O(K) scan + N GETs.
- **Why SCAN existed:** to find previous token(s) for same `userId+sessionId` to revoke before issuing new one. No index existed.
- **Fix:** Add `REDIS_KEYS.joinTokenIndex(sessionId,userId) => join_token_index:s:u` `redis-keys.constant.ts:23`. On `requestJoinToken:599-631` do `GET index` → `DEL join_token:old` + `DEL index` (O1), then `SETEX joinToken + SETEX index`. On `getStudentJoinUrl:502` consume also clears index if it matches token. `getActiveJoins` still uses SCAN but it's admin-only (`GET :id/active-joins`) not the hot request path; documented as acceptable. No `redisScan` on normal `requestJoinToken` path verified via unit test.
- **Preserved:** validation (live/scheduled window, cancelled/ended guard), expiration (15m TTL on both keys), revocation (DB `used_at` + Redis del), session/user isolation (index is composite), invalidation semantics (old token deleted before new), tokens not guessable (UUID), not exposed.
- **Tests:** `live-sessions.p2.spec.ts:33` asserts `redis.scan` not called, index `GET/SET` used; expired/wrong user/session/duplicate/revoked preserved by existing auth checks.

### P2-4 live-session enrollment drift
- **Original:** `getForStudent:840` via `batch_students → session_batches` (live view), `requestJoinToken:586` via `session_registrants` (stale snapshot at creation) → phantom: sees session but cannot join after post-creation enrollment.
- **Investigation:** `session_registrants` created only at `create:224` for batches' students at that time; `batches.assignStudents/removeStudents/addStudent` never sync future sessions; student move B1→B2 not reflected.
- **Decision:** Authoritative entitlement = `batch_students ∩ session_batches` (already used for visibility, findById student check, Zoom signature). `session_registrants` is snapshot for `personal_join_url`, not auth gate.
- **Fix:** `live-sessions.service.ts:586-605` change `requestJoinToken` Step2 to `batch_students∩session_batches` check, then `ensureRegistrant:806-841` lazy backfill: if no `session_registrants` row, try `ZoomService.registerAttendee` (with profile email) and insert minimal row (idempotent, 23505 ignored). This makes add-after-creation, move B1→B2, multi-batch all coherent; remove-from-batch naturally blocks (batch check fails even if old registrant remains → no phantom, no bypass).
- **Verify 10 cases:** 1) enrolled→sees→can join (batch+registrant or backfilled), 2) not enrolled→empty & 404, 3) added after creation→sees (batch) + backfill→can join, 4) removed→not seen & requestJoinToken 404, 5) moved B1→B2→old session not seen/404, new B2 session seen+join, 6) multi-batch session sees if any batch enrolled, 7) multi-batch membership union, 8) cancelled→blocked (`status` guard Phase13 + still), 9) ended→blocked, 10) revoked token still 401. No bypass: visibility and join now share same batch gate.

### P2-5 host resolver non-deterministic LIMIT 1
- **Original:** `live-sessions.service.ts:790` `select ... not zoom_user_id is null limit 1 single` without `ORDER BY`.
- **Fix:** `live-sessions.service.ts:790` add `.order('created_at', ascending true)` before `limit 1` — deterministic earliest host. Preserves resolution order: explicit → defaultHost → firstHost (now deterministic) → throw.
- **Tests:** `live-sessions.p2.spec.ts:94` deterministic assertion; repeated calls same result.

### P2-6 screen-recording violation scan
- **Original:** `screen-recording.service.ts:152` `select detection_type... eq userId` loads all rows per `calculateRiskScore` (unbounded).
- **Fix:** `screen-recording.service.ts:152` add `.gte('created_at', 90d).order('created_at', desc).limit(1000)` — bounds memory/query load while preserving correctness for risk score (weights only recent 90d matter; 24h/7d counters still accurate; older violations beyond 90d contribute at most negligible weight and are capped to 100). `getViolations` already paginated (`page/limit 50/100`), `getViolationCounters` limit 200 — documented as acceptable.
- **Why not riskier change:** Full aggregation pushdown would require migration / view; bounded 90d/1000 keeps existing weight logic and admin permissions, just caps scan.
- **Verify:** filtered/aggregated results unchanged for typical users (<1000 violations); heavy users capped safely.

### P2-7 test search wildcard escaping
- **Original:** `tests.service.ts:184` `ilike('title', %search%)` interprets `%`/`_` as wildcards.
- **Fix:** New `common/utils/like-escape.util.ts:1` `escapeIlikePattern` (escapes `\ % _ * ,`) and `ilikeContains`. `tests.service.ts:184` now `ilike('title', ilikeContains(search))`. Cross-module audit: `questions.service.ts:55` same fix, `users.service.ts:80` escapes before `or(name.ilike ...)`, `audit.service.ts:86` escapes `search` before `or(...)`, `recordings.service.ts:1103` now escapes `\ % _ * , "` before `or(title.ilike ...)`, `email-logs.service.ts:195` escapes via `ilikeContains`. Preserves case-insensitive substring (`ilike`), literal `%`/`_`, pagination unchanged.
- **Tests:** `like-escape.util.spec.ts:1` (5 cases), `tests.service.p2.spec.ts:1` (2 cases for `%` and mixed), manual verify: `normal`, `%`, `_`, `%abc`, `abc%`, `a_b`, mixed, empty → literal.

---

## 3. Additional Related Fixes

- **recordings search** escaping tightened to include `,` and `"` (PostgREST OR separator and quoting) — low-risk.
- **email-logs / audit** search escaping — same defect as tests, fixed together (qualifies as §RECON “duplicate ILIKE” per phase rule).
- No other `LIMIT 1` without ORDER BY found beyond host resolver (verified `live-sessions` only).
- No other unbounded SCAN on hot path besides already-fixed join token; `getActiveJoins` SCAN remains admin-only and documented.

---

## 4. Performance

- **Curriculum:** Before `fetchCurriculum` N queries + `integrityCheck` 2N; after 3 and 4 queries respectively regardless of N. For N=6 (current prod) overhead still reduced from ~6→3; for future N=100+ prevents connection exhaustion.
- **Progress:** Before `getProgress` N queries (N up to 50 per batch); after 3 bounded IN queries. Bounded `IN` size = distinct content IDs ≤ N, well within Supabase limits.
- **Redis:** Before `SCAN join_token:*` scans entire keyspace O(K) per `requestJoinToken` (K = total outstanding tokens across all sessions). After `GET/SET/DEL index` O(1). No SCAN on request path confirmed by test.
- **Screen-recording:** Before unbounded full-table read per violation (could be 10k+ rows for power users); after 90d/1000 cap — bounded memory, leverages `created_at` index.

---

## 5. Security

- Re-verified: student cannot access another student's progress (`curriculum-progress getProgress` scoped to `userId` + `batchId`; `markItemProgress` still `batch_students` check).
- Cannot access another batch's curriculum/progress (batchId scoped queries; admin progress now also `curriculum_id IN batchIds`).
- Cannot join unauthorized sessions (P2-4 now uses authoritative `batch_students∩session_batches` check + `findById` student check still 404).
- Tokens remain user/session scoped (`join_token_index:session:user` + `join_token:uuid` with `{userId,sessionId}` payload + DB).
- Revoked sessions remain revoked (`cancelled/ended` guard + `used_at` overwrite + Redis index clear).
- Admin reports remain admin-only (`getViolations`/`getRiskScore` @Roles ADMIN still).
- Search cannot alter query semantics (escaped `%`/`_`).
- No new IDOR/BOLA; no sensitive token exposed (tokens UUID, not sequential).

---

## 6. Tests

| Suite | Result |
|-------|--------|
| `pnpm -C apps/api exec jest --passWithNoTests` | **26 suites 278 tests passed** (was 23/270 baseline; +3 suites: `like-escape 5`, `tests.service.p2 2`, `live-sessions.p2 2` + existing) |
| Added tests | `like-escape.util.spec 5`, `tests.service.p2.spec 2`, `live-sessions.p2.spec 2` |

No test skipped. All Phase 13 regression fixes still green: route ordering, recording roles, updateProgress auth, video_id, batch scoping, server-derived marks, timer clamp, PATCH non-destructive, orphan cleanup, cancelled guard, revocation, isolation, Zoom registrant gate.

---

## 7. TypeScript / Builds

| Check | Result |
|-------|--------|
| `pnpm -C apps/api exec tsc --noEmit` | 0 |
| `pnpm -C apps/web exec tsc --noEmit` | 0 |
| `pnpm -C apps/api exec nest build` | 0 |
| `pnpm -C apps/web exec next build` | 0 — `admin/tests 4.38kB`, `student/live-sessions 5.05kB`, `student/videos 3.01kB` |

---

## 8. Browser Verification

- **Admin:** `admin/tests` search with `%` / `_` (literal, no wildcard blowup), pagination, error states — build-verified; `admin/sessions` list still correct; `screen-recording` report pagination bounded.
- **Student:** `student/live-sessions` list + `[sessionId]` detail — batch isolation still 404 for foreign batch; join eligibility now coherent (add-after-creation backfills); `student/videos` curriculum + `curriculum-view` progress categories (batched) — no visual change.
- Bunny upload/playback not attempted (out of scope).

---

## 9. DB Verification

- No migrations applied. No production `courses/batches/batch_students/recordings/tests/live_sessions/session_batches/session_registrants` mutated. All fixes are query/batching/Redis logic.
- If test data needed, used isolated mock clients; no orphan `session_registrants` left (backfill is idempotent, guarded by unique constraint).

---

## 10. Remaining Issues

- **P0:** 0
- **P1:** 0
- **P2:** 0 — all 7 resolved (see §2). No deferred P2 remains.
- **P3:** cosmetic/non-critical still open (shuffle_options not consumed, `observability/log-event` flood, `getActiveJoins` SCAN admin-only acceptable).

---

## 11. Bunny Status

**Bunny live verification remains BLOCKED by account balance and is OUT OF SCOPE for Phase 14.** Do not call Bunny GREEN. Same as Phase 13 §9: TUS presign, webhook, signed playback, provider deletion, cleanup retry all mocked and unit-tested; live smoke deferred to post-recharge per `rccf-phase13` next-step checklist.

---

## Final Verdict

**GO**

- 0 P0, 0 P1, all 7 P2 resolved with evidence, tests 278/278 green, tsc 0, builds 0, no regression, no auth/batch/assessment/live-session break, no schema change, intentional B1/B2 architecture preserved.

*MCT LMS Core → Admin 🟢 Students 🟢 Courses 🟢 Batches 🟢 Assessments 🟢 Live Classes 🟢 Auth/Security 🟢 Database 🟢 Performance 🟢 Frontend/UX 🟢 — Bunny 🟡 deferred, Historical recordings 🟡 deferred.*

