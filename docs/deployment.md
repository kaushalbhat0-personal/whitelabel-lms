# Deployment

## Prerequisites
- Node.js 20+
- pnpm 8+
- Docker & Docker Compose

## Local Development
```bash
pnpm install
docker-compose up -d   # Redis & dev services
pnpm --filter @lms/api start:dev
pnpm --filter @lms/web dev
```

## Environment Variables
Copy `.env.example` to `.env` and fill in Supabase, Zoom, and Mux credentials.

## Production Build
```bash
pnpm --filter @lms/api build
pnpm --filter @lms/web build
```

## Fresh Client Database (Supabase)

**Source of truth:** `scripts/migrations/001_initial_schema.sql → 039_theme_json.sql` (canonical, `IF NOT EXISTS` idempotent).

**Generated artifact (do not edit):** `scripts/generated/fresh-supabase-init.sql` — deterministic concatenation of `001`→`039` in numeric order.

**Ownership rule:**

```
scripts/migrations/*.sql      AUTHORITATIVE SOURCE
scripts/generated/fresh-supabase-init.sql  GENERATED DEPLOYMENT ARTIFACT — DO NOT EDIT
```

**Workflow for each new client Supabase project:**

1. Create a new Supabase project (empty `public` schema).
2. Generate the latest initialization SQL (if migrations changed):
   ```bash
   pnpm db:generate
   ```
   Verify determinism: `sha256sum scripts/generated/fresh-supabase-init.sql` (run twice → identical).
3. Open Supabase Dashboard → SQL Editor → New Query.
4. Copy the **complete** `scripts/generated/fresh-supabase-init.sql` (≈120 KB, 39 migrations, `001_initial_schema.sql` → `039_theme_json.sql`).
5. Paste and **Run**. The SQL is safe for a fresh empty database (`IF NOT EXISTS`, no `DROP`).
6. Verify: run the verification queries in the `DATABASE VERIFICATION (runbook)` section below (expected: ~67 public tables, `business_config` 0 rows, `theme_json` column exists, `achievement_definitions` 5 rows).
7. The database is now initialized (0 application rows; `achievement_definitions` 5 reference rows from `017`).

**Future schema change:** Add `040_some_change.sql` to `scripts/migrations/`, then `pnpm db:generate` regenerates `fresh-supabase-init.sql` to `001→040`. Existing client DBs run only the new `040` via SQL Editor; new clients run the full `001→040` artifact.

**Drift check (CI/local):**
```bash
pnpm db:generate
git diff --exit-code -- scripts/generated/fresh-supabase-init.sql
```
Fails if migrations changed but artifact not regenerated.

**Destructive helper:** `scripts/dev/reset-sessions.sql` (`DELETE FROM sessions`) is **not** part of `001→039` and must never be pasted into a client database.

---

# Client Deployment Runbook (RCCF-DEPLOY-02) — CANONICAL

> **Model: ONE CODEBASE → ONE CLIENT DEPLOYMENT → ONE CLIENT DATABASE → ONE CLIENT INFRASTRUCTURE.**
> Client #1, #2, #3 are the same process; only infrastructure credentials and BusinessConfig change.
> NO source-code fork, NO `tenant_id`, NO source-code branding edits, NO shared database, NO provisioning system.
> Do NOT commit `.env`. Never paste secrets into GitHub. Never put secrets in generated SQL or docs.

## 0. PRE-FLIGHT (operator machine)

| ACTION | EXPECTED RESULT | FAILURE SIGNAL |
|---|---|---|
| `node --version` (20+), `pnpm --version` (8+) | versions print | install Node 20+ / pnpm 8+ first |
| `git status --short` clean-or-known-dirty; `git rev-parse HEAD` | known state, no surprise diffs | stop, reconcile with repo owner |
| `npx tsx scripts/generate-fresh-sql.ts` twice; compare SHA256 | identical hash both runs | migrations edited without regen — regen and re-verify |
| `git diff --exit-code -- scripts/generated/fresh-supabase-init.sql` | exit 0 (artifact current) | run generator, review diff |

