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
| `favicon_url` | Client Admin | `business_config.favicon_url TEXT` (040) | DB `business_config.favicon_url` via `040-business-config-whitelabel.sql` (nullable) | DB | Was hard-coded `apps/web` static file; P2A adds column, not yet wired |
| `address` (`address_line_1/2, city, state, pincode, country`) | Client Admin | `business_config` 6 columns | DB (good) | DB | Invoice legal block |
| `gstin, pan` | Client Admin | `business_config.gstin/pan` | DB (good) | DB | Nullable; invoice template conditional |
| `email, phone` | Client Admin | `business_config.email/phone` | DB (good) | DB | Business contact |
| `support_email, support_phone, website` | Client Admin | `business_config.support_email/phone TEXT + website TEXT` (040, nullable) | DB `business_config` via 040 | DB | Per-client support contact; website optional |
| `website, social links` | Client Admin | *not stored* | *no column* | DB (`website TEXT, social_json JSONB`) Phase 3 if needed | Keep minimal v1; avoid noise |
| **Branding / Theme** | | | | | |
| `theme_primary` | Client Admin | `business_config.theme_json` (new) | `tailwind.config.ts:18 #10b981` literal | DB `theme_json` → CSS vars Phase 3 | `#10b981` stays DEFAULT per `defaults.ts` |
| `theme_sidebarBg, accent` | Client Admin | `business_config.theme_json` | `tailwind.config.ts:60 #064e3b` | DB | Same pattern |
| `certificate_accent, seal text` | Client Admin | `business_config.certificate_json` (new) | `certificate.template.hbs:29/37 LMS Platform / LMS` literal | DB JSON Phase 3 | |
| **Localization** | | | | | |
| `timezone` | Client Admin | `business_config.timezone TEXT DEFAULT 'Asia/Kolkata'` (040) | DB `business_config.timezone` via 040 | DB | Webinar scheduling; `zoom-live.provider.ts:118` uses `DEFAULT_TIMEZONE` fallback until P2B wiring |
| `locale` | Client Admin | `business_config.locale TEXT DEFAULT 'en-IN'` (040) | DB `business_config.locale` via 040 | DB | `invoices.service.ts:351 'en-IN'` literal until P2C wiring |
| `currency` | Client Admin | `business_config.currency TEXT DEFAULT 'INR'` (040) | DB `business_config.currency` via 040 | DB | `invoices.service.ts:360 '&#x20B9;' INR` literal until P2C wiring |
| **Financial** | | | | | |
| `invoice_prefix, receipt_prefix` | Client Admin | `business_config.invoice_prefix/receipt_prefix` | DB columns exist but `invoices.service.ts:94` ignores prefix in primary path | DB — fix read path to honor DB Phase 2 | `INV`/`RCP` defaults |
| `current_financial_year` | Client Admin | `business_config.current_financial_year` | DB | DB | Snapshot; Phase 2 may add `fy_start_month` |
| `fy_start_month, tax_mode, tax_rate` | Client Admin | `business_config.fy_start_month INT 0-11 / tax_mode inclusive/exclusive/zero / tax_rate NUMERIC 0-100` (040) | DB `business_config` via 040 (defaults `3, inclusive, 18`) | DB | `invoices.service.ts:52 month>=3` + `240 /1.18 *0.09` literals until P2C wiring |
| `legal_footer` | Client Admin | `business_config.legal_footer TEXT` (040, nullable) | DB `business_config.legal_footer` via 040 | DB | `invoice.template.hbs:35 GST Invoice…` literal until P2C wiring |
| **Features / Terminology** | | | | | |
| `terminology.batch` (display alias) | Client Admin | *not stored* | Code `Batch` everywhere | DB `terminology_json` Phase deferred | Internal `Batch` stays canonical DB enum; display alias optional, not v1 |
| `feature flags` (e.g., certificates, attendance) | LMS Core / Deployment Operator | *not stored* | All features always-on `app.module.ts:114-147` | `feature_flags` table or ENV deferred | No client has asked; avoid noise |
| **Deployment / Infra** (ENV) | | | | | |
| `JWT_SECRET, JWT_EXPIRES_IN` | Deployment Operator | `ENV JWT_*` | ENV (good) | ENV | Per-deployment; rotation via operator |
| `SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY` | Deployment / Infra Provider | `ENV SUPABASE_*` | ENV (good) | ENV | Client-owned Supabase project per white-label model |
| `REDIS_HOST/PORT/PASSWORD` | Deployment Operator | `ENV REDIS_*` | ENV (good) | ENV | Upstash or local `localredis` per compose |
| `ZOOM_* (ACCOUNT_ID, CLIENT_ID/SECRET, WEBHOOK_SECRET, SDK_KEY/SECRET)` | Deployment Operator | `ENV ZOOM_*` | ENV (good) | ENV | Client-owned Zoom S2S app |
| `BUNNY_* / MUX_* VIDEO_UPLOAD_PROVIDER` | Deployment Operator | `ENV VIDEO_UPLOAD_PROVIDER, BUNNY_*, MUX_*` | ENV (good) | ENV | Client-owned Bunny library or Mux token |
| `RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO` | Deployment Operator | `ENV RESEND_*, EMAIL_*` | ENV `EMAIL_FROM` generic per deployment | ENV | Per-deployment verified domain; brand color stays in BusinessConfig/theme |
| `FRONTEND_URL, NEXT_PUBLIC_API_URL` | Deployment Operator | `ENV FRONTEND_URL` | ENV `http://localhost:3000` fallback (generic) | ENV | Single origin per deployment; `ALLOWED_ORIGINS` CSV if needed later |
| `PORT, NODE_ENV` | Deployment Operator | `ENV` | ENV | ENV | Runtime |
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

- `apps/api/.env.example:1-69` — deployment ENV authoritative list (23 keys)
- `apps/api/src/common/config/defaults.ts` — central defaults (this phase)
- `scripts/migrations/` — DB authority; `scripts/schema.sql` is deprecated reference
- `scripts/check-supabase-schema.js` — live DB vs expected migration state checker (8 representative tables, not schema.sql)
- Flexibility audits: `RCCF-FLEX-01` (17 principles, scorecard), White-Label Readiness Audit

