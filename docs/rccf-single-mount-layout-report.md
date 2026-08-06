# RCCF Report — Student Layout Single-Mount Refactor

**Goal:** Eliminate the P1 double-mount issue where the student layout rendered the application twice. Keep the UI **100% visually identical** while mounting every page exactly once.

**Result:** ✅ All success criteria met. **1 file changed** (`apps/web/src/app/student/layout.tsx`). Zero regressions (43 API + 62 e2e + 28 admin routes + all student pages/viewports pass). **Production ready.**

---

## 1. Root Cause

`apps/web/src/app/student/layout.tsx` rendered `{children}` **twice** — once in the desktop shell and once in the mobile shell — relying on CSS (`hidden md:flex` / `md:hidden`) to show only one.

```jsx
// OLD — children mounted twice
<div className="hidden md:flex">          {/* desktop shell */}
  <aside>...</aside>
  <main className="ml-60">
    <header>...</header>
    <div className="max-w-5xl px-6 py-8">{children}</div>   {/* COPY 1 */}
  </main>
</div>
<div className="md:hidden">               {/* mobile shell */}
  <main className="pb-20">{children}</main>                  {/* COPY 2 */}
  <StudentBottomNav />
</div>
```

Because `{children}` is a single React node mounted into **two DOM locations**, React instantiates the entire page twice: duplicate component state, duplicate effects, duplicate API calls, duplicate DOM.

**Browser-verified before refactor** (single attempt page load, mobile 390px):
- `startAttempt` POST: **2** (two effects each firing the attempt-start call)
- `<main>` tags: **3** (layout desktop main + layout mobile main + page main)
- Total DOM nodes: **226**
- Duplicate radio inputs, duplicate question blocks, duplicate video player + watermark (2 each)
- `validate-session` heartbeat: **3×**

The duplicate attempt-start call was partially masked because the backend dedupes `in_progress` attempts (returns the existing one), so no duplicate DB row was created — but the duplicate network/DB/Redis work and DOM were still occurring.

## 2. Old Render Tree

```
StudentLayout
├── SessionExpiredOverlay
├── GuardRoute
│   └── div.min-h-screen.bg-surface-page
│       ├── div.hidden.md:flex                       ← DESKTOP SHELL
│       │   ├── aside.fixed (StudentSidebar)
│       │   └── main.ml-60
│       │       ├── header (bell, "Student Dashboard")
│       │       └── div.max-w-5xl.px-6.py-8
│       │           └── {children}                   ← MOUNT 1
│       └── div.md:hidden                            ← MOBILE SHELL
│           ├── main.pb-20
│           │   └── {children}                       ← MOUNT 2 (DUPLICATE)
│           └── StudentBottomNav (fixed)
```

- **2 React trees created** for the page content
- **2 copies of children**, 2 client mounts, 2× effects, 2× API calls

## 3. New Render Tree

```
StudentLayout
├── SessionExpiredOverlay
├── GuardRoute
│   └── div.min-h-screen.bg-surface-page
│       ├── aside.fixed.hidden.md:flex (StudentSidebar)      ← ONCE
│       ├── main.ml-0.md:ml-60.flex-1.min-h-screen           ← SINGLE COLUMN
│       │   ├── header.hidden.md:flex (bell, dashboard label) ← ONCE
│       │   └── div.max-w-5xl.px-0.md:px-6.pt-0.md:pt-8.pb-20.md:pb-8
│       │       └── {children}                               ← MOUNTED ONCE
│       └── StudentBottomNav.md:hidden (fixed)               ← ONCE
```

- **1 React tree**, 1 copy of children, 1 client mount, 1× effects, 1× API calls
- All chrome (sidebar / desktop header / bottom nav) rendered once with responsive visibility
- Page-padding contract preserved: mobile `pb-20` (bottom-nav clearance), desktop `px-6 pt-8 pb-8`; pages keep their own `px-4 md:px-0`

## 4. Files Changed

| File | Change |
|------|--------|
| `apps/web/src/app/student/layout.tsx` | Restructured to single content container; desktop sidebar/header and mobile bottom-nav now responsive siblings around one `{children}` |

No other files changed. Routing, auth, middleware, providers, navigation components, styling, playback, tests, and APIs untouched.

## 5. Browser Verification

| Workflow | Desktop (1440) | Tablet (768) | Mobile (390) |
|----------|----------------|--------------|--------------|
| Login → dashboard | ✅ | ✅ | ✅ |
| Courses list + detail | ✅ | ✅ | ✅ |
| Videos (grouped) | ✅ | ✅ | ✅ |
| Video player | ✅ player ×1 | ✅ | ✅ player ×1 |
| Tests list | ✅ | ✅ | ✅ |
| Test attempt (full flow: answer→submit→result) | ✅ | — | ✅ `startAttempt ×1` |
| Results + result detail | ✅ | ✅ | ✅ |
| Notifications | ✅ | ✅ | ✅ |
| Profile | ✅ | ✅ | ✅ |
| Live sessions | ✅ | ✅ | ✅ |
| Logout | ✅ →/login | — | ✅ →/login |
| Mobile bottom-nav "More" drawer | — | — | ✅ (1 button, drawer links navigate) |

**Breakpoint boundaries** (verified at 767/768/769/1023/1024px): 767→mobile shell, 768→desktop shell (sidebar+header shown, bottom nav hidden), no horizontal overflow at any boundary — identical to original `md:` behavior.

**Console/network:** 0 console errors, 0 page errors, 0 slow requests on every page.

## 6. Performance Comparison

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| `startAttempt` POST per attempt-page load | **2** | **1** | −50% |
| `<main>` tags (attempt page) | **3** | **2** | −1 duplicated shell |
| Total DOM nodes (attempt page) | **226** | **215** | −11 |
| Video player elements | **2** | **1** | −1 (was duplicated) |
| Watermark text instances | **2** | **1** | −1 (was duplicated) |
| Question text occurrences (attempt) | **2** | **1** | −1 duplicate |
| `validate-session` heartbeat (dashboard+attempt) | 3 | 3 | — (auth-layer, single-instance via store) |

The redundant React render, duplicate effects, and duplicate DOM for the page subtree are eliminated. Network calls that were fired twice (attempt-start, page effects) now fire once.

## 7. Regression Results

| Gate | Result |
|------|--------|
| `tsc --noEmit` (web) | ✅ Clean |
| `pnpm build` (web) | ✅ Clean |
| API Jest (`pnpm --filter api test`) | ✅ 43/43 |
| Playwright e2e (recordings suite) | ✅ 62/62 |
| Admin route sweep | ✅ 28/28 (200, no errors) |
| Student journey (8 pages) | ✅ All 200, 0 console errors |
| Responsive sweep (375/390/414/768/1024/1440) | ✅ 0 overflow, 0 small tap targets, 0 errors |
| Breakpoint boundaries (767–1024) | ✅ Correct shell toggles |
| Security (student→/admin redirect) | ✅ Preserved |
| Logout (desktop + mobile) | ✅ Both redirect to /login |

## 8. Production Readiness

**GO.** The change is minimal (1 file), architecture-only, and fully verified. The double-mount P1 from the Phase 4 report is resolved: pages mount once, the attempt page creates one attempt request, no duplicated effects/DOM, and the UI is visually identical at every viewport. No new dependencies, no behavior changes, no test changes.

---

_End of RCCF single-mount refactor report_
