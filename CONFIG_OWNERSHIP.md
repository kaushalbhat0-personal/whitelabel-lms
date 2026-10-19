# Configuration Ownership

> Foundation document for the white-label productization architecture.
> Launch model locked: **ONE CODEBASE → CLIENT CONFIGURATION → CLIENT-OWNED INFRASTRUCTURE → ONE DEPLOYMENT = ONE CLIENT**
> No `tenant_id` / multi-tenancy in this phase (see RCCF-FLEX-01).

This document answers **WHO OWNS THIS?** for every meaningful configuration value.
It separates three layers:

- **LMS Core** — product rules; not per-client; changed only by core releases
- **Client Configuration** — per-client business/branding; owned by Client Admin via `business_config`
- **Deployment / Infrastructure** — per-deployment secrets and provider wiring; owned by Deployment Operator via `ENV`

---

## 1. Ownership Model

```
LMS CORE (apps/api, apps/web, packages/shared-types)
   │ defines rules and defaults
   ▼
CLIENT CONFIGURATION (business_config single row per deployment)
   │ overrides defaults per client; managed by Client Admin (Admin UI / API)
   ▼
DEPLOYMENT / INFRASTRUCTURE (.env, Supabase project, Redis, provider dashboards)
   │ owned by Deployment Operator; never in BusinessConfig

CLIENT DATA (profiles, courses, batches, recordings, payments, etc.)
   │ owned by Client Admin; isolated by separate infrastructure per client
```

### Core principle

```
BusinessConfig value (if present) → use it
otherwise → central default (apps/api/src/common/config/defaults.ts)
NOT → hardcoded literal in service/template
```

Phase 1 only establishes the **ownership table** and **defaults module**.
Phase 2 will migrate the first meaningful hardcodes to this pattern.

---

## 2. Configuration Table