## 1. DATABASE — fresh client Supabase

| # | ACTION | EXPECTED RESULT | FAILURE SIGNAL |
|---|---|---|---|
| 1 | Supabase dashboard → New project (client-owned). Note project URL + anon key + service-role key (dashboard → Project Settings → API). Keep the **admin access token** in local admin tooling only | project `ACTIVE_HEALTHY` | — |
| 2 | Confirm `public` schema is empty (SQL Editor: `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` → small Supabase-managed count, **no** `business_config/profiles/courses`) | fresh DB | LMS tables already present → STOP, do not overwrite; escalate |
| 3 | `pnpm db:generate` (body: `tsx scripts/generate-fresh-sql.ts`) | `scripts/generated/fresh-supabase-init.sql`, 39 migrations `001→039`, ~120 KB | count mismatch → migration added/removed; fix chain first |
| 4 | SQL Editor → New Query → paste **complete** `fresh-supabase-init.sql` → Run | success, no errors | first error aborts: capture exact message + statement; known fixed defects: `ADD CONSTRAINT IF NOT EXISTS` (001), duplicate trigger (002) — must already be fixed in repo |
| 5 | Run `DATABASE VERIFICATION` queries below | all expectations match | any mismatch → STOP, diagnose before proceeding |
| 6 | Storage → confirm `uploads` bucket exists, private | `uploads`, `public=false` | re-run 013/034/036 only |

### DATABASE VERIFICATION (runbook queries — Supabase SQL Editor)

```sql
-- 67 public base tables (exact count may grow only when migrations are added)
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE';
-- must-have tables (expect zero missing):
SELECT t FROM (VALUES ('business_config'),('profiles'),('courses'),('batches'),
 ('sessions'),('recordings'),('live_sessions'),('payments'),('tests'),
 ('test_attempts'),('certificates'),('achievement_definitions'),('notifications')) v(t)
WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
 WHERE table_schema='public' AND table_name=v.t);
-- fresh-state rows:
SELECT (SELECT count(*) FROM business_config) AS business_config,   -- expect 0
       (SELECT count(*) FROM profiles) AS profiles,                 -- expect 0
       (SELECT count(*) FROM courses) AS courses,                   -- expect 0
       (SELECT count(*) FROM batches) AS batches,                   -- expect 0
       (SELECT count(*) FROM payments) AS payments,                 -- expect 0
       (SELECT count(*) FROM achievement_definitions) AS achdefs;   -- expect 5
-- theme column:
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='business_config' AND column_name='theme_json';
-- expect: theme_json | jsonb | YES
```

## 2. REDIS

| ACTION | EXPECTED RESULT | FAILURE SIGNAL |
|---|---|---|
| Local/dev: `docker compose up -d` (repo root; service `redis`, `redis:7-alpine`, port `6379`, password `localredis` per `docker-compose.yml`) | `redis-cli -a localredis ping` → `PONG` | Docker daemon down → start Docker first |
| API env: `REDIS_HOST` (default `127.0.0.1`), `REDIS_PORT` (default `6379`), `REDIS_PASSWORD` (no default — must match server) | API boot log shows no prolonged `ECONNREFUSED` loop | password/host mismatch |
| Production: client-managed Redis (any host) **or** managed provider (e.g. Upstash). No specific paid provider required | session/login/attempt-timer paths work | — |

Redis is **not** required for API boot or `/health`; it **is** required for login/sessions and any authenticated write path. Health stays green without Redis by design.

## 3. API (Render) — proven contract (DEPLOY-01)

