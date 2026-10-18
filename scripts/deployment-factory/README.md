# Deployment Factory (FACTORY-01B) — local operator toolkit

INTERNAL operator tool. Not a SaaS control plane, not multi-tenancy, not
client self-service, not infrastructure orchestration. Dashboards stay manual;
this toolkit **prepares, validates, pushes config, and verifies**.

## Secret policy (non-negotiable)

- Generated artifacts contain **placeholders only** — never secret values.
- `generate` refuses to write output that trips the secret scanner.
- Credentials reach the factory **only via operator ENV**, never CLI args,
  and are never printed, logged, or stored.
- Secrets live in client-owned dashboards + client-owned secret storage.

## Operator workflow (per client)

```bash
pnpm factory init northstar-2026-01 --out clients/northstar.json
# fill every TODO in clients/northstar.json (+ .INTAKE-NOTES.md scratch)
pnpm factory validate clients/northstar.json        # blocks until intake complete
pnpm factory generate clients/northstar.json \
  --out deployment-output/northstar-2026-01 --confirm northstar-2026-01
# ^ auto-checks deployment-output/ for Client A domain reuse (own id excluded)
pnpm factory secret-scan deployment-output/northstar-2026-01
pnpm factory preflight
pnpm factory gen-secret            # stdout only — paste into Render, never into a file
# ... dashboards: Supabase → SQL paste → verify-db → Redis → Render → Vercel → DNS ...
# ... first admin (dashboard Auth user + generated SQL + login + rotate) ...
LMS_ADMIN_EMAIL=... LMS_ADMIN_PASSWORD=... \
pnpm factory push-config --config clients/northstar.json --api https://api.client.com --json push.json
pnpm factory verify-deploy --api https://api.client.com --frontend https://learn.client.com \
  --mode smoke --config clients/northstar.json --json verification.json
```

Full mode (needs operator env, all optional except admin for authed checks):

```bash
LMS_ADMIN_EMAIL=... LMS_ADMIN_PASSWORD=... \
LMS_STUDENT_EMAIL=... LMS_STUDENT_PASSWORD=... \
LMS_SUPABASE_URL=... LMS_SUPABASE_ANON_KEY=... \
pnpm factory verify-deploy --api ... --frontend ... --mode full --config ... --json verification.json
pnpm factory verify-db --config ... --json db.json   # env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
FACTORY_BACKUP_ACK=1 FACTORY_VERIFIED_BY="Name" pnpm factory handoff \
  --config ... --verification verification.json --db db.json --out handoff-report.md
# WARNs you manually confirmed: repeat --ack-warn "<label substring>"
# Genuinely no verification yet: --no-verification --reason "<why>" (stays NOT READY)
pnpm factory known-domains   # list prior client domains from local output (no registry)
```

## Files

- `examples/acme-learning-academy.json` — fictional client #1 (dry-run input).
- `examples/northstar-learning-academy.json` — fictional client #2 (dry-run input).
- `src/types.ts` — canonical NON-SECRET config shape (DTO-aligned names + admin/ownership).
- `src/validate.ts` — gate: required/email/URL/locale/timezone/currency/FY/tax/theme/origin/admin/ownership rules + unknown-field rejection.
- `src/guards.ts` — demo/localhost/reserved-domain/reuse guards (incl. admin.email).
- `src/intake.ts` — `factory init` skeleton (placeholders fail validation by design) + intake notes.
- `src/known-domains.ts` — local output scan for domain reuse (no registry, self excluded).
- `src/env-templates.ts` — Render + Vercel bulk-paste blocks (authoritative contract incl. keys missing from `.env.example`).
- `src/business-config.ts` — exact `PUT /business-config` payload.
- `src/push-config.ts` — `factory push-config` (env-creds login + complete PUT + secret-free evidence).
- `src/first-admin-sql.ts` — SQL template (prefers explicit `admin.*`) + final renderer (UUID/email validated).
- `src/dns-sheet.ts`, `src/checklist.ts` — operator sheets (manual execution).
- `src/preflight.ts` — node/pnpm/git/chain/determinism/secret checks.
- `src/db-verify.ts` — read-only fresh-DB verifier (GET only; RLS = WARN + SQL fallback; evidence carries host + client identity, never keys).
- `src/deploy-verify.ts` — smoke/full HTTP verifier with evidence JSON (full public + authed BusinessConfig drift comparison).
- `src/provider-probes.ts` — declared-vs-observed provider states.
- `src/handoff-report.ts` — strict evidence gate (READY needs both evidences + identity match + backup + verifier + no unacked WARN) + secret-free report.
- `src/secret-scan.ts` — placeholder-aware secret scanner.
- `src/cli.ts` — `init|validate|generate|gen-secret|first-admin|preflight|push-config|verify-db|verify-deploy|known-domains|secret-scan|handoff`.

## Limitations (not blockers)

- RLS/policies need the SQL-Editor queries (pg_catalog not REST-exposed) — verifier emits WARN + exact SQL.
- Storage anon-denial is a WARN-level probe; confirm with the runbook supabase-js spot-checks.
- Provider states are DECLARED until live evidence proves otherwise.
- Node 20+ required (`Intl.supportedValuesOf('timeZone')` for timezone validation).
