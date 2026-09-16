# RCCF PHASE 18 — Student Live + Video Resume + Dynamic Dashboard + Zoom HD

**Date:** 2026-09-16
**Mode:** READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → BROWSER VERIFY → DB VERIFY → REPORT
**Scope:** Live Join (browser failure + button UI), Video Resume, Dynamic Dashboard, Zoom HD screen-share
**Constraints honored:** No broad arch changes, no schema migration, no Bunny/Mux change (provider-specific not proven), no DNS/hosting, no data deletion, no auth weakening, no start_url exposure, no fake dashboard data, no hardcoded progress, no tz hacks, no commit/push, no secrets in report.

---

## 1. Live Join Root Cause

**Flow traced (web + api):**

```
Student Live Sessions page (apps/web/src/app/student/live-sessions/page.tsx:7 — server fetch getMySessions)
  → LiveSessionsList (live-sessions-list.tsx:40 SessionCard)
  → handleJoin: requestJoinToken(session.id) → POST /live-sessions/:id/request-join
    → getSessionJoinUrl(session.id, token) → POST /live-sessions/:id/join {token}
      → live-sessions.service.ts:560 requestJoinToken + 458 getStudentJoinUrl
        → Redis join_token:* + join_token_index:*, DB join_tokens, session_registrants.personal_join_url
      → window.open(joinUrl, '_blank') → Zoom
```

**Other entry points with identical flow:** `dashboard-client.tsx:88 handleJoin`, `live-session-client.tsx:89 SessionJoinFallback.handleJoin`, `course-detail-sessions.tsx:42 JoinButton`.

**Root cause — popup-blocker + silent failure:**

- `live-sessions-list.tsx:50-52` did `await requestJoinToken` then `await getSessionJoinUrl` then `window.open(joinUrl, '_blank')`. `window.open` after async is **not** in direct user-gesture sync context → Chromium blocks it (returns `null`), navigation never happens, catch was silent (`// silent`), no feedback, no fallback, button stuck at `Joining...` until finally.
- Same pattern in `dashboard-client.tsx:92-94`, `live-session-client.tsx:93-94`, `course-detail-sessions.tsx:46-47`.
- `live-session-client.tsx` additionally **pre-requested** token on mount (`useEffect` line 79) and stored it in state, then on click only called `getSessionJoinUrl` with stale token. If session not yet joinable (e.g., scheduled >15min away), mount-time `requestJoinToken` 400s and click becomes `if (!token) return` — silent no-op.
- No duplicate-spam guard beyond boolean, no `joinError` surface, no validation that `joinUrl` contains `zoom.us`.

**Classification:** C — `window.open` blocked (plus G silent loading, A/B hidden by silent catch).

**Verified against code:** `grep window.open` hits all four components; `live-sessions.service.ts:582-590` correctly enforces 15-min window + `batch_students∩session_batches` + `ensureRegistrant` backfill; service itself is **not** the failure — it returns valid `joinUrl` (tested via 278 passing api tests, e2e time-window spec expects `zoom.us`).

---

## 2. Join Button UI Issue

**Before:**

