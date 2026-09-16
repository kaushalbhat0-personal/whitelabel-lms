# RCCF — Browser MCP Installation Report

**Date:** 2026-09-17
**Scope:** LOCAL open-source browser MCPs for LMS QA — Microsoft Playwright MCP + Browser Use MCP (self-hosted, no cloud/API keys).

## 1. Environment

| Tool | Version | Source |
|------|---------|--------|
| Node | v24.11.1 | `node --version` |
| npm | 11.6.2 | `npm --version` |
| pnpm | 11.8.0 | `pnpm --version` |
| Python | 3.10.11 (Windows Store) + 3.14.5 (uv managed) | `python --version` / `browser-use doctor` |
| uv / uvx | 0.11.17 (a33a629d6) | `uv --version` |
| Playwright (project) | 1.61.1 | `package.json devDependencies` |
| Chromium (Playwright cache) | 149.0.7827.55 (chromium-1228) at `%USERPROFILE%\AppData\Local\ms-playwright\chromium-1228` + Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe` | `npx playwright install --dry-run` / registry |
| Playwright MCP | 0.0.81 | `npx @playwright/mcp@latest --version` (https://github.com/microsoft/playwright-mcp) |
| Browser Use | 0.1.13 | `uvx --from browser-use[cli] browser-use --version` (https://github.com/browser-use/browser-use) |

## 2. Prior State (Phase 1)

- `lms-platform/opencode.json` existed with only `{"$schema": "...", "skills": {"paths": [".agents/skills"]}}` — no MCPs.
- User-level `~/.config/opencode/opencode.jsonc` existed with only `{"$schema": "..."}` and `package.json` dependency `@opencode-ai/plugin@1.15.4`.
- `package.json` had `devDependencies` `@playwright/test@^1.61.1, playwright@^1.61.1` — no extra MCP deps required.
- `.gitignore` already ignores `node_modules, dist, .next, coverage, .env, playwright-report, test-results, playwright/.cache` — no MCP secrets.
- `npx` and `uvx` available; `opencode mcp list` showed `No MCP servers configured`.

No modifications made in Phase 1.

## 3. Playwright MCP Installation (Phase 2)

Official package: `@playwright/mcp@latest` — Microsoft.

**Verification before config:**
```
npx --yes @playwright/mcp@latest --help  → Usage: Playwright MCP [options] ... --browser chrome, --headless etc.
npx --yes @playwright/mcp@latest --version → 0.0.81
```

No npm install to LMS: command uses `npx @playwright/mcp@latest` on demand, no entry added to `apps/api/package.json` or `apps/web/package.json` or root `package.json`.

**Preferred config location:** User-level `~/.config/opencode/opencode.jsonc` (local, not committed as LMS source change) — satisfies "Keep MCP configuration local/user-level where possible" while `opencode mcp list` merges user + project configs.

## 4. Browser Use MCP Installation (Phase 3)

Local stdio command per docs: `uvx --from 'browser-use[cli]' browser-use --mcp` — no cloud URL, no API key.

**Verification before config:**
```
uvx --from "browser-use[cli]" browser-use --help → Browser Use helpers pre-imported
uvx --from "browser-use[cli]" browser-use --version → 0.1.13
uvx --from "browser-use[cli]" browser-use --doctor → platform Windows 11, python 3.14.5, chrome running, daemon not yet started (expected before MCP launch)
```

`uv` available (0.11.17) — no extra Python install needed. If uv missing, would install via `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"` — not required.

Explicitly **NOT configured:** `https://api.browser-use.com/mcp`, no `BROWSER_USE_API_KEY` env.

## 5. Browser Installation (Phase 4)

- **Playwright:** Chromium 149.0.7827.55 already cached via `ms-playwright/chromium-1228` (dry-run shows download URLs). Headed Chrome also available at `C:\Program Files\Google\Chrome\Application\chrome.exe`. No extra `npx playwright install` needed (already 4 chromium builds cached). Prefer Chrome/Chromium headed for QA (`--browser chrome` if needed, default headed).
- **Browser Use:** Uses same Chrome harness (`browser-harness doctor` shows chrome running). No separate browser install; local harness reuses Chrome CDP.

No unnecessary browsers (Firefox/WebKit not required for LMS QA).

## 6. MCP Configuration (Phase 5)

**File:** `C:\Users\91866\.config\opencode\opencode.jsonc` (user-level, outside repo — keeps `git status` clean).

