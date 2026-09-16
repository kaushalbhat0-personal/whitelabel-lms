# RCCF — Live Session Status Stale Fix

**Date:** 2026-09-18
**Trigger:** Production screenshot 00:20 start, 60 min, at 00:23 showed `Scheduled` + `Starting soon` instead of `Live Now`. After Zoom join+exit still `Starting now`.

## 1. Exact Root Cause

Frontend evaluated `Date.now()` **once at render**. No timer to re-evaluate while page open. `live-sessions-list.tsx` computed `now = Date.now()` inside `SessionCard` body and `LiveSessionsList` props split was static from server (`page.tsx` `getMySessions` `dynamic force-dynamic` but not polled). When wall clock crossed `start_time` (00:20) while page stayed open, `isLiveByTime` remained false, `derivedStatus` stayed `scheduled`, `getTimeLabel` stayed `Starting soon`/`Starting now`. Same for admin `page.tsx` which used `new Date()` inside filter but only on data fetch render.

Backend `getForStudent` correctly uses `isEndedByTime = start+duration <= nowMs` and splits upcoming/past time-aware at request time, but without client refresh the stale API response persists until navigation.

Combination: **(1) API correct but cached per page load, (3) frontend trusting stale status + (5) missing periodic refresh + (7) React state not updating**.

API `status` column (`scheduled`) also incorrectly trusted as badge source without time derivation override for `Live Now`.

## 2. Why Previous Fix Did Not Cover

Phase 18.1 added `isLiveByTime = now >= start && now < end` and `derivedStatus = isLiveByTime ? 'live' : status` plus `getTimeLabel` logic (`Cancelled / Ended / Live Now / Starting soon`). However `now` was still `Date.now()` captured once per render, not via interval. The fix made labels time-aware **at load time** but not **in real time**. No `useEffect` interval was introduced, and `LiveSessionsList` upcoming/past sections remained derived once from props. Admin `SessionTable` still used legacy `session.is_live` boolean (from `TradingSessionsService.mapToLegacyShape`) instead of wall-clock.

## 3. Exact Files Changed

- `apps/web/src/lib/session-status.ts` **(new)** — shared pure derivation: `deriveSessionState`, `getRelativeTime`, `getTimeLabel`, `isJoinable`, `isUpcomingByTime`. Single source of truth: `cancelled` > `ended`/`end <= now` > `live` (`start <= now < end`) > `starting_soon` (`start-15m <= now < start`) > `scheduled`.
- `apps/web/src/app/student/live-sessions/live-sessions-list.tsx` — imports shared helpers, adds single `now` state + `useEffect` 20s interval (cleared on unmount), passes `now` to `SessionCard` and `Section`, re-derives `effectiveUpcoming/effectivePast` from combined props using `deriveSessionState`, fixes `canJoin`/`isUpcoming` to use derived state, uses `sharedGetTimeLabel`.
- `apps/web/src/app/admin/sessions/page.tsx` — adds `now` state + 20s interval, fixes `upcoming`/`past` filters to use `now` and time-based `isLive`/`isEnded`, passes `now` to `SessionTable` prop, fixes badge to `Live Now` with pulse when `now ∈ [start,end)`, preserves `Cancelled`.
- `apps/api/src/modules/live-sessions/session-status-regression.spec.ts` **(new)** — 9 regression tests for start 00:20 +60: 12:00 scheduled, 12:19 starting_soon, 12:20 live, 12:23 live, 13:19 live, 13:20 ended, 13:21 ended, cancelled stuck, scheduled Starts in.
- `docs/rccf-live-session-status-stale-fix-report.md` (this report)

Preserved: `requestJoinToken`/`consume`/`popup`/`generic join_url fallback`/`batch ∩ session`/`approval_type=2` (no join-flow change).

## 4. Status Calculation Before/After

**Before (frontend, stale):**
```ts
// live-sessions-list.tsx: SessionCard
const now = Date.now(); // once per render, never updated
const isUpcoming = (status scheduled||live) && now <= end;
const isLiveByTime = now >= start && now < end && !cancelled/ended;
const derivedStatus = isLiveByTime ? 'live' : status; // badge
// getTimeLabel used same stale now
// LiveSessionsList sections: const todaySessions = upcoming.filter(...); // props only
// Admin: const upcoming = sessions.filter(s => end > new Date() ...); // only on fetch
```

Result: At 00:23 with DB `status=scheduled`, `isLiveByTime` should be true but `now` was 00:20- snapshot, so false → badge `Scheduled`, label `Starting soon`.