| Setting | Value |
|---|---|
| Service root directory | `apps/api` (CWD must be `apps/api` — `.env` is loaded from CWD via `envFilePath: '.env'`) |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @lms/api build` |
| Start command | `node dist/apps/api/src/main.js` |
| Health check | `GET /health` → 200 (canonical). `GET /` → 200 (compatibility, also used by e2e harness) |
| Port | `PORT` (default `3001`) |

Do NOT use `node dist/main` (stale — that file is never emitted). Do NOT invent `render.yaml`; configure the above in the Render dashboard.

## 4. WEB (Vercel)

| Setting | Value |
|---|---|
| Repo `vercel.json` | `{ "framework": "nextjs" }` only — set **Root Directory = `apps/web`** in the Vercel project dashboard (monorepo); defaults for build (`next build`) otherwise |
| Framework | Next.js 14 App Router. No `next.config.*` in repo — defaults apply |
| Runtime web env (Vercel → Project Settings → Environment Variables) | `NEXT_PUBLIC_API_URL` (= public Render API URL), `NEXT_PUBLIC_SUPABASE_URL` (= client Supabase URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (= client anon key). All three are **build-time baked** — changing them requires redeploy |
| Data flow | Browser → Vercel web → `NEXT_PUBLIC_API_URL` → Render API → client Supabase. Vercel never hosts the NestJS API |

## 5. ENV CONTRACT (authoritative — derived from code, not guessed)

### Render API — REQUIRED (boot fails or auth breaks without these)

| Key | Evidence |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | `apps/api/src/common/services/supabase.service.ts:32-40` throws if any missing |
| `JWT_SECRET` | `app.module.ts:88` — no default; auth unusable without it |
| `FRONTEND_URL` | `main.ts:31` CORS origin — **must equal the deployed Vercel origin** (never leave as `https://example.com`) |
| `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` | `app.module.ts:101-104` — required for sessions (defaults: `127.0.0.1`/`6379`/none) |

### Render API — OPTIONAL (safe defaults)

`PORT` (→3001), `JWT_EXPIRES_IN` (→24h), `EMAIL_FROM` (→Resend test sender), `EMAIL_REPLY_TO`, `VIDEO_UPLOAD_PROVIDER` (→bunny), `LIVE_SESSION_DEFAULT_HOST_ID`, `PUPPETEER_EXECUTABLE_PATH`, Bunny TTL tunables.

### Render API — PROVIDER-SPECIFIC (configure only when the client buys/enables the feature; all fail loudly at call time, never silently)

Zoom: `ZOOM_ACCOUNT_ID/_CLIENT_ID/_CLIENT_SECRET/_SDK_KEY/_SDK_SECRET/_WEBHOOK_SECRET` · Mux (dormant rollback): `MUX_TOKEN_ID/_TOKEN_SECRET/_SIGNING_KEY_ID/_PRIVATE_KEY/_WEBHOOK_SECRET` · Bunny: `BUNNY_ENABLED/BUNNY_LIBRARY_ID/BUNNY_API_KEY/BUNNY_CDN_HOSTNAME/BUNNY_TOKEN_SIGNING_KEY/BUNNY_WEBHOOK_SECRET` (unset `BUNNY_ENABLED` = disabled; uploads 503 `ServiceUnavailable`, never silent-fallback to Mux) · Resend: `RESEND_API_KEY` (missing = STUB MODE: emails logged, not sent), `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`.

### Vercel web — all three required at build time

`NEXT_PUBLIC_API_URL` (localhost fallback only for local dev), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web `lib/supabase/client.ts:9` throws if missing).

### ADMIN ONLY — never deploy to Vercel/Render runtime

**`SUPABASE_ACCESS_TOKEN_KEY` (or any `SUPABASE_ACCESS_TOKEN*`): DO NOT PUT INTO VERCEL OR RENDER ENV.** Zero references in `apps/` (verified by repo search) — it is Supabase-management tooling only and the runtime was proven to work without it (DEPLOY-01/DB-ARCH-06).

### Key-ownership summary

