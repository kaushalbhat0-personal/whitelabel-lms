---
name: white-label-deployment
description: Authoritative agent guide for White-Label LMS client onboarding — the deployment factory sequence, BusinessConfig vs ENV ownership, deployment policies, demo/marketing isolation, and handoff gates. Use before any client onboarding, deployment, factory, or environment work.
---

# Skill: White-Label Deployment (Factory + Onboarding)

## Purpose

Client #1 onboarding runs through the deployment factory, not through source edits. This skill is the single entry point for that workflow. It complements `mct-lms-architecture` (code map), `mct-security` (endpoint checklist), and `mct-rccf-workflow` (phase discipline).

## Product model (frozen)

```
ONE CODEBASE → ONE DEPLOYMENT → ONE CLIENT
```

Each client receives an independent web deployment, API deployment, PostgreSQL/Supabase database, Redis instance, storage, video configuration, provider accounts, email configuration, secrets, BusinessConfig row, and client data. There is **no multi-tenancy**: no `tenant_id`, no `organization_id`, no `client_id`, no shared runtime, no central tenant control plane, no cross-client DB or Redis access. The LMS is deployed onto infrastructure controlled by the client. MicroNest never hosts client LMS environments.

## Ownership (never mix these)

**BusinessConfig** — non-secret client/business presentation configuration, owned by the Client Admin via `PUT /business-config` (or factory `push-config`). Examples: business name, logo, favicon, address/contact presentation, currency, locale, timezone, financial year, tax mode/rate, invoice/receipt prefixes, legal footer, theme, certificate identity/presentation. It must **never contain secrets**.

**ENV / secrets** — deployment/infrastructure/provider configuration, owned by the Deployment Operator. Examples: database connection, Supabase service credentials, Redis credentials, JWT secret, video provider credentials, Zoom credentials (`ZOOM_*`), Resend API key + webhook secret, `EMAIL_FROM`, Puppeteer/deployment infrastructure variables, deployment policy variables. Never in BusinessConfig, never in Git.

**Client data** — rows in the client's own database (profiles, courses, batches, payments, invoices, recordings, …), owned by the Client Admin and isolated by separate infrastructure per client.

**LMS Core** — generic reusable source: routes, tables, Redis keys, guards, entitlements, tax math, policy *value sets*. Changed only by core releases, never per client.

## Factory sequence (conceptual — see `scripts/deployment-factory/src/cli.ts` for exact flags)

```
init → validate → generate → secret-scan → first-admin → push-config → verify-db/deploy → handoff
```

- **init** — scaffold a client config skeleton (deliberately invalid until filled).
- **validate** — blocking gate: schema, cross-field rules, isolation guards, domain-reuse check. Timezone validation uses a **static canonical IANA allowlist** (not the runtime ICU database): `Asia/Kolkata`, `Asia/Dubai`, `UTC` and other canonical zones pass; `Asia/Calcutta` is tolerated as a legacy alias; garbage fails.
- **generate** — emits deployment artifacts (Render/Vercel env templates with `<placeholder>` secrets, BusinessConfig payload, first-admin SQL template, DNS sheet, checklist). Generation **must not modify application source** (source changes = 0).
- **secret-scan** — mandatory; generated artifacts must contain placeholders, never real secrets.
- **first-admin** — renders SQL to stdout; the operator creates the Auth user in the client dashboard, pastes the UID, runs the SQL, then rotates the password.
- **push-config** — validates then PUTs the BusinessConfig payload (creds via env only, never flags); evidence is keys/counts/status, never secrets.
- **verify-db / verify-deploy** — read-only evidence collection; WARNs never become silent PASSes.
- **handoff** — READY requires: deployment evidence, matching `deploymentId`, exact domain match, DB identity, backup acknowledgement, named verifier, zero FAIL, zero unacknowledged WARN. Never weaken gates for convenience.

## Client-safe default policies (factory pins these)

Normal client artifacts must carry: `SESSION_POLICY=single`, `PASSWORD_MANAGEMENT=enabled`, and **no `TEMP_DEMO_ACCESS` line at all** (absent = disabled). Zoom: `ZOOM_ENABLED=enabled` for live+recorded clients, `ZOOM_ENABLED=disabled` for recorded-only clients. Provider selection itself is client-specific (video/email/zoom per config).

## Deployment policies (all deployment-scoped, fail fast on invalid values)

- `SESSION_POLICY=single|multi` (default `single`). Normal clients: `single` — one active session per user. Demo: `multi` — concurrent sessions are legitimate **only** where explicitly configured. Never change policy to mask an auth bug; never weaken client defaults.
- `PASSWORD_MANAGEMENT=enabled|disabled` (default `enabled`). Demo: `disabled` (self-service flows blocked server-side). Do not present demo behavior as normal.
- `TEMP_DEMO_ACCESS` (default absent/disabled). Demo only: `enabled` exposes `POST /demo/access`; elsewhere the route behaves as absent (404). The factory never emits it for normal clients.
- `ZOOM_ENABLED=enabled|disabled` (unset → `enabled`, backward compatible). Recorded-only clients set `disabled`: live Zoom operations reject with an intentional controlled 503 — do **not** "fix" this by enabling Zoom. Zoom credentials stay ENV-owned; recorded-only deployments must not require them.

## Email rules

`EMAIL_FROM` must be explicitly configured whenever sending is enabled — there is no production fallback sender. Missing `RESEND_WEBHOOK_SECRET` means webhooks are **rejected (401, fail closed)**, never accepted with a warning.

## Demo model (a real deployment, not a product mode)

The demo is disposable sales infrastructure: `SESSION_POLICY=multi`, `PASSWORD_MANAGEMENT=disabled`, `TEMP_DEMO_ACCESS=enabled` on the demo deployment only. Never create `DEMO_MODE` branches. Demo credentials are never source-controlled (validated: no tracked file references them). Demo users/content/payments never enter canonical migrations, generated SQL, factory templates, normal client artifacts, or marketing source. Reset = scoped SQL + live-API reprovision per the demo reset runbook; never touch source, factory, or clients.

## Marketing isolation (`apps/marketing`)

Marketing is a separate static application (`output: 'export'`). It must not import LMS runtime code, call Supabase/Redis/client databases, access secrets, store demo credentials, or couple runtime behavior to the demo. Demo coupling is a plain hyperlink to the configured demo origin only. The marketing brand (cream/Fraunces/terracotta/editorial composition) is frozen — generic design rules do not override it.

## Client generation invariant

A client must be fully expressible through generated artifacts + BusinessConfig + ENV/secrets + client-owned infrastructure. If onboarding seems to require a source edit, stop: either the configuration surface is missing (raise it as a core change) or the approach is wrong.

## Verification

After factory work: `validate` clean → `generate` → `secret-scan` clean → `git status` shows zero source modifications → policy lines confirmed in the emitted templates. Report artifact counts and the exact policy values emitted.
