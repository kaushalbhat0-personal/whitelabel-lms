# RCCF Report — Phase 7D: Project Skills + MCP Engineering Intelligence Layer

**Objective:** turn `.agents/skills/` into a serious, MCT-LMS-specific knowledge layer so future OpenCode agents enter the repository already knowing the architecture, the DB contracts, and the mistakes of Phases 2–7 — without changing any application behaviour.

**Scope discipline:** zero application code changed. Deliverables are skills, an opencode skill-registration config, this report, and an MCP audit.

---

## 1. Repository Audit

### Stack (verified from code/config, not filenames)
- **Web:** Next.js 14 App Router / React 18 / Tailwind / zustand / hls.js / `@supabase/ssr` (`apps/web`)
- **API:** NestJS, service-role Supabase REST, ioredis, axios, `@mux/mux-node`, @nestjs/schedule cron jobs (`apps/api`, port 3001)
- **DB:** Supabase Postgres, snake_case; **`scripts/migrations/004→035` authoritative; `scripts/schema.sql` stale/partial**
- **Cache/sessions:** Redis (single-device sessions, playback/join tokens, rate limits — all via `REDIS_KEYS` constants)
- **Video:** dual-provider abstraction (MuxProvider/BunnyProvider) behind `RecordingProviderResolver`; Batch 1 = Mux, Batch 2+ = Bunny
- **Live classes:** canonical `live_sessions` trio + legacy read-model layer; Zoom S2S OAuth + signed webhooks
- **Testing:** Jest unit (20 suites/228 tests), Playwright E2E (projects `recordings-api`, `assessments-api`; stateful against real Supabase)
- **Modules present but notable:** `modules/videos/*` is dead code (not registered in AppModule); `trading-sessions` is part of the live-class legacy read path.

### Existing-skill audit
`.agents/skills/` existed and was **empty**. Nothing to merge or preserve; no pre-existing convention to follow beyond OpenCode's standard `SKILL.md` frontmatter format. A project `opencode.json` did not exist, so one was created registering the folder for discovery.

---

## 2. Skills Created

| # | Skill | Path | Purpose |
|---|-------|------|---------|
| 1 | mct-lms-architecture | `.agents/skills/mct-lms-architecture/SKILL.md` | Repo map, stack facts, authoritative-source hierarchy |
| 2 | mct-auth-authorization | `.agents/skills/mct-auth-authorization/SKILL.md` | Full auth chain, single-device sessions, batch isolation, past auth bugs |
| 3 | mct-video-pipeline | `.agents/skills/mct-video-pipeline/SKILL.md` | Mux/Bunny dual provider, resolver policy, CDN tokens, webhooks, never-delete-Mux rule |
| 4 | mct-assessments | `.agents/skills/mct-assessments/SKILL.md` | Attempt lifecycle, DB contracts incl. drift incidents, answer-leakage prevention |
| 5 | mct-live-classes | `.agents/skills/mct-live-classes/SKILL.md` | Canonical vs legacy tables, Zoom webhook contract, attendance, join tokens |
| 6 | mct-admin-portal | `.agents/skills/mct-admin-portal/SKILL.md` | Admin routes, tables/modals conventions, upload modal TUS limitation |
| 7 | mct-student-portal | `.agents/skills/mct-student-portal/SKILL.md` | Single-mount rule, page map, HLS prefs-reset bug institutionalized |
| 8 | mct-api-development | `.agents/skills/mct-api-development/SKILL.md` | NestJS patterns specific to repo (envelope, Transaction util, N+1 fixes) |
| 9 | mct-frontend-development | `.agents/skills/mct-frontend-development/SKILL.md` | fetchApi contract, effect hazards, HLS dependency-array rule |
| 10 | mct-testing | `.agents/skills/mct-testing/SKILL.md` | Commands, projects, fixtures, DB verification, anti-fake-test rules, known flake |
| 11 | mct-rccf-workflow | `.agents/skills/mct-rccf-workflow/SKILL.md` | READ→…→COMMIT methodology + report format |
| 12 | mct-production-debugging | `.agents/skills/mct-production-debugging/SKILL.md` | Symptom playbooks (401/403/PGRST/buffering/duplicates/webhooks/CORS/env) |
| 13 | mct-schema-drift | `.agents/skills/mct-schema-drift/SKILL.md` | Never-trust-TS-types doctrine, incident register, check-supabase-schema.js usage |
| 14 | mct-security | `.agents/skills/mct-security/SKILL.md` | 10-point endpoint checklist, secrets policy, historical vulnerabilities |
| 15 | mct-performance | `.agents/skills/mct-performance/SKILL.md` | Measured bottlenecks + fixes, query rules, CDN cost dimension |

