# Debugging E2E Tests

## Artifacts on Failure

The framework automatically captures on failure:

| Artifact | Location | Config |
|----------|----------|--------|
| Playwright trace | `test-results/**/*.zip` | `trace: 'retain-on-failure'` |
| Screenshot | `test-results/**/*.png` | `screenshot: 'only-on-failure'` |
| Video (CI only) | `test-results/**/*.webm` | `video: 'retain-on-failure'` on CI |
| JSON report | `test-results/e2e-results.json` | On CI only |

Open the HTML report:

```bash
npx playwright show-report tests/e2e/playwright-report
```

Open a specific trace:

```bash
npx playwright show-trace tests/e2e/test-results/trace.zip
```

## Running with Debug Logs

```bash
DEBUG=pw:api npx playwright test
```

## Running a Single Test

```bash
npx playwright test recordings/upload.spec.ts
npx playwright test -g "Test 8"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key (bypasses RLS) |
| `E2E_ADMIN_EMAIL` | No (default: `admin@example.com`) | Admin login email |
| `E2E_ADMIN_PASSWORD` | No (default: `Admin1234!`) | Admin login password |
| `E2E_STUDENT_A_EMAIL` | No | Student A login email |
| `E2E_STUDENT_A_PASSWORD` | No | Student A login password |
| `E2E_STUDENT_B_EMAIL` | No | Student B login email |
| `E2E_STUDENT_B_PASSWORD` | No | Student B login password |
| `API_URL` | No (default: `http://localhost:3001`) | API base URL |
| `CI` | No | Set `true` for CI mode (retries, artifacts, JSON reporter) |

## Pre-requisites

Before running tests, ensure:

1. Test users exist in Supabase Auth with matching `profiles` table rows
2. User passwords are bcrypt-hashed and match the env vars
3. Supabase service-role key has permissions to read/write all test tables
4. The API server is running (or `webServer` config in `playwright.config.ts` handles it)