| Configuration | Owner | Storage | Current Location | Future Location | Notes |
|---|---|---|---|---|---|
| **Business identity** | | | | | |
| `business_name` | Client Admin | `business_config.business_name` (DB) | DB (good) | DB | Per-client display/legal name |
| `logo_url` | Client Admin | `business_config.logo_url` | DB (good) | DB | Header / PDF / email; fallback to text badge |
| `favicon_url` | Client Admin | `business_config.favicon_url TEXT` (038) | DB `business_config.favicon_url` via `038-business-config-whitelabel.sql` (nullable) | DB | Was hard-coded `apps/web` static file; column added and wired |
| `address` (`address_line_1/2, city, state, pincode, country`) | Client Admin | `business_config` 6 columns | DB (good) | DB | Invoice legal block |
| `gstin, pan` | Client Admin | `business_config.gstin/pan` | DB (good) | DB | Nullable; invoice template conditional |
| `email, phone` | Client Admin | `business_config.email/phone` | DB (good) | DB | Business contact |
| `support_email, support_phone, website` | Client Admin | `business_config.support_email/phone TEXT + website TEXT` (038, nullable) | DB `business_config` via 038 | DB | Per-client support contact; website optional. `social_json` deferred (Phase 3 if needed) |
| `website` | Client Admin | `business_config.website TEXT` (038, nullable) | DB (good) | DB | Optional; `social_json` deferred to Phase 3 if needed |
| **Branding / Theme** | | | | | |
| `theme_primary` | Client Admin | `business_config.theme_json` (039) | DB (good) | DB | `DEFAULT_THEME_*` per `defaults.ts` when unset |
| `theme_sidebarBg, accent` | Client Admin | `business_config.theme_json` (039) | DB (good) | DB | Same pattern |
| `certificate identity` | Client Admin | derived from `business_config` row (`business_name`, `logo_url`, `theme_json`) at render time | Code reads DB row | DB | No separate `certificate_json` column exists; seal/initials derived per render. Do not invent one |
| **Localization** | | | | | |
| `timezone` | Client Admin | `business_config.timezone TEXT DEFAULT 'Asia/Kolkata'` (038) | DB `business_config.timezone` via 038 | DB | Webinar scheduling; live provider falls back to `DEFAULT_TIMEZONE` when the DTO omits it |
| `locale` | Client Admin | `business_config.locale TEXT DEFAULT 'en-IN'` (038) | DB `business_config.locale` via 038, honored by `getBusinessConfigWithDefaults` | DB | `DEFAULT_LOCALE` fallback when unset |
| `currency` | Client Admin | `business_config.currency TEXT DEFAULT 'INR'` (038) | DB `business_config.currency` via 038, honored by `getBusinessConfigWithDefaults` | DB | `DEFAULT_CURRENCY` fallback when unset |
| **Financial** | | | | | |
| `invoice_prefix, receipt_prefix` | Client Admin | `business_config.invoice_prefix/receipt_prefix` | DB (good) | DB | Prefixes honored from the DB row; `INV`/`RCP` defaults |
| `current_financial_year` | Client Admin | `business_config.current_financial_year` | DB | DB | Snapshot; Phase 2 may add `fy_start_month` |
| `fy_start_month, tax_mode, tax_rate` | Client Admin | `business_config.fy_start_month INT 0-11 / tax_mode inclusive/exclusive/zero / tax_rate NUMERIC 0-100` (038) | DB `business_config` via 038 (defaults `3, inclusive, 18`), honored by `getBusinessConfigWithDefaults` | DB | `DEFAULT_*` fallbacks when unset |
| `legal_footer` | Client Admin | `business_config.legal_footer TEXT` (038, nullable) | DB `business_config.legal_footer` via 038, rendered on invoices when set | DB | Omitted when unset |
| **Features / Terminology** | | | | | |
| `terminology.batch` (display alias) | Client Admin | *not stored* | Code `Batch` everywhere | DB `terminology_json` Phase deferred | Internal `Batch` stays canonical DB enum; display alias optional, not v1 |
| `feature flags` (e.g., certificates, attendance) | LMS Core / Deployment Operator | *not stored* | All features always-on `app.module.ts:114-147` | `feature_flags` table or ENV deferred | No client has asked; avoid noise |
| **Deployment / Infra** (ENV) | | | | | |
| `JWT_SECRET, JWT_EXPIRES_IN` | Deployment Operator | `ENV JWT_*` | ENV (good) | ENV | Per-deployment; rotation via operator |
| `SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY` | Deployment / Infra Provider | `ENV SUPABASE_*` | ENV (good) | ENV | Client-owned Supabase project per white-label model |
| `REDIS_HOST/PORT/PASSWORD` | Deployment Operator | `ENV REDIS_*` | ENV (good) | ENV | Upstash or local `localredis` per compose |
| `ZOOM_* (ACCOUNT_ID, CLIENT_ID/SECRET, WEBHOOK_SECRET, SDK_KEY/SECRET)` | Deployment Operator | `ENV ZOOM_*` | ENV (good) | ENV | Client-owned Zoom S2S app; required only when live classes are enabled |
| `ZOOM_ENABLED` | Deployment Operator / LMS Core | `ENV ZOOM_ENABLED` (`enabled`|`disabled`, unset → `enabled`) | ENV + `zoom-enabled.constant.ts` | ENV | Explicit deployment intent: `disabled` = recorded-only (live operations reject with intentional 503); factory emits `enabled` for Zoom clients, `disabled` for recorded-only |
| `BUNNY_* / MUX_* VIDEO_UPLOAD_PROVIDER` | Deployment Operator | `ENV VIDEO_UPLOAD_PROVIDER, BUNNY_*, MUX_*` | ENV (good) | ENV | Client-owned Bunny library or Mux token |
| `RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, RESEND_WEBHOOK_SECRET` | Deployment Operator | `ENV RESEND_*, EMAIL_*` | ENV (good) | ENV | Per-deployment verified domain; brand color stays in BusinessConfig/theme. No fallback sender: `EMAIL_FROM` is required when sending; webhook rejects when the secret is unset |
| `LIVE_SESSION_DEFAULT_HOST_ID` | Deployment Operator | `ENV` (optional) | ENV | ENV | Default Zoom host for live sessions when no explicit host is set |
| `PUPPETEER_CACHE_DIR, PUPPETEER_EXECUTABLE_PATH` | Deployment Operator | `ENV` | ENV | ENV | PDF rendering runtime paths; Render cache dir required, custom-host override optional |
| `FRONTEND_URL, NEXT_PUBLIC_API_URL` | Deployment Operator | `ENV FRONTEND_URL` | ENV `http://localhost:3000` fallback (generic) | ENV | Single origin per deployment; `ALLOWED_ORIGINS` CSV if needed later |
| `PORT, NODE_ENV` | Deployment Operator | `ENV` | ENV | ENV | Runtime |
| `SESSION_POLICY` | LMS Core (values) / Deployment Operator (setting) | `ENV` (`single`|`multi`, unset → `single`) | Code constant + ENV | ENV | Client deployments use `single`; `multi` is demo-only and never generated by the factory |
| `PASSWORD_MANAGEMENT` | LMS Core (values) / Deployment Operator (setting) | `ENV` (`enabled`|`disabled`, unset → `enabled`) | Code constant + ENV | ENV | Client deployments use `enabled`; surfaced read-only in public BusinessConfig |
| `TEMP_DEMO_ACCESS` | LMS Core (values) / Deployment Operator (setting) | `ENV` (`enabled`|`disabled`, unset → `disabled`) | Code constant + ENV | ENV | `enabled` exposes `POST /demo/access` (demo only); factory never emits it; absent = 404 |
| **LMS Core Rules** | | | | | |
| `ROUTES (/admin, /student, /login)`, `TABLES`, `REDIS_KEYS`, `RECORDING_BATCHES entitlement` | LMS Core | Code constants `ROUTES`, `TABLES`, `REDIS_KEYS`, `playback-guard` | Code (good) | Code | Not per-client; changes only by core release |
| `EMI cent-safe split` | LMS Core | `payments.service.ts:208-224` | Code (good) | Code | Business-neutral math |
| `JwtAuthGuard, RolesGuard, ResponseTransformInterceptor` order | LMS Core | `app.module.ts:163-174` | Code (good) | Code | Preserved per RCCF |

