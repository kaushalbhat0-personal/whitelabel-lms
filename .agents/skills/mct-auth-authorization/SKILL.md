---
name: mct-auth-authorization
description: MCT LMS authentication and authorization chain (JWT, httpOnly cookie, Redis single-device sessions, RolesGuard, batch isolation). Use when touching login, guards, roles, cookies, session validation, device handling, or any student/admin data access.
---

# Skill: MCT LMS — Auth & Authorization

## Purpose
Institutional knowledge of the full auth chain and the bugs already fixed so they are never reintroduced.

## Architecture
```
Login:  POST /auth/login (rate-limited per-IP via Redis ratelimit:login:<ip>, 15-min window)
        → verify password (Supabase profiles) 
        → SINGLE-DEVICE ENFORCEMENT: existing user_session:<userId> is invalidated
        → JWT signed { sub, sessionId, role } + Redis session store (24h TTL)
        → httpOnly cookie `access_token` set by API; web never stores token in JS storage
Web:    middleware.ts reads cookie/decodes JWT for path gating (/student/* needs role=student)
        fetchApi() (lib/api-client.ts): reads access_token cookie → Authorization: Bearer
          → unwraps {success,data}; typed ApiError subclasses (401/403/404/500)
API:    JwtAuthGuard (global) → request.user {id, role, sessionId}
        RolesGuard (global, runs after JWT): @Roles('admin'|'teacher'|'student')
          NO @Roles() = ANY authenticated user — always add @Roles on admin routes
        Ownership/batch checks live in SERVICES, not guards.
```

## Important Files
`apps/api/src/modules/auth/auth.service.ts` · `common/guards/jwt-auth.guard.ts`, `roles.guard.ts` · `common/decorators/{public,roles,current-user}.decorators` · `apps/web/src/middleware.ts`, `lib/api-client.ts`, `lib/auth-token.ts`, `stores/auth.store.ts`

## Database Contracts
- `profiles.role TEXT CHECK (role IN ('admin','teacher','student'))`
- **There is NO `profiles.batch_id`.** Batch membership lives ONLY in `batch_students(user_id, batch_id)`. (Phase 4 fixed a bug caused by assuming otherwise.)
- `user_devices`, `login_alerts` power the profile/device list.

## Rules
- Batch authorization single source of truth:
  - Recordings → `recording_batches` ONLY (`validateAccess()` in recordings.service). `batch_recording_curriculum` is display/progress only — NEVER an auth source.
  - Tests → `test_batches`; Live sessions → `session_batches` (+ registrants).
- Cross-user protection pattern: compare `request.user.id` to the row owner before any read/write of another user's data (attempts, results, devices, progress).
- Single-device enforcement is intentional. Do not "fix" concurrent logins by removing it.
- Logout must invalidate the Redis session, not just clear the cookie.
- Playback/video URLs are issued only through PlaybackGuardService — see skill `mct-video-pipeline`.

## Common Failure Modes (already happened once)
| Bug | Root cause | Prevention |
|---|---|---|
| P0 login broken (Phase 4) | token kept where JS couldn't read it / httpOnly mismatch | Token flows httpOnly cookie → Bearer server-side via api-client; don't move it to localStorage |
| Student saw admin data | route missing `@Roles()` | Every admin controller method carries `@Roles('admin')` |
| Duplicate attempt POSTs (single-mount era) | two React trees each firing effects | one content mount — see skill `mct-student-portal` |
| Cross-batch leak risk | filtering by curriculum table instead of recording_batches | always gate via the canonical mapping table |

## Verification
- Unit: auth/users/devices specs under `apps/api/src/modules/**`.
- E2E security specs: `tests/e2e/recordings/security-edge-cases.spec.ts`, `assessments/security.spec.ts`.
- Manual: wrong-role access must 403; cross-user id must 403; expired Redis session must 401.

## Do Not
- Never add a second auth mechanism (header tokens in localStorage, query-token auth).
- Never trust client-sent userId — always derive from JWT.
- Never bypass ResponseTransformInterceptor except for provider webhooks that require exact payloads (Zoom url_validation).
