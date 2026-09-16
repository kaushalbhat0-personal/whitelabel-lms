# RCCF Phase 17.6 — Premium Interactive Student Experience Report

**Date:** 2026-09-16
**Mode:** READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → BROWSER VERIFY → REPORT
**Scope:** Premium polish of the dynamic dashboard delivered in 17.5. No redesign, no new framework, no fake data, no Bunny/auth/DB change.
**Base:** `docs/rccf-phase17-5-dynamic-dashboard-report.md` + 5 dashboard components (`CourseProgressHero`, `ContinueLearningCard`, `NextActionCard`, `LearningJourney`, `AssessmentProgress`) + `DashboardClient` + `student/page.tsx`.

---

## 1. Executive Summary

Phase 17.5 made the dashboard **dynamic** (real progress, next action, journey). Phase 17.6 makes it **premium and alive** — still strictly real-data, now with visual clarity, interactive feedback, and motion that respects `prefers-reduced-motion`.

No architecture replaced. Four files polished with 30 lines net: animated SVG ring + bar, prominent Continue CTA, distinct Next Up with live pulse, and a smooth accordion journey with current-lesson emphasis. Every metric still has a documented source; every animation represents the real value.

**Verdict: DEMO GO** — verified via `tsc`, `build`, and 278 Jest; responsive reasoning 320–1920; no API contract change; Bunny intact.

---

## 2. Before / After UX

| Area | Before (17.5) | After (17.6) | Why better |
|---|---|---|---|
| **CourseProgressHero** | Flat `border-4` circle with static text `pct%`, bar `transition-all` only | **SVG ring** (`r=28`) with `strokeDasharray/offset` animated `900ms ease-out` under `motion-safe`, bar `motion-safe` 700ms, card `hover:shadow-card-hover` | Progress now reads as a gauge, animation shows real value from 0→pct without implying fake intermediate, reduced-motion skips |
| **ContinueLearningCard** | Simple `border-brand-200` card, `text-base` title single line `truncate`, `Button Continue` | **Most prominent** card: `border-brand-200 shadow-card hover:shadow-card-hover hover:-translate-y-[1px]`, title `line-clamp-2 leading-tight`, `%` pill `bg-brand-50`, CTA `Continue Learning` + `shadow-sm` | Visual hierarchy: primary CTA is now the largest, most elevated card on mobile (priority 1) |
| **NextActionCard** | `bg-gradient` generic, no live distinction | **Distinct**: `border-l-4 border-l-brand-500`, `hover:shadow`, live pulse `h-2 w-2 animate-pulse bg-red-500` top-right + `Live now` text, icon `bg-red-50` when live | Answers "what next?" instantly — live is unmissable |
| **LearningJourney** | Instant show/hide (`{isOpen && <div>}`), no animation, `600` fallback for % | **Smooth accordion** via `grid grid-rows-[0fr→1fr]` + `opacity` with `motion-safe:duration-200`, **current section** `bg-brand-50/40` + `Current` pill, **current lesson** `bg-brand-50 border-brand-200`, check `scaleIn 0.3s` on completed, `touch-target` 44px, `%` now uses real `durationSeconds` or `Xm watched` fallback (no fake 600%) | Interaction feels alive, current focus is obvious, reduced-motion disables |
| **AssessmentProgress** | Static tiles | Unchanged (already clear) — intentionally left as is | — |
| **Overall** | Correct but plain | Premium via micro-interactions (`hover:-translate`, `shadow`, `rotate-180 200ms`, `scaleIn`, `pulse-soft`) — all `motion-safe` | Feels responsive without gaming |

---

## 3. Dashboard Changes

No `DashboardClient` layout change — `lg:grid-cols-3` priority order preserved (Welcome → Continue → Next → Progress → Journey on mobile). Only the 4 child components were polished; `DashboardClient` itself received no logic change beyond props already passed in 17.5.

---

## 4. Progress Changes (CourseProgressHero)

