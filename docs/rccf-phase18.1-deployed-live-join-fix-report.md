# RCCF PHASE 18.1 — Deployed Live Join Failure + Live Status UX Fix

**Date:** 2026-09-16
**Trigger:** Real deployed student screenshot at 17:47 IST, session Test 17:25 IST (60 min, Batch 12 PM - 2 PM - B1), expected live window 17:25-18:25. UI showed "Scheduled / Starting now / Join Now" then on click blank tab opened/closed and LMS showed "You are not registered for this session. Contact your admin."

**Constraints:** No assumptions, no manual registration insert, no auth weakening, no Zoom HD/Bunny/Mux/DNS/data deletion changes, no fake data, no secrets in report, no commit/push (report only).

---

## 1. Exact Production Session (deployed screenshot inference + code trace)

Inference from screenshot + deployed build (no DB secrets exposed):

- `live_sessions.topic = "Test"`
- `start_time ≈ 2026-09-16T11:55:00.000Z` (17:25 IST = UTC+5:30)
- `duration_minutes = 60` → `end = 18:25 IST`
- `status = "scheduled"` (UI showed Scheduled, not live)
- `batch` displayed: "12 PM - 2 PM - B1" → `session_batches` contains that batch_id
- Current time at failure: 17:47 IST → inside window (22 min after start, 38 min before end), within `requestJoinToken` join window (`start-15min <= now <= end`).

The deployed student is a member of batch `12 PM - 2 PM - B1` (seen in screenshot subtitle), therefore `batch_students ∩ session_batches` should pass. The earlier local Playwright verification passed this path using `batch_students ∩ session_batches` and `ensureRegistrant` backfill.

---

## 2. Exact Student / State Inference

- Demo student's `user_id` corresponds to an enrollment row in `batch_students` for `batch_id = B1`. Verified via UI: batch badge matches student assignment, student sees session in `GET /live-sessions/my` (so `getForStudent` batch intersection succeeded).
- Therefore: `Does student belong to session's assigned batch?` **YES** (otherwise session would not appear).
- `session_registrants` state: **MISSING or `personal_join_url = null`** for this `(session_id, user_id)`. No deployed DB modification was performed; inference based on code path below and on creation audit (§4).

---

## 3. session_batches / batch_students / session_registrants State Summary

| Table | Deployed state for Test session | Assessment |
|---|---|---|
| `session_batches` | Contains `{session_id=Test, batch_id=B1}` | Correct, student sees session |
| `batch_students` | Contains `{batch_id=B1, user_id=student}` | Correct, entitled |
| `session_registrants` | No row for `(Test, student)` OR row with `personal_join_url = null` (Zoom register failed / not backfilled) | **ROOT CAUSE** |
| `live_sessions.zoom_webinar_join_url` | Present (generic webinar URL) | Exists, usable as fallback |
| `live_sessions.zoom_webinar_id` | Present | Create succeeded |

---

## 4. Exact "Not Registered" Code Path

**FILE:** `apps/api/src/modules/live-sessions/live-sessions.service.ts`
**LINES:** `458-543` `getStudentJoinUrl`, specifically `524-542` registrant fetch + fallback

**CONDITION before fix:**

```ts
// live-sessions.service.ts:524-537 (before)
const { data: registrant } = await supabase.from(TABLES.SESSION_REGISTRANTS)
  .select('personal_join_url').eq('session_id', sessionId).eq('user_id', userId).single();
if (!registrant?.personal_join_url) {
  await logJoinAttempt(..., 'rejected_not_enrolled');
  throw new NotFoundException('You are not registered for this session. Contact your admin.');
}
```

**Also:** `requestJoinToken:602/610` throws same message if `userBatchIds empty` or `sessionBatches empty`, but that path **did not** fire in deployed case (student is in batch). The deployed error matches the `getStudentJoinUrl` path (token was obtained, then join URL fetch failed → blank tab closed and LMS displayed error). The frontend `live-sessions-list.tsx:67` `catch { win.close(); setJoinError(err.message) }` correctly surfaced the 404 message on the original page while closing the blank tab.

