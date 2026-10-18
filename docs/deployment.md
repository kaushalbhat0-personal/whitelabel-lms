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

**Source of truth:** `scripts/migrations/001_initial_schema.sql → 040_security_rls_hardening.sql` (canonical, `IF NOT EXISTS` idempotent).

**Generated artifact (do not edit):** `scripts/generated/fresh-supabase-init.sql` — deterministic concatenation of `001`→`040` in numeric order.

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
4. Copy the **complete** `scripts/generated/fresh-supabase-init.sql` (≈129 KB, 40 migrations, `001_initial_schema.sql` → `040_security_rls_hardening.sql`).
5. Paste and **Run**. The SQL is safe for a fresh empty database (`IF NOT EXISTS`, no `DROP`).
6. Verify: run the verification queries in the `DATABASE VERIFICATION (runbook)` section below (expected: ~67 public tables, `business_config` 0 rows, `theme_json` column exists, `achievement_definitions` 5 rows).
7. The database is now initialized (0 application rows; `achievement_definitions` 5 reference rows from `017`).

**Future schema change:** Add `041_some_change.sql` to `scripts/migrations/`, bump `EXPECTED_COUNT`/`EXPECTED_LAST` in `scripts/generate-fresh-sql.ts`, then `pnpm db:generate` regenerates `fresh-supabase-init.sql` to `001→041`. Existing client DBs run only the new `041` via SQL Editor (see §14 Migration Operating Convention — backup first); new clients run the full `001→041` artifact.

**Drift check (CI/local):**
```bash
pnpm db:generate
git diff --exit-code -- scripts/generated/fresh-supabase-init.sql
```
Fails if migrations changed but artifact not regenerated.

**Destructive helper:** `scripts/dev/reset-sessions.sql` (`DELETE FROM sessions`) is **not** part of `001→040` and must never be pasted into a client database.

---

# Client Deployment Runbook (RCCF-DEPLOY-02) — CANONICAL

> **Model: ONE CODEBASE → ONE CLIENT DEPLOYMENT → ONE CLIENT DATABASE → ONE CLIENT INFRASTRUCTURE.**
> Client #1, #2, #3 are the same process; only infrastructure credentials and BusinessConfig change.
> NO source-code fork, NO `tenant_id`, NO source-code branding edits, NO shared database, NO provisioning system.
> Do NOT commit `.env`. Never paste secrets into GitHub. Never put secrets in generated SQL or docs.

> **Label legend used throughout:** **[REQUIRED]** = the deployment does not work without it. **[OPTIONAL]** = enable only if the client buys the feature; absence degrades loudly. **[PLAN-DEPENDENT]** = depends on the client's infra/provider plan. **[DEFERRED]** = intentionally out of scope. **[FUTURE]** = known improvement, not implemented (see §16).

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
| 3 | `pnpm db:generate` (body: `tsx scripts/generate-fresh-sql.ts`) | `scripts/generated/fresh-supabase-init.sql`, 40 migrations `001→040`, ~129 KB | count mismatch → migration added/removed; fix chain first |
| 4 | SQL Editor → New Query → paste **complete** `fresh-supabase-init.sql` → Run | success, no errors | first error aborts: capture exact message + statement; known fixed defects: `ADD CONSTRAINT IF NOT EXISTS` (001), duplicate trigger (002) — must already be fixed in repo. If the editor rejects the ~129 KB paste, split strictly on `-- Migration: NNN_` header boundaries and run in order, then re-run §1 verification |
| 5 | Run `DATABASE VERIFICATION` queries below | all expectations match | any mismatch → STOP, diagnose before proceeding |
| 6 | Storage → confirm `uploads` bucket exists, private; confirm `invoices` bucket exists, private (created canonically by migration 040, idempotent) | `uploads`, `invoices`, both `public=false` | bucket missing → apply migration 040 section only; never hand-create with public access |

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
-- RLS default-deny (migration 040): all app tables must report rowsecurity=true
SELECT count(*) AS rls_off_tables FROM pg_tables
 WHERE schemaname='public' AND tablename NOT LIKE 'pg_%' AND NOT rowsecurity;
