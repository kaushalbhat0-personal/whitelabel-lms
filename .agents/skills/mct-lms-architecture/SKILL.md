---
name: mct-lms-architecture
description: Repository architecture map for the Money Craft Trader LMS monorepo. Use when orienting in this repo, locating code, understanding stack boundaries, or before any cross-cutting change.
---

# Skill: MCT LMS — Repository Architecture

## Purpose
Single entry point describing what lives where in `lms-platform/`. Read this before touching anything unfamiliar.

## Stack (verified, not assumed)
| Layer | Technology |
|---|---|
| Web | Next.js 14 App Router, React 18, Tailwind, zustand, hls.js 1.x, `@supabase/ssr`, sonner, react-hook-form + zod |
| API | NestJS 10 (port 3001), `@supabase/supabase-js` service-role, ioredis via `@liaoliaots/nestjs-redis`, axios, `@mux/mux-node`, @nestjs/schedule |
| DB | Supabase Postgres — **snake_case tables/columns**; migrations in `scripts/migrations/*.sql` are authoritative |
| Cache/sessions | Redis (docker-compose, password from env) |
| Video | Mux (Batch 1) + Bunny Stream (Batch 2+) behind a provider abstraction |
| Live classes | Zoom (Webinar + SDK + webhooks), canonical table `live_sessions` |
| Tests | Jest unit (`apps/api`), Playwright E2E (`tests/e2e`) |
| Deploy assumptions | Vercel (web, see `vercel.json`), API runs long-lived Node process (cron jobs need it); Redis reachable; rawBody preserved in `main.ts` |

## Map
```
lms-platform/
  apps/
    api/src/
      modules/<domain>/        controller → service → spec per domain
        video-provider/        Phase 7B/7C: MuxProvider, BunnyProvider,
                               RecordingProviderResolver, BunnyWebhookController
        mux/                   MuxService = ONLY place talking to Mux API
        recordings/            admin CRUD + student playback authorization
        playback/              PlaybackGuardService (Redis tokens)
        live-sessions/ zoom/   canonical sessions + Zoom integration/webhooks
        tests/ attempts/ questions/ evaluation/ results/ analytics/   assessments
        auth/ users/ devices/  login, JWT, sessions, device list
        payments/ invoices/    finance
        batch-curriculum/      curriculum sync + reconciliation
      common/                  guards, decorators, interceptors, TABLES & REDIS_KEYS constants
      jobs/                    cron: recording-upload (Zoom→provider), recording-cleanup
    web/src/
      app/admin/*              dashboard, students, finance, recordings, tests,
                               review-queue, violations, analytics, sessions…
      app/student/*            dashboard, courses, videos/[recordingId] (HLS player),
                               tests/attempt|result, live-sessions, profile
      components/player/       QualityMenu, VideoControls (hls.js)
      lib/api-client.ts        fetchApi(): cookie token → Bearer, unwraps {success,data}
      stores/auth.store.ts     zustand client auth state
      middleware.ts            cookie/JWT route gating
  packages/shared-types/       shared TS enums/types (@lms/shared-types)
  scripts/
    schema.sql                 ⚠ STALE/PARTIAL — do not trust as current schema
    migrations/004…035         AUTHORITATIVE schema history (035 = recordings.provider)
    check-supabase-schema.js   live column introspection via PostgREST information_schema
  tests/e2e/                   Playwright (projects: recordings-api, assessments-api)
  docs/                        RCCF reports + docs/testing/*
```

## Authoritative knowledge sources (in priority order)
1. Source code + tests
2. Live DB (`scripts/check-supabase-schema.js`, read-only REST)
3. `CLAUDE.md` (repo root conventions)
4. RCCF reports: `docs/rccf-phase7c-bunny-verification-report.md`,
   `rccf-phase7a-mux-bunny-audit.md`, `rccf-phase6b-live-classes-migration-blueprint.md`,
   `rccf-phase6-live-classes-audit.md`, `rccf-single-mount-layout-report.md`,
   `production-freeze-assessments.md`, `docs/testing/*`

## Rules
- Tables are referenced ONLY via `TABLES` constant (`common/constants/tables.constant.ts`). Never inline table names.
- All Redis keys/TTLs come from `REDIS_KEYS` / `REDIS_TTL` constants. Never hand-build key strings.
- Global Nest pipes/guards: `JwtAuthGuard` → `RolesGuard` (global) → `ResponseTransformInterceptor` wraps everything as `{success, data}`.
- `@Public()` decorator bypasses JWT guard (webhooks, health).
- The legacy `modules/videos/` module is dead code (not imported by AppModule). Do not extend it.

## Do Not
- Do not treat `scripts/schema.sql` as the live schema.
- Do not add a dependency without checking it is already used in the relevant workspace package.json.
- Do not assume camelCase columns — DB is snake_case; services translate at the boundary.

## Verification
After orientation changes, confirm claims with: file reads + `node scripts/check-supabase-schema.js <table>` + test runs.
