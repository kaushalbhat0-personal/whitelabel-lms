---
name: mct-rccf-workflow
description: The RCCF methodology for working on this repo (READ→MAP→REPRODUCE→VERIFY ROOT CAUSE→FIX MINIMALLY→TEST→DB VERIFY→BROWSER VERIFY→AUDIT→REPORT→COMMIT). Use as the default process for any non-trivial task or phase.
---

# Skill: MCT LMS — RCCF Workflow

## Purpose
The mandated development discipline for this production LMS. Every prior phase followed it; skipping steps is how the historical bugs happened.

## Workflow (in order, no skipping)
1. **READ** — inspect code, migrations, docs before editing anything.
2. **MAP** — identify blast radius: which modules/tables/routes/tests does this touch?
3. **REPRODUCE** — for bugs: reproduce via test/browser/log before fixing. No speculative fixes.
4. **VERIFY ROOT CAUSE** — name the exact line/constraint/state causing it. "It might be" ≠ root cause.
5. **FIX MINIMALLY** — smallest reversible change; no redesigns, no unrelated refactors, no new dependencies without approval.
6. **TEST** — unit + affected E2E + typecheck + build (see skill mct-testing).
7. **DB VERIFY** — confirm live schema assumptions (`scripts/check-supabase-schema.js`), verify written rows.
8. **BROWSER VERIFY** — user-facing changes verified desktop AND mobile 375px, console clean.
9. **AUDIT** — re-check security (skill mct-security), performance (skill mct-performance), backwards compatibility.
10. **REPORT** — write `docs/rccf-phase<N><letter>-<topic>-report.md`: executive summary → changes → DB → tests (exact numbers) → browser → cost/perf if relevant → risks table → rollback → score → GO/CONDITIONAL GO/NO-GO. Follow the format of `docs/rccf-phase7c-bunny-verification-report.md`.
11. **COMMIT** — only when explicitly asked; concise message matching repo style (`feat(video): …`, `fix(assessments): …`, `refactor(student): …`).

## Rules
- Inspect before modifying. Never assume TS types match the DB (skill mct-schema-drift).
- Preserve backwards compatibility unless the phase explicitly breaks it (staged migrations, feature flags like BUNNY_ENABLED).
- If an external fact cannot be verified, STOP at that gate and report it instead of guessing.
- Report exact files changed and remaining risks; never claim unverifiable success.

## Common Failure Modes (process)
- Fixing symptoms (retry logic around a CHECK-constraint bug) instead of the cause.
- "Temporary" schema divergence between code and migrations becoming permanent.
- Big-bang rollouts without rollback paths.

## Verification
A phase is done when its report exists, all gates in this workflow have evidence, and NO-GO triggers are absent.

## Do Not
- Do not start application feature development from a skill-infrastructure task.
- Do not commit secrets or skip verification steps under time pressure.