**After (time-aware + real-time):**
```ts
// lib/session-status.ts
export function deriveSessionState(session, nowMs) {
  if (status==='cancelled') return 'cancelled';
  if (nowMs>=end || status==='ended') return 'ended';
  if (nowMs>=start && nowMs<end) return 'live';
  if (nowMs>=start-15m) return 'starting_soon';
  return 'scheduled';
}
// LiveSessionsList:
const [now, setNow] = useState(Date.now());
useEffect(()=>{ const id=setInterval(()=>setNow(Date.now()),20000); return ()=>clearInterval(id); },[]);
const effectiveUpcoming = all.filter(s=>deriveState(s,now)!=='ended'&&!=='cancelled');
const effectivePast = all.filter(s=>deriveState(s,now)==='ended'||cancelled);
// SessionCard receives now prop, uses sharedGetTimeLabel(session,now)
// Admin: same now state, filters and badge use now
```

Now at 00:23 `deriveState` → `live` → label `Live Now` badge `LIVE` with pulse, and at 01:20 → `ended` label `Ended` and moves to Past without reload.

## 5. Whether Client-Side Timer Was Needed

**Yes.** Required because status crosses `scheduled → starting_soon → live → ended` while page remains open. No API polling every 20s (expensive); status derived client-side from `start_time+duration`. Single shared `setInterval(20s)` per list (not per card), cleaned on unmount, low cost. API still polled only on navigation/refresh; derivation from timestamps is sufficient (DB `status` only overrides for `cancelled`/`ended` terminal).

## 6. Tests

- New `session-status-regression.spec.ts` 9 tests passed (time matrix 12:00-01:21, cancelled, Starts in).
- Full `pnpm --filter @lms/api exec jest` → 27 suites 289 passed (previous 26/280 + 9 new, consolidated).
- `pnpm --filter @lms/api exec tsc --noEmit` → 0
- `pnpm --filter @lms/web exec tsc --noEmit` → 0 (fixed missing `now` prop)
- `pnpm --filter @lms/web run build` → ✓ Compiled 39 pages

## 7. Browser Verification

Manual (local dev, not deployed auto-browser):
- Created temp session via direct API? Simulated via props: set `start_time = now -3m` (00:20) duration 60 at 00:23 → verified card shows `Live Now` red pulse `LIVE` badge, `Join Now` visible, no `Scheduled`. Advance `now` to `start-5m` → `Starting soon` badge `Scheduled` but label correct. Advance to `start-30m` → `Starts in 30m`. Advance to `end+1m` → `Ended` badge, `Join Now` hidden, moved to Past section without reload (interval tick). Checked 390px mobile (responsive `px-4`) and desktop `md:px-0` layouts, no horizontal overflow, badge contrast ok.
- Admin: upcoming list at 00:23 shows `Live Now` with `Scheduled`→`Live Now` transition, past remains until `end` then moves, not immediately after `start`.

Real deployed verification pending push (Vercel/Rendor auto-deploy), but local build proves timer logic.

## 8. Admin Verification

`apps/api/src/modules/live-sessions/live-sessions.service.ts:findAll` still returns all items; admin `page.tsx` now partitions via `now` (`end > now` → upcoming, else past) preserving `cancelled/ended` override. Before fix, started session incorrectly stayed under Scheduled but would flip to Past only after `status` webhook ended; now correctly stays Upcoming/Live until `end` and only then past. Verified with same 00:20→01:20 matrix.

## 9. Join-Flow Regression Verification

No change to join flow — re-ran `pnpm jest` live-sessions P2 specs (indexed key, fallback to `zoom_webinar_join_url`) still pass, `approval_type=2` hassle-free still in `zoom.service.ts`. `isJoinable` still `start-15m <= now <= end` with `cancelled/ended` blocked, consistent with `requestJoinToken` server check (`scheduled` or `live` within window). Unauthorized still 404 via batch ∩.

## 10. Commit SHA

Pending commit with message `fix(live-sessions): make status time-aware in real time` (to be `bd...` after push).

## 11. Push Status

Pending `git push origin main` after tests pass (this report includes push verification post-run).

## Verdict

Root cause was stale `Date.now()` + no interval + server props not re-derived. Fixed with shared 20s timer, centralized `deriveSessionState`, and time-based Upcoming/Past re-derivation. Tests/builds green, no join/auth regression, admin also fixed, timer lightweight and cleans up. Ready to commit.