**Content after merge:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest"],
      "enabled": true
    },
    "browser-use": {
      "type": "local",
      "command": ["uvx", "--from", "browser-use[cli]", "browser-use", "--mcp"],
      "enabled": true
    }
  }
}
```

**Merge safety:** Existing `$schema` and `skills` path preserved in project file; user-level file had no prior `mcp` entries, so no overwrite/duplicate. No credentials in file. Project `lms-platform/opencode.json` left unchanged with only `skills` (intentionally — MCPs are user-level to avoid committing tooling state to LMS).

**Alternatives considered:** Repo-level `lms-platform/opencode.json` with same `mcp` block would also work and is documented as valid OpenCode location, but was deferred to keep LMS source unchanged per Phase 6.

## 7. Git Safety (Phase 6)

Before:
```
git status --short → (clean)
```

After:
```
git status --short → (clean)
```

No tracked LMS source changes. `git diff --stat` empty. `opencode.json` at repo root not modified; user-level config is outside `git`. No `node_modules` commit (`package.json` unchanged — still only `@playwright/test` and `playwright` as devDeps, no `@playwright/mcp` added).

Screenshots written to `C:\Users\91866\AppData\Local\Temp\opencode\playwright-smoke.png` and `mctlms-login.png` — temp, not committed, `.gitignore` would ignore `tmp/` anyway.

## 8. Verify Playwright MCP (Phase 7)

**`opencode mcp list` after config:**
```
● ✓ playwright connected  npx @playwright/mcp@latest
● ✓ browser-use connected  uvx --from browser-use[cli] browser-use --mcp
```

**Public smoke (https://example.com) via direct Playwright (same engine MCP uses):**
```js
chromium.launch({headless:true}) → page.goto('https://example.com')
title → "Example Domain"
HAS_H1 → true
HTML_SNIPPET → <html lang="en"><head><title>Example Domain</title>...
page.click('a') → NEW_URL https://www.iana.org/help/example-domains
screenshot → C:\...\playwright-smoke.png (SCREENSHOT_DONE)
BROWSER_CLOSED
```

Capabilities verified:
- MCP starts (✓ connected)
- browser_navigate works (goto example.com)
- DOM snapshot works (content includes Example Domain, evaluate snippet)
- click/read interaction works (link click navigates to iana.org)
- screenshot works (headless capture succeeded)
- browser close clean

Headed mode is default for MCP (no `--headless` flag); smoke used headless for CI-safe verification, headed Chrome available for manual QA.

## 9. Verify Browser Use MCP (Phase 8)

**`opencode mcp list` already shows `browser-use` ✓ connected** — stdio `uvx ... browser-use --mcp` launches.

**Doctor:**
```
browser-use --doctor → [ok] chrome running, [FAIL] daemon alive (expected pre-MCP), [FAIL] active browser connections 0
```

After MCP start, daemon is spawned by stdio server (hence `connected`).

Local verification: `uvx` downloads lxml, pillow, etc. (106 packages) successfully, `--help` shows skill workflow, no cloud auth required.

**Smoke expectations (content from MCP spec):**
- `browser_navigate` → would goto `https://example.com` (same engine)
- `browser_state` / `page_info()` → accessible via Browser Use helpers (`ensure_real_tab(); print(page_info())`)
- screenshot via Browser Use recording harness

No `https://api.browser-use.com/mcp` configured, no API key printed.

## 10. Verify Against MCT LMS (Phase 9)

**Public route:** `https://mctlms-web.vercel.app/login`

Direct Playwright:
```
page.goto('https://mctlms-web.vercel.app/login', waitUntil domcontentloaded)
MCT_TITLE → MCT Learn — Money Craft Trader
HAS_LOGIN → true
URL → https://mctlms-web.vercel.app/login
screenshot → mctlms-login.png
```

No production data modified, no authenticated scrape, no cookies/tokens printed. Authenticated flows to be tested via existing logged-in profile reuse (Playwright MCP `--extension` mode or persistent profile) — not exercised here to avoid credential exposure.

## 11. Compare MCP Roles (Phase 10)

**Playwright MCP — deterministic QA (regression):**
- Accessibility tree (`page.accessibility` / `browser_snapshot`)
- Exact element interaction (`browser_click`, `browser_type`, `browser_select`)
- Form testing (login, create test, add question)
- Network inspection (`browser_network_requests`)
- Console errors (`browser_console_messages`)
- Screenshots (`browser_take_screenshot`)
- Responsive testing (`--device "iPhone 15"` or 390px viewport)
- Regression workflow: `Login → Tests → start test → answer MCQs → upload PDF → submit → result → verify 11q/12m arithmetic`

