---
name: mct-api-development
description: NestJS API conventions specific to this repo (controller→service→Supabase, DTO validation, response envelope, transactions, pagination, N+1 avoidance). Use when writing or reviewing any apps/api code.
---

# Skill: MCT LMS — API Development

## Purpose
Write backend code that matches this repository's established patterns.

## Architecture
`Controller (@Roles, DTO validation pipe) → Service (all business logic; Supabase via SupabaseService.client) → DB`. No separate repository layer. Cron jobs in `src/jobs/*` use the same services.

## Conventions (with repo examples)
- **Response envelope:** `ResponseTransformInterceptor` wraps every return as `{success:true,data}`. Controllers return raw data. Exceptions handled by `HttpExceptionFilter`.
- **DTOs:** class-validator decorators on every payload (`apps/api/src/modules/**/dto/*`). Never trust `body` directly.
- **Tables:** always `TABLES.X` from `common/constants/tables.constant.ts`; columns are snake_case.
- **Authorization:** `@Roles('admin')` on admin routes + service-level ownership/batch checks (`validateAccess()` pattern in recordings.service).
- **Transactions:** multi-step writes use `common/utils/transaction.util.ts` (`TransactionStep[] {name, execute, rollback}`) — see `createRecordingWithUpload`. Rollback deletes child rows before parents.
- **Pagination:** `{page, limit}` + count query (`Prefer: count=exact` pattern) returning `{items,total,page,limit}` — see recordings.findAll.
- **N+1 avoidance:** batch-fetch related rows with `.in('fk', ids)` then map in memory (recordings list builds batchNames map this way).
- **Webhooks:** `@Public()`, verify signature against `req.rawBody`, never throw at provider (except Bunny auth failures which 401), log-and-continue semantics per provider contract.
- **Errors:** BadRequest/NotFound/Forbidden/ServiceUnavailable from @nestjs/common; 503 = "configured-but-failing dependency" (BunnyProvider pattern), never a silent fallback.

## Database Contracts
Verify before writing persistence code: `node scripts/check-supabase-schema.js <table>` prints live columns (reads information_schema via REST using apps/api/.env). CHECK constraints live in `scripts/migrations/*.sql`.

## Common Failure Modes
| Mistake | Fix |
|---|---|
| camelCase column names | snake_case in `.select/.insert/.update` |
| Guard-only security | add service-level ownership/batch checks |
| Sequential await loops over rows | single `.in()` fetch + Map join |
| Returning entities with secrets | whitelist returned fields explicitly |
| Writing 'error' status | canonical statuses only ('processing'|'ready'|'failed') |

## Verification
Every new endpoint: unit spec (mock Supabase chain like recordings.service.spec) + typecheck (`pnpm --filter api exec tsc --noEmit`) + exercise against dev DB.

## Do Not
- Do not add a second place that talks to Mux/Bunny/Zoom APIs (chokepoint services only).
- Do not return untyped `any` payloads from controllers.