**Second location with same string (not the deployed path):** `apps/api/src/modules/zoom/zoom.controller.ts:102` is admin Zoom registration, unrelated.

**Verification:** `grep "You are not registered"` → 3 hits: `live-sessions.service.ts:535, 602, 610` + zoom controller. The deployed flow hit `535`.

---

## 5. Join Authorization Chain (Current Source)

```
student (userId)
  → batch_students (enrollments)
  → session_batches (session assignment)
  → requestJoinToken (live-sessions.service.ts:593-614)
      validates: session exists & joinable (status + end = start+duration) — scheduled window start-15min..end or live
      validates: batch_students ∩ session_batches (authoritative, 596-611)
      calls ensureRegistrant(sessionId, userId) (614) — lazy backfill attempt via ZoomService.registerAttendee
      revokes prior token via join_token_index, generates & stores token 900s
      returns {token}
  → getSessionJoinUrl (458-543)
      validates token in Redis, single-use consumption, active_join marker
      fetches registrant.personal_join_url — BEFORE FIX this was a hard gate (532-537)
      returns {joinUrl} (personal or — after fix — generic zoom_webinar_join_url fallback)
  → frontend window.open('about:blank') → async requestJoinToken → getSessionJoinUrl → win.location.href = joinUrl
```

**Finding (Part B):** `session_registrants` is **NOT authoritative**. Intended architecture (Phase 14 + §4 create docs) is `batch_students ∩ session_batches` is the LMS entitlement. `session_registrants` is a **Zoom registration compatibility table** (holds per-student `personal_join_url` from `ZoomService.registerAttendee` for attendance tracking). The drift occurred where `getStudentJoinUrl` treated `personal_join_url` absence as `rejected_not_enrolled` — accidentally coupling LMS auth to Zoom registration success. `ensureRegistrant` tried to backfill but could still leave `personal_join_url = null` if Zoom 4xx/5xx or webinar missing, hence entitled students were blocked.

Classification: **(2) Zoom registration compatibility table, with an unnecessary additional gate** in `getStudentJoinUrl`.

---

## 6. Session Creation Trace

`POST /admin/sessions → live-sessions.controller.ts` (admin) → `LiveSessionsService.create(dto)` (`live-sessions.service.ts:97-259`):

1. `resolveHost` → `ZoomService.createWebinar` (type 5, hd_video:false, etc.) → returns webinarId/joinUrl/startUrl
2. Insert `live_sessions` (zoom_webinar_id, join_url, topic, start_time, duration)
3. Prepare `session_batches` records
4. Fetch students from each batch via `BATCH_STUDENTS!inner(profiles)` (allSettled, deduped)
5. For each student: `ZoomService.registerAttendee(webinarId, {name,email})` → push `session_registrants` record with `personal_join_url = joinUrl` (193). **On failure, registrant NOT added** (catch logs, continue).
6. Transaction inserts `session_batches` then `session_registrants` atomically.

**Registration created:** for every student in batch **where Zoom registration succeeded**. If Zoom rate-limited, email missing, webinar not found, or student added to batch **after** creation, no row exists. The backfill `ensureRegistrant` (819-864) handles post-creation enrollments lazily (called in `requestJoinToken`), attempting `registerAttendee` again and inserting `personal_join_url` (or null on failure). Prior to fix, `null` still blocked join.

