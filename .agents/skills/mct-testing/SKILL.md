---
name: mct-testing
description: How to run and write tests in this repo (Jest unit, Playwright E2E projects, DB verification, no fake tests). Use when writing tests or verifying changes.
---

# Skill: MCT LMS — Testing

## Purpose
Keep the safety net honest: API + DB + browser verification for critical workflows.

## Commands
```bash
pnpm --filter api test        # Jest unit suites (must be 100% green before delivery)
cd apps/api && npx tsc --noEmit
pnpm test:e2e                 # full Playwright (workers=1)
pnpm test:e2e:api             # E2E minus browser-UI specs
pnpm test:e2e:browser         # browser-UI specs only
pnpm build                    # all workspaces
```
Prereqs for E2E: Redis up (`docker compose up -d redis`), `tests/e2e/.env` filled (SUPABASE_URL/SERVICE_ROLE, API_URL, admin/student creds). E2E is STATEFUL against the real Supabase project and self-cleans (global afterAll removes orphans).

## Architecture
- Playwright config: two projects — `recordings-api` (`tests/e2e/recordings/*`) and `assessments-api` (`tests/e2e/assessments/*`); webServer auto-starts API from `apps/api/dist` (build first!) + Next dev on :3000.
- Fixtures: `fixtures/recordings-fixture.ts`, `assessments-fixture.ts`; helpers in `utils/` (seed, factories, db-helpers, login-helpers, assertions).
- Known flake: `assessments/browser-ui.spec.ts` "student can complete an attempt" (fixed 800 ms wait) fails intermittently/pre-existing — verify unrelated failures against this list before blaming your change.

## Rules
- **No fake tests:** a spec that only asserts HTTP 200 is not a test. Assert response body shape, DB row effects, and authorization denials (401/403 paths).
- Critical workflow coverage ideal: API assertion → DB verification (query Supabase directly via db-helpers) → browser behavior where user-visible.
- Unit tests mock the Supabase client chain (see `mockChain()` in recordings.service.spec) and external SDKs; network must never leak from unit tests.
- Security cases are mandatory for any new endpoint: wrong role 403, cross-user 403, cross-batch/IDOR 403, expired token 401.

## Verification
Before reporting done: full unit suite green + affected E2E project green + typecheck + build. Report exact numbers (suites/tests) like prior RCCF reports.

## Do Not
- Do not weaken assertions to make suites pass.
- Do not run destructive SQL "to fix" e2e data — use the fixtures/cleanup helpers.
