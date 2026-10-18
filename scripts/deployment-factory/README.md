# Deployment Factory (FACTORY-01) — local operator toolkit

INTERNAL operator tool. Not a SaaS control plane, not multi-tenancy, not
client self-service, not infrastructure orchestration. Dashboards stay manual;
this toolkit **prepares, validates, and verifies**.

## Secret policy (non-negotiable)

- Generated artifacts contain **placeholders only** — never secret values.
- `generate` refuses to write output that trips the secret scanner.
- Credentials reach the verifier **only via operator ENV**, never CLI args,
  and are never printed, logged, or stored.
- Secrets live in client-owned dashboards + client-owned secret storage.

## Quick start (Acme dry run)

```bash
pnpm factory validate scripts/deployment-factory/examples/acme-learning-academy.json
pnpm factory generate scripts/deployment-factory/examples/acme-learning-academy.json \
  --out deployment-output/acme-2026-01 --confirm acme-2026-01
pnpm factory secret-scan deployment-output/acme-2026-01
pnpm factory preflight
pnpm factory gen-secret            # stdout only — paste into Render, never into a file
pnpm factory verify-deploy --api https://api.client.com --frontend https://learn.client.com \
  --mode smoke --config scripts/deployment-factory/examples/acme-learning-academy.json
```

Full mode (needs operator env, all optional except admin for authed checks):

```bash
LMS_ADMIN_EMAIL=... LMS_ADMIN_PASSWORD=... \
LMS_STUDENT_EMAIL=... LMS_STUDENT_PASSWORD=... \
LMS_SUPABASE_URL=... LMS_SUPABASE_ANON_KEY=... \
pnpm factory verify-deploy --api ... --frontend ... --mode full --config ... --json verification.json
pnpm factory verify-db --json db.json   # env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
FACTORY_BACKUP_ACK=1 FACTORY_VERIFIED_BY="Name" pnpm factory handoff \
  --config ... --verification verification.json --db db.json --out handoff-report.md
```

## Files

- `examples/acme-learning-academy.json` — fictional client (dry-run input).
- `src/types.ts` — canonical NON-SECRET config shape (DTO-aligned names).
- `src/validate.ts` — gate: required/email/URL/locale/timezone/currency/FY/tax/theme/origin rules + unknown-field rejection.
- `src/guards.ts` — demo/localhost/reserved-domain/reuse guards.
- `src/env-templates.ts` — Render + Vercel templates (authoritative contract incl. keys missing from `.env.example`).
- `src/business-config.ts` — exact `PUT /business-config` payload.
- `src/first-admin-sql.ts` — SQL template + final renderer (UUID/email validated).
- `src/dns-sheet.ts`, `src/checklist.ts` — operator sheets (manual execution).
- `src/preflight.ts` — node/pnpm/git/chain/determinism/secret checks.
- `src/db-verify.ts` — read-only fresh-DB verifier (GET only; RLS = WARN + SQL fallback).
- `src/deploy-verify.ts` — smoke/full HTTP verifier with evidence JSON.
- `src/provider-probes.ts` — declared-vs-observed provider states.
- `src/handoff-report.ts` — secret-free report (self-scanned before return).
- `src/secret-scan.ts` — placeholder-aware secret scanner.
- `src/cli.ts` — `validate|generate|gen-secret|first-admin|preflight|verify-db|verify-deploy|secret-scan|handoff`.

## Limitations (not blockers)

- RLS/policies need the SQL-Editor queries (pg_catalog not REST-exposed) — verifier emits WARN + exact SQL.
- Storage anon-denial is a WARN-level probe; confirm with the runbook supabase-js spot-checks.
- Provider states are DECLARED until live evidence proves otherwise.
- Node 20+ required (`Intl.supportedValuesOf('timeZone')` for timezone validation).