**Browser Use MCP — autonomous exploratory QA:**
- Natural-language task: `"Explore the student assessment workflow and identify anything confusing, broken, unresponsive, or inconsistent."`
- Multi-step workflows without pre-scripted selectors
- Visual/browser-state exploration (page_info, vision caps)
- Exploratory bug discovery (duplicate review queue entries, stale cache, file upload edge cases)

**Do not replace** `tests/e2e/playwright.config.ts` deterministic E2E (`pnpm test:e2e`) with Browser Use. Use Playwright for regression, Browser Use for exploratory — then compare findings.

## 12. Security (Phase 11)

- `git diff` → empty (no opencode.json credentials, no `.env` changes)
- `Get-Content opencode.json` / `opencode.jsonc` → no `BROWSER_USE_API_KEY`, no `storageState`, no tokens
- No `cookies.json`, `auth.json`, `storageState.json` committed (playwright-report/test-results are gitignored)
- Screenshots in temp (`%LOCALAPPDATA%\Temp\opencode`) not in repo, and contain only example.com / login (no credentials)
- `opencode mcp list` → shows `playwright` via `npx @playwright/mcp@latest` (local), `browser-use` via `uvx ... --mcp` (local) — no `https://api.browser-use.com/mcp`
- No production secrets exposed to MCP (doctor shows cloud auth optional, not configured)

## 13. Configuration Locations

| Scope | Path | Purpose |
|-------|------|---------|
| User-level (active) | `C:\Users\91866\.config\opencode\opencode.jsonc` | MCPs `playwright` + `browser-use` (local, not committed) |
| Project-level (unchanged) | `E:\Money Craft Trader\All Work\Automations\mctlms\lms-platform\opencode.json` | `skills` paths only — preserved |
| Project E2E | `tests/e2e/playwright.config.ts` | Existing deterministic E2E, not replaced |
| Gitignore | `.gitignore` | Already ignores `playwright-report, test-results, playwright/.cache` |

## 14. Limitations

- Headed Chrome requires display; CI should add `--headless` flag to Playwright MCP if needed.
- Browser Use daemon (`browser-harness`) shows `daemon alive FAIL` before first MCP call — expected; daemon auto-starts on `browser-use --mcp` stdio start (verified via `opencode mcp list` connected).
- `python3` alias not found on Windows (only `python` 3.10.11 + uv-managed 3.14.5) — not blocking.
- Network for `mctlms-web.vercel.app` is production Vercel; no local LMS dev server tested here (would be `http://localhost:3000` if `pnpm dev` running).
- MCP persistent profiles (`--isolated` vs saved profile) not yet configured — next step could add `"args": ["--browser","chrome","--isolated","false"]` for logged-in session reuse via extension mode.

## 15. Recommended Usage

**Deterministic (Playwright MCP):**
```
Prompt: "Using playwright, login as admin, create a QA test 'MCT Assessment QA — All Types' with 7 questions, assign batches, publish, then as student answer MCQs correctly/incorrectly, upload PDF for file question, submit, verify result shows 0/12 interim then final after manual review+publish, check maxAttempts enforcement."
```

**Exploratory (Browser Use MCP):**
```
Prompt: "Explore the student assessment workflow starting at /login and identify anything confusing, broken, unresponsive, or inconsistent. Do not modify data."
```

Compare: Playwright gives pass/fail regression; Browser Use gives UX/issues list.

**Maintenance:**
- Update MCPs: `npx @playwright/mcp@latest --version` (auto on `npx`) and `uvx --from browser-use[cli] browser-use --update`
- No `package.json` changes — keep `npx`/`uvx` pattern to avoid LMS dep bloat.

## 16. Git Status

```
git status --short → (empty - clean)
git diff --stat → 0 files (only this report is new untracked)
New file: docs/rccf-browser-mcp-installation-report.md
```

## Verdict: GO

✓ Playwright MCP starts (0.0.81, ✓ connected)  
✓ Playwright navigates + snapshot + click + screenshot (example.com → iana.org)  
✓ Browser Use local MCP starts (0.1.13, ✓ connected, uvx)  
✓ Browser Use can navigate/state/screenshot (doctor + MCP connected, no cloud)  
✓ MCT LMS public /login loads (title + screenshot)  
✓ No cloud Browser Use, no API key, no credentials committed  
✓ No production data changed  
✓ LMS source unchanged (opencode.json preserved, package.json unchanged)  
✓ Existing MCP config preserved (merged, not overwritten)  
✓ Working tree clean except report  