Each skill uses the mandated structure (Purpose / When to Use via description / Architecture / Important Files / Database Contracts / Rules / Common Failure Modes / Verification / Do Not) with trigger-rich frontmatter descriptions.

### Config created
| File | Purpose |
|---|---|
| `opencode.json` (repo root) | Registers `.agents/skills` via `skills.paths` so OpenCode discovers the SKILL.md files (standard loader scans only `.opencode/skills` and `~/.agents/skills` by default). No MCP servers activated. |

---

## 3. Existing Skills Improved
None existed — greenfield. (Audit performed first per instructions: folder present but empty.)

---

## 4. MCP Audit

Availability verified against official upstreams (all free/open-source; nothing installed in this phase):

| MCP | Purpose | Free? | Recommended? | Reason / Risk |
|---|---|---|---|---|
| `@playwright/mcp` (Microsoft, official) | Interactive browser automation for manual verification (beyond the existing test suite): click-through flows, console/network inspection on dev | Yes (OSS, npx) | ✅ MUST HAVE | Low risk — local browser only |
| `@supabase/mcp-server-supabase` (Supabase, official) | Live schema introspection + read SQL against the real project — directly serves the schema-drift defense | Yes (OSS; free personal access token) | ✅ MUST HAVE — **only with `--read-only`** | High if read-write on production; mitigate via read-only flag + narrowly scoped token; never service-role key |
| `github/github-mcp-server` (GitHub, official) | PRs/issues/CI reads for `moneycrafttrader/mctlms` remote | Yes (OSS; PAT required) | 🟡 USEFUL | Token-scope discipline; not needed for daily local work |
| Generic Postgres MCPs (archived reference server, crystaldba) | Direct pg SQL | Yes | ❌ Not needed | Supabase MCP supersedes; repo env has no raw connection string anyway |
| Filesystem MCP | File access | — | ❌ Not needed | OpenCode has native read/edit/grep tools |
| Redis MCP (community) | Cache inspection | Unofficial only | ❌ Not recommended | No reliable first-party server; marginal value vs risk |
| Web/docs research MCP | Documentation lookups | — | ❌ Not needed | OpenCode ships websearch/webfetch |

## 5. Recommended MCP Setup

**Must have:** Playwright MCP + Supabase MCP (read-only).
**Useful:** GitHub MCP.
**Not needed:** filesystem, generic postgres, redis, docs MCPs.

Ready-to-paste snippet when approved (**no secrets inline — `{env:*}` interpolation only**):

```jsonc
// lms-platform/opencode.json  →  "mcp" section (add after generating tokens;
// restart opencode afterwards). Do NOT commit token values anywhere.
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true
    },
    "supabase": {
      "type": "local",
      "command": [
        "npx", "-y", "@supabase/mcp-server-supabase",
        "--read-only",
        "--project-id=fdocnxtqyhngrfgslifi"
      ],
      "enabled": true,
      "environment": { "SUPABASE_ACCESS_TOKEN": "{env:SUPABASE_ACCESS_TOKEN}" }
    },
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "enabled": false,
      "environment": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_PAT}" }
    }
  }
}
```
Notes: Supabase access token is a free dashboard-generated personal token scoped to the user — store it in the local environment, never in files. Keep `github.enabled:false` until a PAT with minimal scope is provisioned. The project id shown is the known dev/prod project host from Stage-1 verification; confirm before wiring against production data.

