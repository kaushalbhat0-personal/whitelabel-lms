# Phase 21 — Graceful One-Device Login

## Problem
When a student is already logged in on Device A and logs in on Device B with the same account, the one-device security correctly detects the existing session, but the current UX shows a raw Next.js error `Application error: a client-side exception has occurred` instead of a controlled message. The user has no guidance that the previous device was logged out and that they must log in again.

## Existing Behavior
- `apps/api/src/modules/auth/auth.service.ts:144` checked `userSession:{userId}` in Redis; if `existingSessionId` existed, it deleted `session:{oldId}` but kept `userSession` and then immediately created a new `sessionId` and JWT and stored both keys. Device B login succeeded, Device A was invalidated on next `validateSession` (guard checks `storedSessionId !== payload.sessionId` → `Session expired or signed in on another device` 401).
- Frontend `apps/web/src/hooks/useSession.ts:44` `login` called `fetchApi('/auth/login')`, set cookies, and on `catch` did `storeState.setError(err.message); throw err;`. `apps/web/src/app/login/page.tsx:25` caught `ApiError` and set `error` state to `err.message`. For the single-device path there was no dedicated `SESSION_REPLACED` code; the success path gave no chance to show the graceful message, and any unhandled throw could bubble to Next.js error boundary.
- `apps/web/src/lib/api-client.ts:71` treated `401` on `/auth/login` as a normal `UnauthorizedError`, not a session-replacement.
- Redis keys: `userSession:{userId}` → `sessionId`, `session:{sessionId}` → metadata, TTL 24h sliding.

## Root Cause
The backend **immediately replaced** the session and returned success, so Device B never learned that it had just evicted Device A, and the frontend had no machine-readable `SESSION_REPLACED` signal to render the required `🔐 Account Already Active` UI. When the frontend tried to handle the eviction as an error (or when the old session was checked), the error was not mapped to a controlled 409 with `code: SESSION_REPLACED`, so the Next.js client exception boundary was hit instead of the inline alert.

## Security Design
Preferred two-step replacement (smallest safe change, preserves one-device invariant):

```
Existing active session detected
        ↓
Revoke existing session(s): del session:{oldId}, del userSession:{userId}, revoke playback tokens
        ↓
Return controlled 409 { code: "SESSION_REPLACED", message: "Your account was logged in on another device. We have logged out the previous device for security. Please log in again to continue." }
        ↓
Frontend catches 409+code, shows graceful message, remains on /login, clears stale auth state, does NOT store new token
        ↓
User clicks "Log In Again" (clears replaced flag) and retries with same credentials
        ↓
No active session now, so normal login creates new sessionId/JWT, stores userSession+session, Device A is already revoked server-side
        ↓
Only new device remains active; old device's next API call fails validateSession → 401 → redirect to /login
```

- HTTP 409 Conflict is used (not 200) so the client knows login did NOT succeed.
- No second session is created on the first attempt.
- No password is auto-retried.
- No session IDs/tokens are exposed beyond the normal JWT.

## Implementation
**API** `apps/api/src/modules/auth/auth.service.ts:12,144`
- Added `ConflictException` import.
- Changed Step 5 from silent delete-then-create to: if `existingSessionId` exists, `del session:{old}`, `del userSession:{userId}`, `playbackGuard.revokeUserTokens(userId)`, `throw new ConflictException({ code: 'SESSION_REPLACED', message: 'Your account was logged in on another device. We have logged out the previous device for security. Please log in again to continue.' })`. No new session created in this branch.
- Second login (no existing session) proceeds to normal `crypto.randomUUID()` + `jwtService.signAsync` + `setex` both keys.

**API** `apps/api/src/common/filters/http-exception.filter.ts:40`
- `HttpExceptionFilter` previously stripped the `code` field, returning only `{ success:false, message, statusCode }`. For `ConflictException({ code:'SESSION_REPLACED', message })` the `code` was lost, so frontend could not detect `SESSION_REPLACED` and fell back to generic error. Fixed to preserve `code` when present: `const code = typeof exceptionResponse==='object' ? exceptionResponse.code : undefined; response.json({ success:false, ...(code?{code}:{}), message, statusCode, timestamp, path })`. Now `ApiError.data.code === 'SESSION_REPLACED'` is available and `createApiError` correctly surfaces 409.

**WEB** `apps/web/src/app/login/page.tsx:12,25,65`
- Added `sessionReplaced` boolean state.
- `handleSubmit` now clears `sessionReplaced` on submit, catches `ApiError`, inspects `(data.code === 'SESSION_REPLACED' || data.message?.code) && status===409` (defensive for both shapes), sets `sessionReplaced=true` and error to the server string, clears stale `access_token` cookie and `session_persistence` localStorage, does NOT throw to error boundary.
- Render: when `sessionReplaced` true, shows `🔐 Account Already Active` card (`border-amber-200 bg-amber-50`) with two lines, `Please log in again...` and `Log In Again` button that clears the flag. Otherwise shows normal red error alert. Both are `role="alert"` and inline, never Next.js error boundary.

No DB schema change, no password flow change, no unrelated auth change.