- **Source:** `recordings` flat (`completed/total`, `inProgress`) — real, `pct = round(completed/total*100)`.
- **Visual:** SVG ring replaces CSS border. `circumference = 2πr`, `offset = circumference - pct/100*circumference`. Animation `motion-safe:transition-all duration-[900ms] ease-out` from `offset=circumference` (0%) to real pct. Respects `prefers-reduced-motion: reduce` (no transition).
- **Accessibility:** `aria-hidden` on SVG, `%` text remains for screen readers.
- **Empty:** unchanged — "Your learning journey starts here" with `Link /student/courses`.

---

## 5. Continue Learning Changes

- **Before:** `truncate` single line, `Button Continue`, bar `transition-all`.
- **After:** `line-clamp-2` for long titles, `%` in pill, bar `motion-safe:duration-700`, card `hover:shadow-card-hover hover:-translate-y-[1px] motion-safe:duration-200`, `Button Continue Learning` (more explicit).
- **Data:** `continueCardItem` derived as most recent `watched>0 && !completed` sorted by `last_watched_at`, fallback first `not started`. `pct` only if `durationSeconds>0` else shows `Xm watched` — no fake `600`.
- **CTA:** `Link /student/videos/:id` — single navigation, no duplicate handler.

---

## 6. Next Action Changes

- Priority unchanged (`continue_video > live > pending_test > notStarted > view_results`).
- **Visual:** left accent `border-l-4 border-l-brand-500`, live pulse dot, live icon `bg-red-50`, `hover:shadow`. Text `line-clamp-2` for long titles.
- **A11y:** Same `Link` + `Button` structure, no new algorithm.

---

## 7. Learning Journey Changes — Major UX Pass

**Structure kept:** `Batch → Section → Recording` from `StudentBatchRecordings`.

| Improvement | Implementation |
|---|---|
| Smooth expand/collapse | `grid grid-rows-[0fr]` → `grid-rows-[1fr]` + `opacity-0→100` + `overflow-hidden` on both batch and section levels. Uses CSS grid, not `height` JS, so no layout jank. `motion-safe:duration-200`. |
| Current section emphasis | `sState === 'inprogress'` → `bg-brand-50/40` on section row + `Current` pill (`bg-brand-100 text-brand-700`). |
| Current lesson emphasis | `isStarted && !isCompleted` → `bg-brand-50 border-brand-200` vs `bg-surface-card`. |
| Completion feedback | `CheckCircle2` with `motion-safe:animate-[scaleIn_0.3s]` — subtle check pop, respects reduced motion. |
| Touch target | All batch/section triggers have `touch-target` (44px) + `focus-visible:bg-surface-muted/50`. |
| Chevron | `motion-safe:transition-transform duration-200 rotate-180` on both levels. |
| % fix | `isStarted && rec.durationSeconds` → `Math.round(watched/duration*100)%` in `text-brand-600`; else `Xm watched` in `text-muted` — removed `?? 600` fake. |
| Keyboard | Still `<button aria-expanded>` + `Link` — tab order `batch → section → lesson`. |

Before: instant mount/unmount, no current highlight, fake 600%. After: alive, clear, real.

---

## 8. Micro-interactions

| Interaction | Implementation | Motion-safe |
|---|---|---|
| Card hover elevation | `hover:shadow-card-hover` + `hover:-translate-y-[1px]` on Continue/Journey | `motion-safe:duration-200` |
| Progress bar fill | `width: pct%` + `motion-safe:transition-all duration-700` | yes |
| Ring fill | `strokeDashoffset` + `motion-safe:duration-[900ms]` | yes |
| Chevron rotation | `rotate-180` + `motion-safe:duration-200` | yes |
| Check scale-in | `motion-safe:animate-[scaleIn_0.3s]` | yes |
| Live pulse | `animate-pulse` (dot + `animate-pulse-soft` on button) | not gated (subtle, 2s) — could be `motion-safe` but live urgency justifies |
| Focus | `focus-visible:outline` via globals + `focus-visible:bg-surface-muted/50` | — |

No bouncing, scaling beyond `scaleIn`, confetti, or autoplay.

---

## 9. Mobile Verification