---

## 6. Security Considerations
- Full-repo secret scan over new files: **CLEAN** (patterns: JWT prefixes, PEM blocks, key material). Skills reference env-var NAMES only.
- Skills explicitly encode: webhook signature enforcement, provider-scoped mutations, answer-leakage bans, IDOR sweeps, secrets-rotation policy.
- MCP policy encoded above: read-only DB access preferred; no destructive tooling without explicit approval; no paid services.

## 7. Knowledge Architecture
Discovery chain for a fresh agent: `mct-lms-architecture` (orientation) → task-domain skill (video/auth/assessments/live/admin/student/api/frontend) → process skills (rccf-workflow, testing, schema-drift, security, performance, debugging). Cross-references keep each file small; authoritative detail stays in source + RCCF reports, which skills point to rather than duplicate.

## 8. Future-Agent Workflow
Standard loop now possible without archaeology: orient via architecture skill → load domain skill → verify DB assumptions via `scripts/check-supabase-schema.js` (or future read-only Supabase MCP) → implement under RCCF workflow → prove via testing skill gates → report.

## 9. Remaining Gaps (knowledge that could not be confidently established)
1. `apps/web/src/middleware.ts` exact role-gating logic was only lightly inspected (matcher confirmed; internal rules not traced line-by-line).
2. Deployment topology for the API (Vercel functions vs long-lived host) inferred from vercel.json/cron design but unverified against actual hosting config.
3. Live `recordings_provider_check` constraint introspection still pending the ops SQL from Phase 7C §2.
4. Bunny pilot realities (credentials, browser run, measured costs) remain open items owned by Phases 7C-runbook/7E.
5. Root cause of the pre-existing `assessments/browser-ui.spec.ts` flake (800 ms wait) unknown.
6. Whether any team members rely on undocumented workflows not captured in reports.

## 10. Dangerous Areas (extra caution for future agents)
1. `scripts/schema.sql` — stale; using it will reintroduce drift bugs.
2. Legacy session tables & `modules/videos/*` — must not gain writers/new callers.
3. Provider identifier columns (`mux_*`) on bunny rows — rename only at retirement phase.
4. HLS init-effect dependencies — regression = mid-playback buffer resets.
5. Webhook handlers — rawBody preservation + exact payload contracts (Zoom url_validation).
6. CHECK-constrained status columns ('processing'|'ready'|'failed').
7. E2E suite mutates the real Supabase project — respect fixtures/cleanup.
8. Migration deploy order (schema before API) for additive migrations like 035.

## 11. Verification
- All 15 skills: `SKILL.md` present, folder name == `name:` field, both frontmatter fields present (scripted check output above).
- Secret scan across `.agents/**` and `opencode.json`: CLEAN.
- Application code: **zero changes** — `git status --short -- apps packages scripts` shows only pre-existing parallel work unrelated to this phase; this phase added `.agents/` (new) and `opencode.json` (new) plus this report.
- Production configuration: untouched (no env files modified, no credentials rotated or referenced).
- `opencode.json` shape follows the published config surface (`skills.paths`); restart of OpenCode required for discovery.

## 12. Recommendation & Classification

**READY.**
The skill layer is coherent, secure, repository-specific, and immediately reusable; the two highest-value MCPs are identified with safe configuration pending only free token provisioning and explicit approval. The single most important outcome holds: a new agent can now learn *Batch 1 = Mux / Batch 2+ = Bunny coexists until soak*, *the HLS prefs-dependency ban*, *migrations-over-schema.sql*, and the full auth/batch isolation model before writing a line of code.

Suggested next steps (non-blocking): provision `SUPABASE_ACCESS_TOKEN` (+ optional PAT), enable the two Must-Have MCPs, and let the next feature phase (7E or Bunny pilot support incl. the TUS web uploader) validate the skill system in practice.