-- expect: 0
-- no permissive policies on app tables:
SELECT count(*) AS open_policies FROM pg_policies
 WHERE schemaname='public' AND (qual LIKE '%true%' OR with_check LIKE '%true%');
-- expect: 0
-- invoices bucket (private, canonical since 040):
SELECT id, public FROM storage.buckets WHERE id IN ('uploads','invoices');
-- expect: uploads|false, invoices|false
-- fresh-state rows (invoices/receipts must also be 0):
SELECT (SELECT count(*) FROM invoices) AS invoices,   -- expect 0
       (SELECT count(*) FROM receipts) AS receipts;    -- expect 0
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
| Puppeteer Chrome cache **[REQUIRED on Render]** | `PUPPETEER_CACHE_DIR=/opt/render/project/src/apps/api/.puppeteer-cache` — Render discards the default user cache (`~/.cache/puppeteer`) between build and runtime, so the Chrome downloaded by the build-time `postbuild` step would be missing at runtime and all PDF generation would 500. Pointing the cache inside the project directory makes the binary persist into the deployed image. `PUPPETEER_EXECUTABLE_PATH` is only needed for custom hosts with their own Chromium (optional). |

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
| `JWT_SECRET` | `app.module.ts:88` — no default; auth unusable without it. **[REQUIRED — verify, do not assume]** A missing/incorrect `JWT_SECRET` does NOT crash boot; it fails at login/token-verify time, which looks like an application bug. Treat JWT as deployment-blocking: the verification checklist (§9) requires a successful admin login before handoff. (Future hardening: fail-fast boot check — see §16.) |
| `FRONTEND_URL` | `main.ts:31` CORS origin — **must equal the deployed Vercel origin** (never leave as `https://example.com`). Must be scheme+host with **no trailing slash** (`https://x` + `/` never matches `Origin: https://x`) |
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

Labels: **[REQUIRED]** = deployment fails or core flows break without it. **[OPTIONAL]** = enable only if the client buys the feature; absence degrades loudly, never silently. **[PLAN-DEPENDENT]** = depends on the client's infrastructure/provider plan. **[DEFERRED]** = intentionally out of scope for this deployment.

| Provider | Label | Core boot | Absent behavior |
|---|---|---|---|
| Supabase (Postgres+Auth+Storage) | **[REQUIRED]** — only hard infra dependency besides Redis | free-tier project suffices; run `001→040`, copy 3 keys | full schema, 0 app rows |
| Redis | **[REQUIRED]** for login/sessions; boot+health OK without | client-managed Redis (any host) or Upstash; `REDIS_HOST/PORT/PASSWORD` (password enables TLS) | anonymous/public paths work; login + all authenticated routes fail closed |
| Resend | **[OPTIONAL — DEFERRED if no domain]** | client-owned account + verified sender domain; without `RESEND_API_KEY` the app runs in STUB MODE (emails logged, not sent; user creation never blocked) | stubbed; do NOT make purchasing a domain a baseline requirement |
| Zoom | **[OPTIONAL]** | client Zoom account; call-time `...must be set...` errors only | endpoints throw only when called |
| Bunny (default video path) | **[OPTIONAL]** (`BUNNY_ENABLED` unset = off) | client Bunny account | uploads 503 fail-visible; deletes treated as already-gone |
| Mux | **[OPTIONAL]** (dormant rollback) | client Mux account | lazy getters throw only if rollback enabled (`VIDEO_UPLOAD_PROVIDER=mux`) |
| Puppeteer | Bundled **[REQUIRED]** for invoice/receipt/cert PDFs | zero-install (build `postbuild`) + `PUPPETEER_CACHE_DIR` on Render (see §3); `PUPPETEER_EXECUTABLE_PATH` only for custom hosts | available; without Chrome, PDF endpoints 500 but money state stays safe with retry |

Zero-cost demo = Supabase free tier + local/Upstash-free Redis + stubbed email + no video-provider keys. Paid features degrade loudly, never silently.

## 9. VERIFICATION CHECKLIST (post-deploy, per client — all must pass)

