---
name: mct-lms-architecture
description: Repository architecture map for the White-Label LMS product. Use when orienting in this repo, locating code, understanding stack boundaries, or before any cross-cutting change.
---

# Skill: White-Label LMS — Repository Architecture

## Purpose
Single entry point describing what lives where in this repo. Read this before touching anything unfamiliar. For client onboarding, deployment factory, and environment ownership, see skill `white-label-deployment` instead — this skill maps code, that skill maps deployments.

## Product model (frozen)
White-Label LMS ships as **ONE CODEBASE → ONE DEPLOYMENT → ONE CLIENT**. Each client gets an independent web deployment, API deployment, PostgreSQL/Supabase database, Redis instance, storage, video/provider/email configuration, secrets, BusinessConfig row, and client data on client-owned infrastructure. There is no multi-tenancy: no `tenant_id`, no `organization_id`, no `client_id`, no shared runtime, no central tenant control plane.

## Stack (verified, not assumed)
| Layer | Technology |
|---|---|
| Web | Next.js 14 App Router, React 18, Tailwind, zustand, hls.js 1.x, `@supabase/ssr`, sonner, react-hook-form + zod |
| API | NestJS 10 (port 3001), `@supabase/supabase-js` service-role, ioredis via `@liaoliaots/nestjs-redis`, axios, `@mux/mux-node`, @nestjs/schedule |
| DB | Supabase Postgres — **snake_case tables/columns**; migrations in `scripts/migrations/001→041` are authoritative; RLS default-deny |
| Cache/sessions | Redis (deployment-scoped instance; local dev via docker-compose) |
| Video | Bunny default for all new uploads (`VIDEO_UPLOAD_PROVIDER`), Mux dormant/rollback-capable behind the provider resolver (Phase 7E policy — batch-based routing is retired) |
| Live classes | Zoom (Webinar + SDK + webhooks), canonical table `live_sessions`; `ZOOM_ENABLED=disabled` = recorded-only (intentional 503, not a bug) |
| Deployment policies | `SESSION_POLICY` (default single), `PASSWORD_MANAGEMENT` (default enabled), `TEMP_DEMO_ACCESS` (default absent), `ZOOM_ENABLED` (default enabled) — see skill `white-label-deployment` |
| Tests | Jest unit (`apps/api`), Playwright E2E (`tests/e2e`), factory tests (`pnpm factory:test`), marketing tests |

## Map
```
white-label-lms/
  apps/
    api/src/
      modules/<domain>/        controller → service → spec per domain
        video-provider/        RecordingProviderResolver, Bunny/Mux providers, BunnyWebhookController
        mux/                   MuxService = ONLY place talking to Mux API
        recordings/            admin CRUD + student playback authorization
        playback/              PlaybackGuardService (Redis tokens)
        live-sessions/ zoom/   canonical sessions + Zoom integration/webhooks
        tests/ attempts/ questions/ evaluation/ results/ analytics/   assessments
        auth/ users/ devices/  login, JWT, sessions, device list
        payments/ invoices/    finance (BusinessConfig-driven prefixes/tax)
        business-config/       singleton row per deployment (identity/presentation, never secrets)
        batch-curriculum/      curriculum sync + reconciliation
        demo-access/           TEMP_DEMO_ACCESS-gated temporary accounts (endpoint 404s unless enabled)
      common/constants/        TABLES, REDIS_KEYS, TTLs + policy resolvers (session/password/demo-access/zoom-enabled)
      jobs/                    cron: recording-upload (Zoom→provider), recording-cleanup
    web/src/
      app/admin/*              dashboard, students, finance, recordings, tests,
                               review-queue, sessions…
      app/student/*            dashboard, courses, videos/[recordingId] (HLS player),
                               tests/attempt|result, live-sessions, profile
      lib/api-client.ts        fetchApi(): cookie token → Bearer, unwraps {success,data}
  packages/shared-types/       shared TS enums/types (@lms/shared-types)
  scripts/
    migrations/001→041        AUTHORITATIVE schema history (never edit old files; new columns = new migration)
    generated/                 deterministic `fresh-supabase-init.sql` rebuild (`pnpm db:generate`)
    deployment-factory/        client onboarding: init → validate → generate → secret-scan →
                               first-admin → push-config → verify → handoff (never touches infra APIs)
  apps/marketing/              SEPARATE static app (`output: 'export'`); hyperlink-only demo coupling,
                               no LMS runtime/Supabase/Redis/secret imports — see skill white-label-deployment
  tests/e2e/                   Playwright (projects: recordings-api, assessments-api, auth-logout)
  docs/                        RCCF reports + docs/testing/* (historical MCT-era reports remain as history)
```

## Authoritative knowledge sources (in priority order)
1. Source code + tests
2. `CONFIG_OWNERSHIP.md` (BusinessConfig vs ENV vs Core vs Data ownership)
3. Skill `white-label-deployment` (factory, policies, isolation)
4. RCCF reports in `docs/` (historical evidence; MCT-era names are history, not current product)

## Rules
- Tables are referenced ONLY via `TABLES` constant (`common/constants/tables.constant.ts`). Never inline table names.
- All Redis keys/TTLs come from `REDIS_KEYS` / `REDIS_TTL` constants. Never hand-build key strings.
- Global Nest pipes/guards: `JwtAuthGuard` → `RolesGuard` (global) → `ResponseTransformInterceptor` wraps everything as `{success, data}`.
- `@Public()` decorator bypasses JWT guard (webhooks, health). Resend webhooks additionally fail closed without `RESEND_WEBHOOK_SECRET`.
- Do not assume camelCase columns — DB is snake_case; services translate at the boundary.
- Deployment identity (origins, secrets, provider accounts, policies) comes from ENV + the client's own infrastructure — never from source literals. Source changes per client = 0.

## Verification
After orientation changes, confirm claims with: file reads + factory `preflight` + test runs. Never treat `scripts/schema.sql` as live schema (stale reference).

## Do Not
- Do not introduce tenant concepts, shared-runtime clients, or a central control plane.
- Do not add a dependency without checking it is already used in the relevant workspace package.json.
- Do not put secrets in BusinessConfig or demo/client data in migrations.