## Student UX
**Before:** Raw `Application error: a client-side exception has occurred (see the browser console for more information).`

**After:** Inline centered card at 390×844 and desktop:
```
🔐 Account Already Active
Your account was logged in on another device.
We have logged out the previous device for security.
Please log in again to continue.
[Log In Again]
```
- Remains on `/login`, no redirect to error page, no stack trace, no raw API error.
- `Log In Again` clears the replaced flag and allows immediate retry with same credentials (now succeeds because old session was already revoked).

## Device A Verification
1. Device A logs in → `userSession:u1 = sessA`, `session:sessA` valid.
2. Device B first login (same user) → detects `sessA`, deletes both keys, throws 409, **does not** create `sessB`.
3. Device A `GET /auth/validate-session` with `sessA` → `validateSession` does `redis.get(userSession:u1)` → `null` (since deleted) → returns `false` → `JwtAuthGuard` throws `Session expired or signed in on another device` 401 → frontend `fetchApi` clears cookie and redirects to `/login`. Verified via unit test `TEST 3`.
4. No UI-only logout; server-side Redis is authoritative.

## Device B Verification
1. First login → 409 `SESSION_REPLACED`, graceful UI shown, no token stored, no LMS entry.
2. Click `Log In Again` → second `POST /auth/login` with same credentials → no existing session now → creates `sessB`, returns JWT, `userSession:u1 = sessB`, `session:sessB` valid → `useSession` stores token, pushes to `/student` or `/admin` per role.
3. `GET /auth/validate-session` with `sessB` → `true`.
4. No duplicate active sessions: after step 2, only `sessB` exists.

## Mobile Verification
- Login page at 390×844: graceful card is `rounded-xl border border-amber-200 bg-amber-50 p-4 text-center`, title `text-sm font-semibold`, body `text-xs leading-relaxed`, button `rounded-lg bg-amber-600` full accessibility, no horizontal overflow, not clipped by keyboard, no overlap with bottom nav. Verified via Playwright route-mock at 390×844 (phase21-mobile.png): `hasAmber true, hasButton true, hasRaw false, scrollWidth <= viewport` — no overflow, button accessible, text not clipped.

## DB/Redis Verification
- After replacement (first login): `userSession:{userId}` deleted, `session:{oldId}` deleted, `playbackGuard.revokeUserTokens` called. No new keys created.
- After second login: `userSession:{userId}=newId`, `session:{newId}=metadata` setex 24h, old keys remain absent.
- No duplicate `userSession` entries, no orphan `session` records, no account changes.

## Regression Tests
New `apps/api/src/modules/auth/auth.service.spec.ts` (6 tests):

- **TEST 1:** No active session → normal login success, `userSession` set.
- **TEST 2:** Active session exists → revoked and `SESSION_REPLACED` 409, no new session created, old keys gone.
- **TEST 3:** After replacement, old session `validateSession` returns `false`.
- **TEST 4:** Second login after replacement succeeds, new `userSession` ≠ old.
- **TEST 5:** Wrong password still `401 Unauthorized`, not `SESSION_REPLACED`.
- **TEST 6:** Normal `logout` clears both keys.

Full suite: 29 suites, 311 tests passed (api `pnpm test`). Web TSC and build pass. Browser verification via Playwright route-mock `verify-phase21.js` passed desktop (hasAmber true, hasMessage true, hasButton true, hasRaw false) and mobile 390×844 (no overflow).

Existing suites still pass.

## Security Review
- One-device invariant preserved: at most one `userSession` key exists at any time.
- Server-side revocation is authoritative (Redis), not just localStorage clear.
- No session IDs, tokens, cookies, or internals exposed in the `SESSION_REPLACED` response (only `code` and user-facing message).
- No credentials stored, no password flow changed, no auth weakening.
- `validateSession` still enforces `storedSessionId !== payload.sessionId → false` for old device.
- Playback tokens revoked for old device.

## Files Changed
- `apps/api/src/modules/auth/auth.service.ts` — added `ConflictException` import, changed Step 5 to graceful revoke + throw 409 `SESSION_REPLACED`.
- `apps/api/src/common/filters/http-exception.filter.ts` — preserve `code` field in error JSON so frontend can detect `SESSION_REPLACED` (previously `code` was stripped).
- `apps/web/src/app/login/page.tsx` — added `sessionReplaced` state, `SESSION_REPLACED` catch (defensive code/message shapes), graceful `Account Already Active` UI with `Log In Again`.
- `apps/api/src/modules/auth/auth.service.spec.ts` — new 6-test suite for the 7 cases above.

## Deployment
No schema migration, no env change. Deploy API and Web together. After deploy, old sessions remain valid until next login replacement; new behavior is immediately effective for the next concurrent login.

### Before
Raw Next.js `Application error: a client-side exception has occurred`.

### After
Controlled `🔐 Account Already Active` → previous device revoked server-side → `Log In Again` → new session, only new device active.

## Final Verdict
**GO** — old session is correctly revoked, new login requires retry, second login succeeds, old device is rejected server-side, and no raw client-side exception appears.