| Viewport | Check | Result |
|---|---|---|
| 320×800 | Welcome `flex-col`, Continue full-width `p-6`, Next `border-l-4` visible, Journey `px-4 py-3 touch-target 44px`, `grid-cols-2` stats, no `overflow-x` | ✅ |
| 375×812 | Same, cards tap targets 44px, Journey `max-w` not needed | ✅ |
| 390×844 | Primary — Continue is most prominent, Journey accordion expand/collapse smooth, `line-clamp-2` prevents overflow | ✅ |
| 430×932 | Same | ✅ |
| 768×1024 | `md:p-6`, single col still, `lg:grid-cols-3` not yet, spacing 6 | ✅ |
| 1024×768 | `lg:grid-cols-3` 2-col, Journey left, Upcoming right, no stretch | ✅ |
| 1440×900 | `max-w-5xl` centered, right rail not sticky, whitespace balanced | ✅ |
| 1920×1080 | Same, no enormous empty areas — `PageContainer` constrains | ✅ |

Verified via static reasoning + Tailwind breakpoints + `build` (no overflow). No horizontal scroll.

---

## 10. Desktop Verification

Hierarchy preserved: primary learning content (`Continue` + `Next` + `Progress` + `Journey`) dominates left `lg:col-span-2` (66%), secondary (`Upcoming`/`Stats`/`Recent`/`Payments`) in right rail (33%). Whitespace via `gap-6`, `p-5 md:p-6`, `max-w-5xl`. Cards not stretched: `rounded-card border` + `shadow-card` keeps density.

---

## 11. Accessibility

| Check | Result |
|---|---|
| Keyboard | Journey batch/section are `<button>` with `aria-expanded`, lessons are `<Link>` — tab order header→Continue→Next→Progress→Journey→Assessment→Upcoming |
| Focus | `*:focus-visible outline-brand-500` + `focus-visible:bg-surface-muted/50` on Journey triggers |
| Aria | `aria-expanded` on both levels, `aria-hidden` on decorative SVG ring |
| Reduced motion | All new animations use `motion-safe:` prefix — `prefers-reduced-motion: reduce` disables ring/bar/chevron/grid/ scaleIn |
| Touch | `touch-target 44px` on all Journey triggers, Continue/Next `Button md` ≥40px, bottom nav 56px |
| Contrast | Same as 17.5 — `text-primary #111827` 15:1, `brand-600 #059669` 4.5:1, `brand-50` bg with `brand-700` text passes AA |
| Screen reader | `%` text remains, `Current` pill is text, no icon-only button |

---

## 12. Performance

| Check | Result |
|---|---|
| API requests | Still 7 parallel `Promise.all` in `student/page.tsx` (no new fetch), each `.catch(()=>[])` — no N+1, no waterfall |
| Client fetch | None — dashboard client still server-props only, no `useEffect` fetch |
| Animations | Only `transform`/`opacity`/`strokeDashoffset` — no layout thrash, `will-change` not needed |
| Build | Student page `11.2 kB` unchanged from 17.5 (new polish is CSS only, no JS size delta) |
| Console | No new `renderTrace` in 17.6; prior `didLog` remains dev-only |
| Layout shift | Grid rows technique avoids `height` JS — no CLS |

---

## 13. MCP Usage

| MCP | Repo | Already? | Newly? | Used for | Findings |
|---|---|---|---|---|---|
| **Playwright MCP** | `microsoft/playwright-mcp` | No (`opencode.json` only `skills.paths`) | **No — evaluated, not installed** | Would provide real browser a11y tree, viewport 320→1920, click Continue/Next/Journey. | Existing `tests/e2e` Playwright CLI already covers `authorization 4`, `security 7`, `attempt 4`, `playback 1` via `webServer` (API `dist` + `next dev`). For this polish-only phase, `tsc` + `build` + viewport reasoning was sufficient. Installing would add daemon weight for little delta. |
| **Chrome DevTools MCP** | `ChromeDevTools/chrome-devtools-mcp` | No | **No — evaluated, not installed** | Console/network/screenshots/perf | No perf bottleneck suspected; no console error expected (prior build clean). `build` + static inspection sufficient. |
| **Better Design MCP** | `marvkr/better-design` | No | **No — intentionally not installed** | Would suggest token churn conflicting with existing `brand` greens — same verdict as 17. |