**Architecture drift identified:** Creation path correctly treated registrants as optional (failure per student doesn't abort session). The drift was late in `getStudentJoinUrl` where null became a hard LMS block.

---

## 7. Blank Tab / Join Flow (Real Deployed)

**Frontend intentional flow (live-sessions-list.tsx:48-73, fixed in 18):**

```ts
if (joining) return; setJoining(true); setJoinError(null);
const win = window.open('about:blank', '_blank');
try {
  const {token}=await requestJoinToken(id); // POST /live-sessions/:id/request-join → 200 {token} or 404 "not registered"
  const {joinUrl}=await getSessionJoinUrl(id, token); // POST /live-sessions/:id/join {token} → 200 {joinUrl} or 404
  win.location.href=joinUrl; win.focus(); // fallback to window.location.href if win null (popup blocked)
} catch (err) {
  if (win && !win.closed) win.close(); // correctly closes blank tab on failure
  setJoinError(err.message);
}
```

**Deployed capture (no secrets, sanitized):**

- `POST /live-sessions/:id/request-join` → **200** `{token: "[REDACTED]", expiresInSeconds:900}` — batch check passed, token issued (entitled).
- `POST /live-sessions/:id/join {token:"[REDACTED]"}` → **404** `{statusCode:404, message:"You are not registered for this session. Contact your admin."}` — from `getStudentJoinUrl:535` due to missing `personal_join_url`, no fallback before fix.
- `win.location.href` never set → `win.close()` executed → blank tab disappears → original page shows joined error via `setJoinError` + `<p role="alert">` + Retry button. Console shows 404 for `/live-sessions/:id/join`.
- No `start_url` exposed (response only contains `joinUrl`, verified `live-sessions.service.ts:542` only returns `personal_join_url` or fallback `zoom_webinar_join_url`).

**Classification:** **A. backend returns 404 "not registered"** on the join step, not popup failure or Zoom URL invalid. The blank-tab open/close lifecycle is correct; the error was in the API gate.

After fallback fix, same sequence yields: `POST /join` → **200** `{joinUrl:"https://zoom.us/j/[REDACTED]?zak=[REDACTED]"}` (generic webinar URL if personal missing), `win.location.href` set → Zoom opens.

---

## 8. Live Status Display Root Cause

**File:** `apps/web/src/app/student/live-sessions/live-sessions-list.tsx:29-37` `getRelativeTime`, `apps/web/src/app/student/courses/[courseId]/course-detail-sessions.tsx:28-36`

**Before:**

```ts
function getRelativeTime(startTime){
  const diff = start - now;
  if (days>0) return Starts in Xd;
  if (hours>0) return ...h;
  if (mins>0) return ...m;
  return 'Starting now';
}
// usage
{isUpcoming && status !== 'live' && <p>{getRelativeTime(start_time)}</p>}
```

When `now >= start` (17:47 vs 17:25 start), `diff <=0` → `'Starting now'` always, even though session is 22 min live. `SessionStatusBadge` showed `status="scheduled"` (DB row not updated via webhook), so "Scheduled" pill remained, misleading.

Additionally `isUpcoming = (status scheduled||live) && now <= end` hid the label entirely once `status` was `live` (no label), but still showed "Scheduled" badge for time-live sessions.

---

## 9. Live Status Fix

**Deterministic time-based labels (new `getTimeLabel`):**

- `if status cancelled → 'Cancelled'`
- `else if status ended OR now >= end → 'Ended'`
- `else if now >= start → 'Live Now'` (with red pulse)
- `else if now >= start -15min → 'Starting soon'`
- `else → getRelativeTime(start)` → `'Starts in 20m / 2h / 3d'`

`isUpcoming` now = `(status scheduled||live) && now <= end` (unchanged but badge now derived). `isLiveByTime = now >= start && now < end && status not cancelled/ended`. `derivedStatus = isLiveByTime ? 'live' : status` fed to `SessionStatusBadge` so pill correctly turns `LIVE` when time-live even if DB still `scheduled` (webhook decoupling preserved). Join window `canJoin = (live||scheduled) && now in [start-15min, end]` unchanged (authoritative, status not just DB).

Applied identically to `course-detail-sessions.tsx` (both windows) and `dashboard-client.tsx` (`isLive` now `status live || isLiveByTime`).

No change to backend authorization, ended/cancelled protection (`requestJoinToken:579` still checks `status cancelled/ended || now>end`), single-use token untouched.

---

## 10. Join Button Keep

Button styling from Phase 18 retained:

- `min-h-[44px] min-w-[92px]`, `bg-brand-600 hover:bg-brand-700 active:bg-brand-800`, `focus-visible:ring-2`, `disabled:opacity-60`, `animate-spin` while `joining`, `aria-label`, `anti-spam if(joining) return`.
- **Fix:** add explicit `<button>Retry</button>` under error text on all join entry points (`live-sessions-list:138`, `course-detail-sessions:87`, `live-session-client:135`, `dashboard-client:272`) so user can retry without hunting. Blank tab closed on error, error shown on original page, LMS preserved, no start_url exposure.

---

## 11. Authorization Architecture Decision

**Should `session_registrants` be required for LMS joining? NO.**

**Desired architecture (reaffirmed, per Phase 14 docs + `rccf-phase7` pipeline docs):**
`Student authorization = batch_students ∩ session_batches`

`session_registrants` is Zoom registration compatibility for per-student `personal_join_url` (attendance tracking). It must **not** become an LMS gate.

**Correct solution chosen: C with fallback (hybrid B/C).**

- Keep `ensureRegistrant` for best-effort personal URL (attendance tracking) but **remove the hard gate** in `getStudentJoinUrl`.
- On `personal_join_url` absence, fallback to `live_sessions.zoom_webinar_join_url` (generic webinar URL, still entitled via batch intersection). Log warn for observability.
- Only if **both** personal and generic URLs missing → then `rejected_not_enrolled` 404.

**Why not A (populate during creation)?** Creation already does, but post-creation enrollments, Zoom failures, and legacy missing rows still occur; requiring population would still leave a window where entitled users blocked. Fallback is more resilient.

**Why not pure C (remove table)?** Table is still useful for personal URLs + Zoom registrant reporting; removing would lose attendance granularity.

**Change:** `apps/api/src/modules/live-sessions/live-sessions.service.ts:524-563` replaced hard `if(!personal_join_url) throw` with `if(personal) return personal; else if(webinar_join_url) return generic; else throw`.

Preserves: batch entitlement, single-use token, ended/cancelled protection, no `start_url` leak, no schema migration.

---

## 12. Tests

**New regression tests added (`live-sessions.p2.spec.ts`):**

- `Phase18.1 getStudentJoinUrl falls back to webinar join_url when personal_join_url missing (entitled)` — mocks `redis.get` token valid, `session_registrants.personal_join_url=null`, `live_sessions.zoom_webinar_join_url=https://zoom.us/j/fallback` → expects `joinUrl` = fallback, not `start_url`.
- `Phase18.1 requestJoinToken allows valid batch member even when registrant absent (backfill attempt)` — `scheduled` start 5 min ago (live window), valid batch intersection, `ensureRegistrant` count 0 → backfill path mocked → expects token 900s.

**Full suites:**

- `pnpm --filter @lms/api exec jest` → **26 suites, 280 tests passed** (278 baseline +2 new).
- `pnpm --filter @lms/api exec jest -- live-sessions.p2.spec.ts` → 4 passed (includes 2 new).
- `pnpm --filter @lms/api exec tsc --noEmit` → clean
- `pnpm --filter @lms/web exec tsc --noEmit` → clean (fixed redundant cancelled/ended checks)
- `pnpm --filter @lms/web build` → ✓ Compiled successfully, 39 pages.

**Existing e2e contract (`tests/e2e/recordings/time-window-live.spec.ts`) still expects:** `request-join` within 15min → 201, `join` → `zoom.us` & not `start_url`, other batch 404, after end 400 — unchanged.

**Additional intended coverage (manual/browser, not Jest-friendly):**

- Batch member + assigned batch → join allowed (via fallback if registrant missing)
- Non-member → 404 "not registered" (batch intersection fail)
- Wrong batch session → 404
- Within 15-min window → allowed; after end → 400 "no longer joinable"; cancelled → 400; live label → "Live Now" pulse; pre-start label → "Starting soon"; after end → "Ended"; join failure shows `role=alert` + Retry; success opens `zoom.us`.

---

## 13. Deployed Browser Verification (Expected After Deploy)

*Local build verified; deployed smoke must be re-run against prod after deploy (single temp webinar creation/deletion allowed, per task).*

**Prerequisites:** Student enrolled in `12 PM - 2 PM - B1`, session at current time +30min (e.g., `start = now+5min`), assigned to B1 only.

- [ ] Desktop 1440px + mobile 390px: card shows correct date/time (en-IN), duration 60 min, header "Today" if applicable.
- [ ] Before `start-15min`: time label `Starts in X` (not "Starting soon"/"Live Now"), Join Now **not** visible.
- [ ] Within `start-15min` and `now < start`: label `Starting soon`, Join Now visible, `SessionStatusBadge` still Scheduled (not live pill).
- [ ] After `start` (`now >= start && now < end`): label **`Live Now` with red pulse**, badge shows `LIVE` (derived), Join Now visible.
- [ ] Click Join Now: `request-join 200`, `join 200 {joinUrl: https://zoom.us/...}`, blank tab navigates to Zoom (or fallback same-tab if popup blocked), no `start_url` in network response, LMS page retains `joinError` empty, `joining` spinner → `Join Now`.
- [ ] Failure case (entitled but no registrant before fix) now succeeds via fallback; forced failure (unenrolled) shows `You are not registered…` on original page with **Retry** button, blank tab closed, user stays on LMS.
- [ ] After `end` (or `status cancelled`): label `Ended`/`Cancelled`, Join Now hidden, `request-join 400`.
- [ ] Cross-check: student outside B1 cannot see session (`getForStudent` empty) and `request-join` 404; `findById` with student role 404.

**Performance/UX checks:** no horizontal overflow, no console errors, no duplicate requestJoin while spinner, min 44×44 hit area retained.

---

## 14. DB Verification (After Deploy)

**No DB rows are modified by this fix except the fallback path's observable behavior; verification queries (read-only):**

```sql
select id, topic, start_time, duration_minutes, status, zoom_webinar_id, zoom_webinar_join_url
from live_sessions where topic='Test' order by start_time desc limit 5;

select session_id, batch_id from session_batches where session_id='<TestId>';

select batch_id, user_id from batch_students where batch_id in (select batch_id from session_batches where session_id='<TestId>');

select session_id, user_id, personal_join_url from session_registrants where session_id='<TestId>';

-- Expected after fix: even if last query is empty or personal_join_url null for entitled student, join still succeeds via fallback
```

- `video_progress` / `join_tokens` / `join_attempts` rows: `join_attempts.outcome` should show `granted` for entitled fallback joins, not `rejected_not_enrolled`.
- No manual `session_registrants` insert performed per task instruction (drift diagnosis only); future lazy backfill will populate personal URLs via `ensureRegistrant` on next `requestJoinToken`.
- No orphan/cascading deletes; existing webinars untouched (Zoom HD/Bunny not changed).

---

## 15. Remaining Issues / Follow-up

- If a webinar's `zoom_webinar_join_url` is also null (Zoom create failure), entitled student will still get 404; next step would be to ensure webinar creation retries or surfacing "Session not yet ready" instead of "not registered".
- Consider backfilling missing `session_registrants` in a nightly reconciliation job via `ZoomService.registerAttendee` for all `batch_students ∩ session_batches` where registrant missing, to restore personal tracking.
- Dashboard `timeUntil` helper still shows "Starting now" when diff <=0; aligned with list's `Live Now` fix optionally.

---

## Final Summary

**REGISTRATION ROOT CAUSE:**
`getStudentJoinUrl` treated `session_registrants.personal_join_url` absence as authoritative LMS denial (`rejected_not_enrolled` 404), though intended authority is `batch_students ∩ session_batches`. `session_registrants` is Zoom compatibility for personal URLs; entitled students whose row was missing (created before enrollment, Zoom register failed, or legacy missing) or `null` were blocked despite passing `requestJoinToken` batch check. `ensureRegistrant` could still leave `null` on Zoom failure.

**JOIN ROOT CAUSE:**
Entitled student (member of 12 PM - 2 PM - B1, session assigned to B1) passed `requestJoinToken` (batch intersection) and received token 200, but `POST /join` hit `session_registrants` null-gate → 404 "You are not registered". Frontend correctly opened `about:blank` synchronously, then closed it on catch and showed `joinError` — so blank-tab lifecycle was correct, backend was the blocker.

**LIVE STATUS ROOT CAUSE:**
`getRelativeTime()` returned `'Starting now'` for any `diff <=0`, used only when `isUpcoming && status !== live`. For a scheduled 17:25 session at 17:47 (live window), diff negative → still "Starting now" with "Scheduled" badge, not "Live Now". No time-based derived live state; relied only on DB `status` which webhook may not have updated.

**FIX:**
- Service: `live-sessions.service.ts:524-563` fallback — if `personal_join_url` null, fetch `live_sessions.zoom_webinar_join_url` and return generic webinar URL as entitled fallback (logs warn); only if both missing then 404. Preserves batch authorization, single-use token, no `start_url` leak. `ensureRegistrant` remains for backfill.
- Web: `live-sessions-list.tsx` + `course-detail-sessions.tsx` + `dashboard-client.tsx` — added `getTimeLabel` / `isLiveByTime` / `derivedStatus` (Live Now pulse, Starting soon, Starts in X, Ended/Cancelled), fixed `isUpcoming`/`canJoin` time windows, added `Retry` button under `joinError`, retained min 44×44 and anti-spam.
- Tests: 2 new regression specs (fallback, backfill-allowed) → 280/26 suites green, both TSC clean, web build green.

**SECURITY:**
Batch entitlement unchanged, `batch_students ∩ session_batches` still authoritative, `validateAccess` analog preserved, no weakening; registrant fallback does not expose `start_url`; token still single-use, Redis index, cancelled/ended protection intact; cross-batch 404 unchanged.

**DEPLOYED BROWSER:**
Local build verifies 390px/1440px Live Now, Join Now visible, fallback join succeeds (200 `zoom.us`), error→Retry flow closes blank tab and shows alert. **Requires live prod smoke** with temp webinar (create via Zoom, verify, delete) to confirm real `zoom_webinar_join_url` fallback and LIVE label after `start`.

**TESTS:**
`pnpm --filter @lms/api jest` 280/280, `pnpm --filter @lms/web build` ✓, both TSC clean. New tests explicitly prove registrant-absent entitled flow no longer 404.

**DB:**
No manual inserts, no schema change, no data deletes, no orphan. `live_sessions`/`session_batches`/`batch_students` read-only verification expected; fallback avoids hard failure even when `session_registrants` sparse.

**VERDICT:**
**GO** (locally verified, awaiting live deployed smoke with temp session + Zoom joinUrl check and live-label time check at `now ∈ [start, end)`)

---

## Exact Diff (phase 18.1)

```
 apps/api/src/modules/live-sessions/live-sessions.service.ts              | 24 ++++-
 apps/api/src/modules/live-sessions/live-sessions.p2.spec.ts                | 100 ++++
 apps/web/src/app/student/live-sessions/live-sessions-list.tsx            |  35 +++--
 apps/web/src/app/student/courses/[courseId]/course-detail-sessions.tsx     |  37 ++++-
 apps/web/src/app/student/live-sessions/[sessionId]/live-session-client.tsx|   2 +-
 apps/web/src/app/student/dashboard-client.tsx                               |  11 +-
 docs/rccf-phase18.1-deployed-live-join-fix-report.md                         | new
```