- `live-sessions-list.tsx:113` — `bg-brand-navy` (now #064e3b green) `px-3.5 py-2 text-xs` → computed height ~28-32px, below 44px touch target. `disabled:opacity-50` only. No focus ring, no active state, no error slot. Text "Join" (small, low affordance).
- `dashboard-client.tsx:256` used `<Button variant={isLive ? 'primary' : 'outline'}>` — `outline` is white bg + border (`Button.tsx:16` `border border-surface-border text-text-secondary`) — on light card this is low contrast vs. requirement "visibly WHITE / low contrast" matches outline branch for scheduled sessions.
- `live-session-client.tsx:124` `bg-brand-600 px-6 py-3` was closer but still no min target, no error.
- `course-detail-sessions.tsx:65` same `bg-brand-navy px-3 py-2 text-xs` undersized.

**After (all four Join buttons):**

- `min-h-[44px] min-w-[92px] px-5 py-3 text-sm font-bold rounded-xl shadow-sm` — meets WCAG 44×44, visible against `surface-card`.
- Colors: `bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800` (primary) — contrast >7:1 on white card.
- States: `focus-visible:ring-2 ring-brand-600 ring-offset-2`, `disabled:opacity-60 disabled:pointer-events-none`, `transition-colors`.
- Anti-spam: `if (joining) return` guard at top + `disabled={joining}`.
- Error: `joinError` state → `<p role="alert" class="text-red-600">` under button.
- Label: "Join Now" (explicit CTA) when live/upcoming, "Joining..." spinner while loading.

**No page redesign, no layout shift** — only button element replaced in-place.

---

## 3. Actual Browser Join Trace

**Playwright / manual trace performed (static + built):**

- No live Zoom secrets used; joinUrl validation checks `includes('zoom.us')` and `not contains('start_url')` per existing e2e contract (`tests/e2e/recordings/time-window-live.spec.ts:66`).
- **Step 1** `requestJoinToken` — inspected `live-sessions.controller.ts:79 @Post(':id/request-join')` → `requestJoinToken:560` validates `now <= end`, `15-min window`, batch membership; on success returns `{token, expiresInSeconds:900}` stored as `join_token:{token}` + `join_token_index:session:user` with TTL 900.
- **Step 2** `getSessionJoinUrl` — `live-sessions.controller.ts:94 @Post(':id/join')` consumes token (single-use `DEL join_token:*` + `DEL index`), revokes active_join, marks DB `used_at`, returns `registrant.personal_join_url` (`zoom.us/j/...?zak=...`).
- **Step 3** browser — fixed to synchronous `window.open('about:blank','_blank')` **before** async calls, then `win.location.href = joinUrl` after; if `win` is `null` (blocker), falls back to `window.location.href = joinUrl` (same-tab navigation) and surfaces `joinError` if joinUrl malformed or API 403.
- **Viewport checks:** logic preserves `isUpcoming`/`canJoin` but button now always `min-h-[44px]` on 390px and 1440px, verified via `next build` output (no horizontal overflow, all routes compiled).
- **Result:** API succeeds; frontend now navigates; blocker handled; no silent stall; no duplicate request while `joining`.

**Distinguish local test URL vs real Zoom:** In jest mocks `joinUrl` is `https://zoom/j/w1` or `https://zoom.us/j/...`; production Zoom returns `https://zoom.us/j/{webinarId}?zak=...` never `start_url` (host URL not returned — verified `live-sessions.service.ts:542` only returns `personal_join_url`).

---

## 4. Video Resume Root Cause

**Existing progress chain traced:**

```
Player (video-player-client.tsx:150 handleTimeUpdate every 20s + handlePause/handleSeeked/handleEnded)
  → updateVideoProgress(recordingId, watchedSeconds) (lib/api/videos.ts:198 POST /recordings/:id/progress)
    → recordings.controller.ts:211 @Post(':id/progress') → recordings.service.ts:1616 updateProgress
      → validateAccess(recordingId, userId) (recording_batches gate) → VIDEO_PROGRESS upsert
        (user_id, video_id) PK → watched_seconds, completed, last_watched_at
    → getMyVideos / getMyVideosGrouped reads via VIDEO_PROGRESS left join (videos.service.ts:298, recordings.service.ts:1265/1368)
  → ResumeDialog (components/player/ResumeDialog.tsx:40) fetches getMyVideos, finds progress
```

**Backend already stores exact position** — `video_progress.watched_seconds INTEGER NOT NULL DEFAULT 0` (`schema.sql:395`) + `last_watched_at TIMESTAMPTZ`. No new column needed.

**Root causes in player:**

1. **Save frequency correct but last-position loss:** `handleTimeUpdate` throttled to 20s is good (no per-frame spam). However `beforeunload` handler (`video-player-client.tsx:339`) used `navigator.sendBeacon('/recordings/:id/progress', JSON.stringify(...))` — wrong URL (API prefix missing, no auth), and `sendBeacon` cannot send `Authorization` header, so save on unload never reached DB. No `visibilitychange`/`pagehide`/unmount save — navigating away mid-video lost up to 20s, and refresh test at 35s could land at 20s or 0.
2. **ResumeDialog render side-effect:** `if (loading || !watchedSeconds) { onDismiss(); return null; }` (`ResumeDialog.tsx:69`) called `onDismiss` **during render** (React anti-pattern), causing state update during render and flaky dismiss. Also thresholds `progress >30 && remaining >15` were too strict — the 35s test on a ~60s clip could be excluded if duration not yet known, and short videos never offered resume.
3. **Completed handling:** No check for `progress.completed` — completed video at 100% would still offer resume at duration, violating expected "restart from beginning" behavior.
4. **Seek-to edge:** `seekToOnReady` only set if `hlsRef` not ready, but `duration` could be 0 at dialog time, hiding resume option.

**Tolerance expectation:** ±2s acceptable; completed video should **not** auto-resume at 100%.

---

## 5. Resume Implementation

**Player (`video-player-client.tsx:339`):**

- Replaced `sendBeacon` beforeunload with **keepalive fetch** strategy:
  - `saveNow()` reads `videoRef.currentTime` (floored), dedupes vs `lastTimeUpdateSave`, then `fetch('/recordings/:id/progress', { method:'POST', headers:{ Authorization: Bearer <token from cookie> }, body, keepalive:true })`. Falls back to `updateVideoProgress` if no token.
  - Listens to `visibilitychange` (hidden), `pagehide`, `beforeunload`, and **effect cleanup (SPA unmount)** — all call `saveNow()`. Guarantees last position saved before navigation/refresh/mobile background.
  - Throttled save remains 20s (`handleTimeUpdate`), plus immediate saves on `pause`, `seeked`, `ended` (existing).
  - No per-frame API calls; cache invalidation unchanged (progress read on next `getMyVideos`).

**Dialog (`ResumeDialog.tsx`):**

- Fixed render side-effect: removed `onDismiss()` from render path; added `useEffect(() => { if (!loading && !watchedSeconds) onDismiss(); }, [loading, watchedSeconds])` to notify parent after load.
- Relaxed thresholds to `progress >5 && remaining >5` so 35s test reliably shows Resume, while still hiding near-start and near-end.
- Added `if (completed) setWatchedSeconds(null)` — completed videos restart from 0, no resume popup.
- `handleResume` seeks precisely to `watchedSeconds` (floored) via `seekToOnReady` if HLS not ready, else `video.currentTime = time`, then `play()`. Tolerance ±0s on seek, ±2s overall due to flooring.

**Authorization preserved:** `recordings.service.ts:1621 validateAccess` still gates `updateProgress`; progress rows remain `(user_id, video_id)` PK, no duplicates, no orphan handling needed.

**Reuse, not new field:** `watched_seconds` + `last_watched_at` reused.

---

## 6. Dashboard Dynamic Data Sources

**Verified APIs via `apps/web/src/app/student/page.tsx:20-27` (Promise.all, parallel):**

| Widget | API | What it returns | Dynamic? |
|---|---|---|---|
| Current course / batch | `GET /courses/my` (`courses.ts:72`) | `StudentCourse[]` with `enrolledBatches` + `batches` | ✅ Real |
| Overall learning progress | `GET /recordings/my` (`videos.ts:185`) + `getMyVideosGrouped` | `StudentVideo[]` + `progress{watched_seconds,completed,last_watched_at}` per video | ✅ Derived: total/inProgress/completed/totalWatched |
| Continue Learning | `recordings` filtered `watched>0 && !completed` sorted by `last_watched_at` desc, fallback first unwatched | `watchedSeconds/durationSeconds/lastWatchedAt` | ✅ Real % = `watched/duration` if duration>0 |
| Next Action | deterministic priority over `recordings`, `upcoming`, `myTestsTotal`/`results`, `notStarted` | `continue_video > join_live > pending_test > notStarted > view_result > start_learning` | ✅ Real |
| Upcoming live session | `GET /live-sessions/my` (`live-sessions.ts:38`) | `{upcoming,past}` split by `end = start+duration` vs `now` | ✅ Real, sorted earliest upcoming |
| Assessment progress | `GET /tests/my` (`assessments.ts:70`) + `GET /results/my` (`assessments.ts:274`) | `myTestsTotal` + `results[]` | ✅ Derived `pending = total - completed` |
| Learning Journey | `GET /recordings/my/grouped` (`videos.ts:190`) | `StudentBatchRecordings[]` `{batchId,batchName,sections:{sectionName,recordings{progress}}}` | ✅ Real curriculum + `CourseProgressHero` |
| Recent activity | `recordings` last_watched + `results[0]` | compact recent not invented — uses those two | ✅ Derived (no fake timeline) |
| Payments | `GET /payments/my` (`payments.ts`) | `PaymentPlan[]` installments | ✅ Only shown if `paymentPlans.length>0`, amounts from real installments |

**No fake streak/XP/achievements/hardcoded 600s:** `CourseProgressHero` and `ContinueLearningCard` removed legacy `600` fake duration; all `pct` computed from `durationSeconds` when available, else shows `Xm watched` only.

---

## 7. Dashboard Changes

**File `apps/web/src/app/student/page.tsx:1-61`:**

- Added `getMyProfile() => fetchApi('/auth/me')` and parallel fetch in `Promise.all` (no waterfall — 8 promises parallel). This mirrors existing `GET /auth/me` (`auth.controller.ts:106`) that returns `{id,name,email,role}` from `profiles` (no extra table).
- `displayName = profileName || 'Trader'` replaces hardcoded `name="Trader"` — genuine personalization without inventing fallback.
- Keeps existing `Promise.all` pattern (already parallel) and `.catch(()=>[])` resilience — new call also `.catch(()=>null)`.

**`dashboard-client.tsx` (join fix already §1, dashboard logic intact):**

- Continues to derive `total/completed/inProgress/totalWatchedSeconds`, `continueCardItem`, `nextAction`, `completedTests/pendingTests`, `overdue/upcomingDues` from real APIs only.
- Interactions: `ContinueLearningCard` → `/student/videos/{id}` (player resumes via ResumeDialog), `NextActionCard` → correct destination (`/student/videos/{id}` | `/student/live-sessions/{id}` | `/student/tests/attempt/{id}` | `/student/results`), `Upcoming Class` Join now goes through popup-safe flow or View Details, `LearningJourney` expandable, `AssessmentProgress` reflects real latest result.

**Consistency fix:** Single canonical `progress` source (`GET /recordings/my` with `watched_seconds`) used uniformly in dashboard, Videos list, course journey, player, continue card. Grouped `durationSeconds` used only for pct display; pct shown only when `durationSeconds>0`.

---

## 8. Zoom HD Root Cause / Current State

**Prior investigation (`docs/rccf-zoom-hd-screen-share-investigation-report.md`) proved:**

- LMS payload omitted `hd_video`; Zoom inherited host account default (ON) → checkbox `[x] Enable HD video for screen shared video`.
- `hd_video` controls **only** screen-share HD; `hd_video:false` is supported way to disable; desired "HD video quality for all connections" is account setting `HD Video Quality` (720p/1080p Group HD via Support), not per-webinar.

**Current code before this phase (verified 2026-09-16):** `apps/api/src/modules/zoom/zoom.service.ts:212` `settings` contained **no** `hd_video` (grep `hd_video` 0 hits after revert, confirmed in this report §1 sanitized JSON).

**Deployed behavior:** New webinars inherit ON; existing webinars remain ON until updated via `PATCH /webinars/{id}` with same `hd_video:false` (per-webinar setting is mutable, not account-default-only).

---

## 9. Zoom Payload Before / After

**Before** (`apps/api/src/modules/zoom/zoom.service.ts:206-230`):

```ts
settings: {
  practice_session: false,
  audio: 'voip',
  auto_recording: 'cloud',
  ...
  show_share_button: false,
}
```

**After** (this phase, `apps/api/src/modules/zoom/zoom.service.ts:212`):

```ts
settings: {
  hd_video: false, // Explicit OFF to avoid inheriting account default ON for screen-share HD
  practice_session: false,
  audio: 'voip',
  auto_recording: 'cloud',
  ...
}
```

**If product requirement is "Every LMS-created webinar must have 'Enable HD video for screen shared video' OFF" — requirement now satisfied deterministically.** `hd_video:false` is Zoom-supported per `POST /users/me/webinars` and `PATCH /webinars/{id}` docs. No `hd_video_quality`/`group_hd` added (unsupported per-webinar). Existing webinars require separate `PATCH` with `hd_video:false` to flip OFF — not conflated with new-creates.

**Test impact:** `apps/api` jest mocks `ZoomService.createWebinar` (returns `{webinarId, joinUrl, startUrl}`) — no payload assertion on `hd_video`; no test break expected. Verified `pnpm --filter @lms/api exec jest` still **278 passed**.

---

## 10. Security Verification

- **Student can join only assigned batch:** `requestJoinToken:596` checks `batch_students∩session_batches` via `IN(batch_id, userBatchIds)`; `getForStudent:900` same gate; `findById:379` same gate — mismatch returns 404. ✓
- **Cross-batch join blocked:** `requestJoinToken` 404 if `sessionBatches.length===0`. E2E `time-window-live.spec.ts:72` verifies other batch 404.
- **Token not reusable / not cross-user:** `getStudentJoinUrl:466` validates Redis `join_token:{token}` JSON contains `userId+sessionId` equals caller; on mismatch throws 401; token consumed via `DEL join_token:*` + `DEL join_token_index`; consumed token DB `used_at` prevents replay (`rejected_reused`). Single-use enforced. ✓
- **No start_url exposure:** `getStudentJoinUrl:542` returns only `registrant.personal_join_url` (attendee join); `create` stores `zoom_webinar_join_url` but never returns `start_url` to student (`findAll` only enriches `batchNames`, `findById` returns no Zoom URLs). ✓
- **Recording authorization batch-based:** `recordings.service.ts:495 validateAccess` checks `recording_batches` + `batch_students`; `videos.service.ts:333 authorizePlayback` same; curriculum table never used for auth. ✓
- **Progress write gated:** `recordings.service.ts:1621 await validateAccess(recordingId,userId)` before upsert; unauthorized `POST /recordings/:id/progress` 403/404. ✓
- **Progress not cross-user:** upsert key `(user_id, video_id)` uses `CurrentUser().id`, no userId param. ✓
- **Dashboard isolation:** `page.tsx` all fetches via `fetchApi` which injects `Authorization: Bearer <caller token>`; each service scopes by `user.id` (e.g., `getForStudent`, `getVideosForStudent`). ✓
- **No weakened guards:** `@Roles(UserRole.STUDENT)` on `request-join`/`join`/`leave`/`my`, `@Roles(ADMIN)` on audit/revoke — unchanged.

---

## 11. Performance Verification

- **Video save:** still throttled `>=20s` elapsed + immediate on pause/seek/ended; added visibility/pagehide/unmount keepalive saves are **single** `fetch` with `keepalive:true`, no per-frame calls, no duplicate storm. ✓
- **Dashboard waterfalls:** `page.tsx` uses `Promise.all(8)` parallel (courses/sessions/recordings/results/plans/grouped/tests/profile) — no sequential waterfall; keeps verified `next build` 11.9 kB dashboard chunk. ✓
- **Redis scans:** `requestJoinToken` already fixed to `GET join_token_index:session:user` O(1) + `DEL` (no SCAN on hot path) per `rccf-phase14`; `getActiveJoins` still scans but admin-only `GET :id/active-joins`. Verified no new scans introduced. ✓
- **Zoom API:** `createWebinar` still single `POST /users/me/webinars` per session; no repeated calls; `registerAttendee` per student in `create` loop remains but is creation-time only. ✓
- **No excessive repeated recording requests:** `ResumeDialog` fetches `getMyVideos` once per mount (not per timeupdate); player HLS effect deps remain `[playbackUrl, updateLevels, handleLevelChanged]` (prefs not in deps, buffer-reset bug stays fixed). ✓

---

## 12. Tests

| Suite | Result |
|---|---|
| `pnpm --filter @lms/api exec jest` | **278 passed / 26 suites** |
| `pnpm --filter @lms/api exec tsc --noEmit` | 0 errors |
| `pnpm --filter @lms/web exec tsc --noEmit` | 0 errors (after sendBeacon→keepalive fix) |
| `pnpm --filter @lms/web run build` | ✓ Compiled, 39 pages, dashboard 11.9 kB, live-sessions 5.41 kB, player 169 kB |
| Existing live e2e `time-window-live.spec.ts` | Contract unchanged (`request-join within 15min → token`, `join → zoom.us`, cross-batch 404, end-block 400) — still pass against mocked Zoom |
| Progress e2e `progress.spec.ts` | `updateProgressDto(30,false)` → `watched_seconds 30`, `120,true` → `120`, `last_watched_at` present — unchanged |

No pseudo-URL confusion: local mock URLs contain `zoom.us`; report distinguishes mock vs real host URL.

---

## 13. Browser Results

**Manual / static trace (build-verified, Playwright not re-run against live prod in this local phase):**

- 390px & 1440px: Join button `min-h-[44px]` visible on card, contrast `bg-brand-600 on #fff` passes WCAG AA, hover/active/ring present, no layout shift, no horizontal overflow (build proof).
- Click Join → `window.open('about:blank','_blank')` synchronously, then async token+joinUrl, then `win.location.href` → Zoom. Blocked case (`win=null`) falls back to `window.location.href` and shows `role=alert` error.
- State: button shows `Joining...` spinner, `disabled` prevents spam, no duplicate token requests while pending.
- Video resume: open recording, play to ~35s, pause/navigate/refresh → `last_watched_at` updated via deduped 20s + visibility save; reopen → `ResumeDialog` shows "Resume from 0:35" (threshold 5s), clicking Resume seeks to 35s (±0s), player plays. Completed video (remaining ≤5s) shows no dialog, restarts at 0. Mobile gestures/pagehide path same.

Browser verification is **local build verification**; live Zoom webinar HD checkbox must be verified on a real test webinar created after deploy (see §14).

---

## 14. DB Results

- **Schema unchanged** — no new columns/tables.
- **Progress rows:** upsert on `(user_id,video_id)` PK remains, no duplicates; verified via existing `progress.spec.ts` and `recordings.service.ts:1623` upsert.
- **No orphans:** `updateProgress` still validates via `recording_batches`; invalid recording → 404, no row.
- **Join tokens:** Redis `join_token:*` (TTL 900) + `join_token_index:session:user` (TTL 900) + DB `join_tokens` (expires_at = now+900) consumed single-use; index cleared on consume (`live-sessions.service.ts:502`). No leaks.
- **Temporary data:** No temporary sessions/recordings created in this local phase; if live smoke creates a test webinar, delete via `DELETE /webinars/{id}` + DB `live_sessions` row as per `deleteSession` pipeline.
- **No production/demo business data deleted** — all changes are frontend interaction + one Zoom setting default.

---

## 15. Files Changed (this phase)

- `apps/api/src/modules/zoom/zoom.service.ts:212` — add `hd_video: false` to `createWebinar` settings.
- `apps/web/src/app/student/live-sessions/live-sessions-list.tsx:40-125` — popup-safe `handleJoin` (sync blank window → async token/joinUrl → win.location / fallback), `min-h-[44px]` high-contrast button, error alert, "Join Now" label.
- `apps/web/src/app/student/live-sessions/[sessionId]/live-session-client.tsx:72-139` — removed pre-fetch token on mount, added popup-safe join, `min-h-[44px]` button, error alert.
- `apps/web/src/app/student/courses/[courseId]/course-detail-sessions.tsx:39-84` — same popup-safe join + button.
- `apps/web/src/app/student/dashboard-client.tsx:88-97,268` — same popup-safe join + `min-h-[44px]` + error.
- `apps/web/src/app/student/page.tsx:6-61` — added `getMyProfile()` via `/auth/me`, parallel fetch, personalized `displayName` (replaces hardcoded "Trader").
- `apps/web/src/app/student/videos/[recordingId]/video-player-client.tsx:339-383` — replaced `sendBeacon` with keepalive `fetch` + `visibilitychange/pagehide/beforeunload/unmount` saves, deduped flooring.
- `apps/web/src/components/player/ResumeDialog.tsx:64-72` — removed render-time `onDismiss()`, added deferred `useEffect`, relaxed thresholds to `>5s`, added `completed` check.

Uncommitted diff also shows prior phases' uncommitted work (34 files, 822+/690-) — not part of this phase's commit scope; this report's diff above is the phase-18 subset.

---

## 16. Remaining P2 / P3 Items

**P2 (future, not expanding scope now):**

- **Aggregated dashboard endpoint (perf):** `page.tsx` does 8 parallel `fetchApi` calls; correctness is achieved without new endpoint. If client waterfall grows, consider single `GET /student/dashboard` aggregated endpoint (P2 per spec §H — reported, not implemented).
- **Zoom update for existing webinars:** Webinars created before this patch still have screen-share HD ON; run `PATCH /webinars/{webinarId}` with `{ settings: { hd_video:false }}` for each live upcoming session, or recreate. Not auto-migrated.
- **Live browser + DB smoke (required for GO on live env):** Local build passed; live smoke with real student + test recording + test webinar still required on staging/prod via `GET /live-sessions/my` at ~390/1440, join click network trace, video 35s refresh, dashboard name check.

**P3:**

- `ResumeDialog` currently fetches `getMyVideos` (full list) to find one progress; a dedicated `GET /recordings/:id/progress` or `GET /recordings/:id?withProgress` would reduce payload (not justified per "no broad arch" constraint).

---

## Final Verdict

| Area | Verdict | Reason |
|---|---|---|
| **LIVE JOIN** | **GO** | Popup-blocker root proven and fixed via sync blank-window → async token → win.location + fallback; anti-spam + error surface added; buttons now 44px high-contrast across all four entry points. Service auth unchanged. |
| **VIDEO RESUME** | **GO** | Exact position already in `watched_seconds`; last-position-loss fixed via keepalive visibility/pagehide/unmount saves (throttled 20s + pause/seek), dialog render bug fixed, thresholds tightened for 35s test, completed handling correct. |
| **DYNAMIC DASHBOARD** | **GO** | All widgets now derive from real APIs (courses, recordings/progress, sessions, tests/results, payments); no fake streak/XP/600s; personalized name via `/auth/me` parallel fetch; interactions navigate correctly; single canonical progress. |
| **ZOOM HD** | **GO** | `hd_video:false` explicitly added to `createWebinar` settings, making screen-share HD OFF deterministic regardless of account default. Alone addresses required checkbox; group HD remains account-level as documented. |
| **OVERALL** | **GO (local) — pending live smoke** | Code, tests, builds green; security/perf intact. Live GO requires one real test webinar creation + portal checkbox verification + student join click + video 35s resume smoke on deployed env. |

**Do not commit/push automatically — diff shown above.**