Service-role key → API server only, never browser. Anon key → browser allowed (public by design). Admin access token → local/CI admin tooling only. No hardcoded secrets anywhere.

## 6. CORS

Render `FRONTEND_URL` must exactly match the Vercel deployment origin (scheme + host, e.g. `https://client-lms.vercel.app`). Mismatch → browser calls blocked. `main.ts:32-35` allows only that single origin with credentials.

## 7. BRANDING (white-label — no source edits)

| Belongs in `business_config` row (via admin API/client onboarding, NOT in this runbook) | Belongs in ENV |
|---|---|
| `business_name`, `logo_url`, `favicon_url`, `currency`, `locale`, `timezone`, `theme_json {primary, sidebarBg, accent}` (served by `GET /business-config/public` with `DEFAULT_*` fallbacks; web renders fallbacks until configured) | `NEXT_PUBLIC_API_URL`, Supabase URLs/keys, `FRONTEND_URL`, provider credentials |

Empty `business_config` (0 rows) is the correct fresh state: API returns clean 404 `Business configuration not found` on direct reads; web layout/provider fall back to defaults and render. Never insert branding SQL by hand; never edit source for client identity.

## 8. PROVIDER MATRIX

| Provider | Core boot | Optional / paid | Demo behavior (nothing purchased) |
|---|---|---|---|
| Supabase (Postgres+Auth+Storage) | **REQUIRED** — only hard infra dependency besides Redis | free-tier project suffices for demo | full schema, 0 app rows |
| Redis | required for login/sessions; boot+health OK without | `docker compose up -d` local; managed in prod | anonymous/public paths work |
| Resend | no | paid/scale-gated | STUB MODE: logged, not sent |
| Zoom | no | client Zoom account | endpoints throw `...must be set...` only when called |
| Bunny | no (`BUNNY_ENABLED` unset = off) | client Bunny account | uploads 503 fail-visible; deletes treated as already-gone |
| Mux | no (dormant rollback) | client Mux account | lazy getters throw only if rollback enabled |
| Puppeteer | bundled Chromium launches at boot | `PUPPETEER_EXECUTABLE_PATH` for custom host | available; invoices/receipts PDFs work |

Zero-cost demo = Supabase free tier + local/Upstash-free Redis + stubbed email + no video-provider keys. Paid features degrade loudly, never silently.

## 9. VERIFICATION (post-deploy, per client)

| ACTION | EXPECTED RESULT | FAILURE SIGNAL |
|---|---|---|
| `GET https://<render-host>/health` | 200 `{"status":"ok","service":"lms-api",...}` | 502/504 → waking (free tier ~60s); persistent → check Render logs/start command/CWD |
| `GET https://<render-host>/` | 200 same contract | — |
| `GET https://<render-host>/business-config/public` (no token) | 401 envelope (guard working) | 500 → investigate; 200 → guard broken |
| Browser → Vercel URL | renders with default branding (no crash, no BusinessConfig row needed) | CORS error → fix `FRONTEND_URL`; API unreachable → check `NEXT_PUBLIC_API_URL` + redeploy web |
| Re-run §1 verification queries | same fresh-state expectations | drift → investigate before handover |

## 10. HANDOVER (per client)

Record (secret store, never git): Supabase project URL + keys location, Render service URL, Vercel URL, Redis endpoint, enabled providers, BusinessConfig values set, verification outputs. Confirm operator can repeat §0–§9 for the next client with only new credentials.

## 11. CLIENT #2 SIMULATION (conceptual — no infra created)

Client #2 = new Supabase project + new Redis + new Render service + new Vercel deployment + new ENV + new BusinessConfig row, same codebase, same `001→039` artifact, same build/start/health contract. **No source fork, no `tenant_id`, no branding edits, no shared database.** The only per-client variables are credentials, `FRONTEND_URL`/`NEXT_PUBLIC_API_URL` origins, provider keys, and BusinessConfig content.