### Infrastructure
- [ ] Supabase reachable; `GET https://<render-host>/health` → 200 `{"status":"ok",...}` (liveness only — a green health check does NOT prove DB/Redis)
- [ ] Redis reachable (login works — §3; Redis outage fails all authenticated routes closed while `/health` stays green)
- [ ] Render service healthy; Vercel deployment renders
- [ ] `FRONTEND_URL` exactly equals the Vercel origin (no trailing slash); `NEXT_PUBLIC_API_URL` equals the Render URL (web redeployed after any change — build-time baked)
- [ ] RLS verification queries (§1) return: 0 RLS-off tables, 0 open policies, `uploads`+`invoices` private, 0 app rows (except reference data)

### Authentication
- [ ] First admin can log in (see §12); invalid credentials rejected (401, not 500)
- [ ] Authenticated admin route works (`GET /business-config` 200); unauthenticated protected route → 401
- [ ] Session survives refresh; second-device login triggers the documented 409-then-retry single-session flow

### Business configuration
- [ ] `PUT /business-config` sets: business name, logo, favicon, theme, currency, locale, timezone, FY start month, tax mode/rate, invoice/receipt prefixes, support contacts, website, legal footer
- [ ] Logged-out pages render the brand (title/metadata via public `GET /business-config/public`)

### LMS flows (as admin, then as a test student)
- [ ] Create user → create course → create batch → enroll student → create session
- [ ] Recording exists and is Ready; student playback authorizes (200) and plays (only if a video provider is configured; otherwise direct upload is expected to 503 loudly)
- [ ] Create test with questions → publish → student attempt → result → review queue (for manual-review types) → publish result
- [ ] Certificate issued on curriculum completion; public `/verify-certificate?token=…` shows name/course/date/number
- [ ] Announcements published → visible in student notifications

### Billing
- [ ] Payment plan → booking → installment payment(s)
- [ ] Invoice PDF generated and stored (`invoices` bucket); receipt PDFs generated and stored
- [ ] `GET /invoices/:id/download` returns a signed URL serving a valid PDF (`%PDF-` magic bytes)
- [ ] Invoice/receipt download requires admin auth (direct anonymous object access denied)

