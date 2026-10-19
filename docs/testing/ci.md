# CI — Current Posture

> There is currently **no GitHub Actions workflow** configured for this repository
> (`.github/workflows/` is empty). Do not assume CI is running.

## What runs instead (operator / local gates)

| Gate | Command | What it proves |
|---|---|---|
| Factory suite | `pnpm factory:test` | Config validation, timezone allowlist, template pins, verification, handoff gates |
| Marketing suite | `pnpm test:marketing` | Demo URL normalization contract |
| API unit tests | `pnpm --filter @lms/api test` | Service-level regression (run before release) |
| Typechecks | `pnpm --filter @lms/api typecheck`, web/marketing equivalents | Compile safety |
| DB generation drift | `pnpm db:generate` + `git diff --exit-code` | Canonical migrations match generated SQL |
| Factory preflight | `pnpm factory preflight` | Node/pnpm versions, git state, migration continuity, deterministic SQL rebuild |

## Playwright E2E (local only)

The Playwright suites under `tests/e2e/` (including `recordings`) run locally:

```bash
pnpm exec playwright test --config=tests/e2e/playwright.config.ts --workers=1
```

E2E credentials live in `tests/e2e/.env.example` (dummy local values only).
E2E requires a live API + seeded database; it is not wired to any hosted CI.

## If CI is introduced later

Any future workflow must, at minimum, run the six gates above and publish
their exact counts. Until such a workflow exists and is green on `main`,
release readiness is established by the operator running this document's
commands and recording the results in the release report — never by assuming
a badge or a historical workflow file.