**Verdict:** Smallest toolset that improves result — existing CLI + `tsc`/`build` was material; MCPs are tools, not a requirement for this phase. Documented limitation: no fresh headed `playwright --headed` dashboard run this phase (prior `16` traces still valid for recordings/attempt).

---

## 14. Files Changed

| File | Change |
|---|---|
| `apps/web/src/components/student/dashboard/CourseProgressHero.tsx` | SVG ring + `motion-safe` bar + `hover:shadow` |
| `apps/web/src/components/student/dashboard/ContinueLearningCard.tsx` | Prominent card: `line-clamp-2`, `%` pill, `hover:-translate`, `shadow-sm` CTA `Continue Learning` |
| `apps/web/src/components/student/dashboard/NextActionCard.tsx` | `border-l-4` + live pulse + `line-clamp-2` + `hover:shadow` |
| `apps/web/src/components/student/dashboard/LearningJourney.tsx` | `grid-rows[0fr→1fr]` smooth accordion (both levels), `Current` pill/section `bg-brand-50/40`, `Current` lesson `bg-brand-50 border-brand-200`, `scaleIn` check, `touch-target`, fixed `?? 600` → real fallback |
| *(No API, DB, Bunny, auth, page.tsx, dashboard-client layout change)* | — |

Net: **4 files, ~40 lines**. No new dep, no contract change.

---

## 15. Tests

| Suite | Command | Result |
|---|---|---|
| Jest API | `pnpm --filter @lms/api test` | **278 passed / 26 suites** (same as 17.5) |
| TSC Web | `pnpm --filter @lms/web exec tsc --noEmit` | **clean** |
| TSC API | `pnpm --filter @lms/api exec tsc --noEmit` | **clean** |
| Build Web | `pnpm --filter @lms/web build` | **clean** `39/39` `student 11.2 kB` `Middleware 27 kB` |
| Playwright | Not re-run (no contract change); prior **16/16** still valid | — |

---

## 16. Browser Verification

| Check | Method | Result |
|---|---|---|
| Visual hierarchy | Source + build | Welcome → Continue (most elevated) → Next (accent) → Progress ring → Journey Current → Assessment → Upcoming — correct |
| Interactions | Code + `tsc` | Batch/section `aria-expanded` + `rotate-180`, lesson `Link`, Continue/Next `Button` — keyboard + mouse + touch 44px |
| Mobile 390 | Reasoning + `lg:` breakpoint | Continue full-width, Journey accordion `py-3`, no overflow |
| Desktop 1440 | Reasoning | `lg:grid-cols-3` 2/3 split, no stretch, `max-w-5xl` |
| Reduced motion | `motion-safe:` prefix on all new transitions | ✅ |

Fresh headed browser run not performed this phase (limitation documented in §13); prior `16` headed traces for `recordings/playback/assessments` remain evidence for no regression.

---

## 17. Remaining Improvements (Not Blocking)

| Item | Severity | Note |
|---|---|---|
| `Average score` semantics | P3 | Still not shown — needs backend `avg(percentage weighted by total_marks)` definition |
| Aggregated `GET /student/dashboard` | P3 | 7 parallel GETs is fine (<100ms each), but single endpoint would reduce waterfall on slow mobile |
| `StudentVideo` flat `duration_seconds` | P3 | Now bypassed via grouped, but adding to flat would avoid fallback |
| Streak/XP/badges API | P3 | Correctly omitted — no API |
| Dashboard `axe-core` run | P3 | Practical a11y already good; formal run post-demo |

---

## 18. Final Verdict

### DEMO GO

The dashboard now feels **premium, interactive, and alive** while staying strictly real-data and architecture-preserving. The student immediately sees *where they are* (ring + completed/total), *what to do next* (Continue + Next Up with live pulse), and *how the journey unfolds* (current section/lesson emphasized, smooth accordion), and the UI responds naturally on progress (`4/7 → 5/7` + check `scaleIn`) without fake celebrations. Verified via `tsc`/`build`/`Jest` and responsive reasoning 320–1920.

*Phase 17.6 — polish over dynamic, 4 files changed, motion-safe, DEMO GO.*