### Storage & security
- [ ] Question-image upload works through the API; anonymous `storage.from('uploads').list(...)` denied
- [ ] Anonymous `storage.from('invoices').list(...)` denied
- [ ] Anonymous direct table reads denied (spot-check `profiles`, `payments`, `invoices` via anon key → empty/42501)
- [ ] No demo/client data present beyond what this verification created (test rows must be removed or be the client's own seed users)

### Email (only if Resend configured)
- [ ] `RESEND_API_KEY` set + `EMAIL_FROM` on a verified domain; welcome/test email delivers. If deferred: confirm stub-mode log lines and move on — do NOT treat as failure.

## 10. HANDOVER (per client — all must hold before sign-off)

- [ ] Client domain configured (DNS → Vercel; API subdomain → Render); `FRONTEND_URL` / `NEXT_PUBLIC_API_URL` match exactly
- [ ] All client credentials transferred to client-owned secret storage (Supabase keys, Redis, JWT_SECRET, provider keys); nothing remains only with MicroNest
- [ ] Client owns external provider accounts (Supabase project, Redis, Zoom/Mux/Bunny/Resend as applicable)
- [ ] First admin confirmed (login works; credentials rotated to client-chosen values)
- [ ] Backup strategy acknowledged by client (§13 delivered)
- [ ] BusinessConfig completed (brand, locale, tax, FY, contacts)
- [ ] Provider configuration completed (video provider selected; email sender verified or explicitly deferred)
- [ ] §9 verification checklist fully passed and outputs recorded (secret store, never git)
- [ ] Demo dependency confirmed absent (no demo DB URLs/keys in client env; canonical chain only)
- [ ] No MicroNest credentials required for runtime (see §15 ownership matrix)
- [ ] Operator can repeat §0–§9 for the next client with only new credentials (deployment procedure is credential-parameterized, §11 simulation holds)

## 11. CLIENT #2 SIMULATION (conceptual — no infra created)

Client #2 = new Supabase project + new Redis + new Render service + new Vercel deployment + new ENV + new BusinessConfig row, same codebase, same `001→040` artifact, same build/start/health contract. **No source fork, no `tenant_id`, no branding edits, no shared database.** The only per-client variables are credentials, `FRONTEND_URL`/`NEXT_PUBLIC_API_URL` origins, provider keys, and BusinessConfig content.

---

## 12. FIRST ADMIN RUNBOOK (bootstrap on an empty deployment) **[REQUIRED]**

There is no public signup endpoint and no bootstrap endpoint by design (`POST /users` requires an existing admin). The first administrator is created in two steps: Supabase Auth user, then the matching `profiles` row. Afterwards everything else goes through the LMS itself.

### A. Create the Auth user (Supabase dashboard, client project)

1. Open the client Supabase project → Authentication → Users → Add user → Create new user.
2. Enter the admin email + a strong temporary password. Leave "Auto Confirm User" ON (or confirm the email immediately).
3. Save. Copy the new user's UID (the `id` column, a UUID).

### B. Insert the matching `profiles` row (Supabase dashboard → SQL Editor)

The `id` **must equal** the Auth user's UID (it is both PK and FK to `auth.users(id)`). Required columns (from `001_initial_schema.sql`):

```sql
INSERT INTO public.profiles (id, name, email, role, is_active, must_change_password)
VALUES (
  '<PASTE-AUTH-USER-UUID>',
  'Client Admin',
  'admin@client-domain.example',
  'admin',      -- must be exactly: admin | teacher | student
  true,
  false         -- true forces a password change on first login; false skips it
);
```

Do NOT invent columns. `phone` and `zoom_user_id` are optional (leave NULL). Never insert demo/fictional users into a client database.

### C. First login (LMS web URL, e.g. the Vercel deployment `/login`)

Log in with the admin email + temporary password. Expected: redirect to the admin dashboard. If login fails with 500s, re-check `JWT_SECRET` + Redis before anything else (§9 auth checklist). Rotate to a client-chosen password immediately (change-password flow or a second Auth-UI password reset).

### D. Initial BusinessConfig (as the admin)

`PUT /business-config` (admin UI form or API) — the endpoint upserts, so no seed row is required. Set at minimum: `businessName`, `logoUrl`, `faviconUrl`, `supportEmail`, `supportPhone`, `website`, `locale`, `timezone`, `currency`, `fyStartMonth` (0=January…11=December), `taxMode` (`inclusive`|`exclusive`|`zero`), `taxRate`, `invoicePrefix`, `receiptPrefix`, `currentFinancialYear`, `themeJson {primary, sidebarBg, accent}`, `legalFooter`. Verify via the public `GET /business-config/public` (no auth required) and the logged-out login page branding.

### E. Create remaining users

As the admin: `POST /users` (or the admin Students UI / bulk-upload CSV) for teachers and students. Every subsequent account is created inside the product — the Auth-dashboard step is a one-time bootstrap only.

## 13. BACKUP & RECOVERY **[REQUIRED] minimum**

### Supabase (Postgres + Auth + Storage)
- **[REQUIRED]** Acknowledge a backup story before handoff: Supabase **PITR** (plan-dependent — verify availability on the client's plan) and/or scheduled `pg_dump` to client-owned storage. The canonical chain is re-runnable, but it recreates *schema*, never *data*.
- **[REQUIRED]** Take a manual backup (dashboard → Database → Backups, or `pg_dump`) **before applying any migration to a live client DB** and before any bulk operation (bulk upload, batch deletes).
- Restoration = client-owned action: restore the dump/PITR snapshot into the client project, then re-run §9 verification. Rollback of a single migration = restore + re-apply subsequent migrations as needed (there is no automated down-migration system — see §14).
- Distinguish **database recovery** (rows, RLS, functions) from **object-storage recovery** (`uploads`/`invoices` buckets are NOT covered by a Postgres dump; Supabase bucket versioning/replication is plan/ops-dependent — confirm with the client's plan).

### Redis
- Redis holds **ephemeral operational state**: sessions (`user_session:*`), rate-limit counters, caches. No Redis content needs backup.
- Outage impact: login + all authenticated routes fail closed; public pages and `/health` keep working. Recovery = restore Redis connectivity; users simply log in again (sliding sessions are re-created on login). Document the client's Redis durability choice (managed/Upstash persistence vs ephemeral) without inventing guarantees.

### Storage
- `uploads` (question images) and `invoices` (generated PDFs) live in the client's Supabase project. PDFs are regenerable from payment rows via the outbox retry path, but treat stored objects as production data: confirm the client's bucket backup/versioning story per plan.

### Render / Vercel
- Nothing persistent: deployments are reproducible from source + env + the procedures in this runbook. Redeploys, restarts, and rollbacks (previous Render deploy / Vercel deployment) lose no application data. Cron jobs (`outbox`, upload, cleanup) are DB-driven and resume after restart.

## 14. MIGRATION OPERATING CONVENTION (future `041+`) — operational convention, not automation

There is no migration runner, no ledger table, and no atomic multi-statement applier: the operator pastes SQL into the Supabase SQL Editor. The safety of this process rests on conventions the repo already enforces for authors (contiguous `NNN_` numbering, generator validation, idempotent statements) plus this operator procedure:

1. **Backup first** (§13) — non-negotiable on a live client DB.
2. **Review the migration file** — confirm it touches only intended objects, is re-runnable (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `DROP ... IF EXISTS`), and contains no demo/client data.
3. **Bump the generator** (`EXPECTED_COUNT`, `EXPECTED_LAST` in `scripts/generate-fresh-sql.ts`), run `pnpm db:generate` twice, compare SHA-256, commit the regenerated artifact.
4. **Apply ONLY the new migration file** to the live client DB (new clients get the full regenerated artifact instead).
5. **Verify affected objects** (tables/policies/buckets per the migration header) + re-run the §1 verification queries.
6. **Run application regression** (§9 auth + core flows) before sign-off.
7. **Record the applied migration operationally** (client run-log: migration number, date, hash, verification output) — the database does not track this itself.

## 15. OWNERSHIP MATRIX (operational, not legal)

| Asset | Client owns | MicroNest owns |
|---|---|---|
| Domain + DNS | YES | NO |
| Vercel account/project | YES | NO |
| Render account/service | YES | NO |
| Supabase project (DB/Auth/Storage) | YES | NO |
| Redis instance | YES | NO |
| Mux / Bunny account (if used) | YES | NO |
| Resend account + sender domain (if used) | YES | NO |
| Production data + backups | YES | NO |
| All runtime secrets/credentials | YES | NO |
| Deployment procedure (this runbook) | shared copy | YES (maintainer) |
| Source code / product IP | only if licensed/transferred | YES unless explicitly transferred |

No MicroNest-hosted service, credential, or database is required at client runtime. The demo environment is never involved.

## 16. FUTURE HARDENING (explicitly NOT implemented in this checkpoint)

1. **Fail-fast `JWT_SECRET` boot check** — currently a missing/incorrect secret fails at login time, not boot. Treat as deployment-blocking operationally (§5/§9); code change deferred.
2. **Readiness component for `/health`** — currently liveness-only (green without DB/Redis). Synthetic login + RLS spot-checks are the current substitute (§9).
3. **Migration ledger/runner** — currently manual SQL-Editor application with idempotency-by-convention (§14).
4. **Automated backup scheduling** — currently operator-driven per §13.
5. **`ALLOWED_ORIGINS`-style multi-origin CORS** — currently single-origin by design (correct for one-deployment-per-client; a change would only matter if the model changes).
6. **Resend webhook secret enforcement default** — currently warn-and-accept when unset; set `RESEND_WEBHOOK_SECRET` per deployment meanwhile.
7. **India-coupled display literals** — ~15 admin views hardcode `en-IN` rendering and GST-flavored labels; server-computed documents already use DB config. Cosmetic for non-IN clients; no totals impact.
8. **Node version pin** (`.nvmrc`/engines) for reproducible builds.
9. **Retire deprecated `scripts/seed.sql` / `scripts/setup-db.sql`** (demo/deprecated traps; never part of `001→040`).
10. **Bulk-upload template course name** (`Dhanlabh With Shubh` in `bulk-upload.controller.ts`) — genericize to keep deployments content-neutral.