---

## 3. What belongs where — quick test

Ask:

1. Does it differ between Alpha Academy (India, INR, green) and Global Skills Institute (UAE, AED, blue) without changing business logic? → **Client Configuration (BusinessConfig / theme)**
2. Is it a credential, signing key, or provider account handle? → **Deployment ENV (secret)** — never BusinessConfig.
3. Is it a routing key, entitlement rule, or interceptor order? → **LMS Core** (code, versioned).

If an item fails the test (e.g., `invoice_prefix` is business-related but stored in ENV), it is in the wrong layer.

---

## 4. Ownership invariants

- Client Admin cannot see deployment secrets (Supabase service key, Redis password, provider API keys) via BusinessConfig API.
- Deployment Operator cannot override client business identity without touching the database (intentional separation).
- `business_config` is singleton per deployment (`CREATE UNIQUE INDEX ON ((TRUE))` in `schema.sql:77` and `business-config.service.ts:4`). This is correct for `ONE DEPLOYMENT = ONE CLIENT`. No `tenant_id`.
- Frontend never holds secrets: only `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/NEXT_PUBLIC_API_URL` are public by design.

---

## 5. What this document does NOT do

- Does not introduce `tenant_id`, `tenants` table, tenant-aware JWT/Redis/RLS.
- Does not introduce feature-flag or terminology tables.
- Does not expand `business_config` columns — that is Phase 2.
- Does not implement runtime theming — that is Phase 3.

It exists so that every future productization PR can state: **“This value’s owner is X, stored in Y, defaults to Z per `defaults.ts`.”**

---

## 6. Related docs

- `apps/api/.env.example` — deployment ENV authoritative list (37 assignments plus commented demo-only flag; `RESEND_WEBHOOK_SECRET`, `PUPPETEER_*`, and `LIVE_SESSION_DEFAULT_HOST_ID` documented in factory templates and deployment docs)
- `apps/api/src/common/config/defaults.ts` — central defaults (this phase)
- `scripts/migrations/` — DB authority; `scripts/schema.sql` is deprecated reference
- `scripts/check-supabase-schema.js` — live DB vs expected migration state checker (8 representative tables, not schema.sql)
- Flexibility audits: `RCCF-FLEX-01` (17 principles, scorecard), White-Label Readiness Audit

