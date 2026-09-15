---
name: mct-student-portal
description: Student portal single-mount architecture, page map, HLS player contract and the known prefs/HLS-reset bug. Use when touching student pages, layout shells, navigation, or the video player.
---

# Skill: MCT LMS — Student Portal

## Purpose
Preserve the hard-won single-mount architecture and the provider-agnostic player.

## THE critical rule (Phase "single-mount", commit c764a8b)
**Never render `{children}` in more than one responsive shell.**
One content mount; responsive chrome surrounds it:
```
<Layout>            ← ONE client shell
  <DesktopSidebar/> (md+)   <MobileBottomNav/> (<md)
  <main>{children}</main>   ← children rendered EXACTLY ONCE
</Layout>
```
Two trees caused: duplicate effects, duplicate attempt POSTs, duplicate video players/instances. If adding responsive UI, toggle visibility inside one mount (`hidden md:block`), never conditional double-render of children.

## Page map (`app/student/*`)
dashboard · courses/[courseId] · videos + videos/[recordingId] (player) · tests (+attempt/[testId], result/[attemptId]) · live-sessions/[sessionId] · notifications · profile. Mobile-first: bottom nav <768px, sidebar ≥md.

## Video player contract
`video-player-client.tsx` receives `{url, thumbnail, sessionId}` from `GET /recordings/:id/play` and plays with hls.js — **provider-generic** (works for Mux JWT URLs and Bunny bcdn_token URLs identically).

### The HLS reset bug — institutional knowledge
Fixed chain (Phase 7A): a `prefs` object was in the HLS effect dependency array → every preference write re-ran the effect → `hls.destroy()` → MediaSource reset → buffer zeroed mid-playback.
Current protections (do not touch, verified in video-player-client.tsx):
1. HLS init effect deps are only `[playbackUrl, updateLevels, handleLevelChanged]` (stable useCallbacks).
2. Preferences apply via a SEPARATE effect keyed on `[playbackUrl]` guarded by a `prefsApplied` ref.
3. Player prefs (speed/volume/muted/quality) persist via `usePlayerPreferences` without touching hls.js lifecycle.

## Rules
- Fetch data server-side where possible (`force-dynamic` pages); pass token down to client components explicitly.
- Progress reporting: throttle `POST /progress` events; dedupe on mount (the duplicate-request class of bugs).
- Loading/error states use shared components (LoadingSpinner, EmptyState); toasts via sonner.

## Verification
E2E browser specs: `tests/e2e/recordings/student-playback-ui.spec.ts`, playback.spec.ts (buffer-grows-monotonically guard). Manual mobile pass at 375px width is part of RCCF verification.

## Do Not
- Do not add Mux/Bunny branches to the player.
- Do not introduce a second content mount for desktop/mobile.
- Do not put rapidly changing UI state into media-initialization effects.
