---
name: mct-frontend-development
description: Next.js frontend conventions for this repo (app router boundaries, fetchApi unwrapping, auth state, effects hazards, HLS player rule). Use when writing or reviewing any apps/web code.
---

# Skill: MCT LMS — Frontend Development

## Purpose
Match established web patterns and avoid the classes of bugs already fixed.

## Architecture
Next.js 14 App Router. Server components fetch via server-side helpers; client components (`'use client'`) handle interactivity. State: zustand `stores/auth.store.ts`. Styling: Tailwind tokens (brand.navy/gold, surface.*) per CLAUDE.md design system.

## Conventions
- **API calls:** always `fetchApi()` from `lib/api-client.ts` — injects Bearer from access_token cookie, enforces timeout, unwraps `{success,data}` ONCE, throws typed ApiError (UnauthorizedError/ForbiddenError/NotFoundError). Never double-unwrap; never call axios directly in web.
- **FormData:** omit `Content-Type` so the browser sets the multipart boundary.
- **Server pages:** `export const dynamic='force-dynamic'` for authenticated pages; pass token to client children as prop.
- **Effects:** every effect that POSTs/PUTs must be idempotent or single-flight guarded — duplicate-mount history makes this non-negotiable.
- **Provider-agnostic UI:** media components must not branch on video provider (see skill mct-video-pipeline).

## The HLS rule (regression = buffer resets mid-playback)
Do NOT put `prefs` objects, quality selections, volume/speed state, or any frequently-changing value into the hls.js initialization effect's dependency array. Effect re-run ⇒ `hls.destroy()` ⇒ MediaSource reset ⇒ visible buffering/reload.
Current safe structure in `app/student/videos/[recordingId]/video-player-client.tsx`:
1. init effect deps: `[playbackUrl, updateLevels, handleLevelChanged]` (stable useCallbacks only)
2. separate prefs-application effect keyed `[playbackUrl]` with a `prefsApplied` ref guard
3. prefs persistence lives in `hooks/usePlayerPreferences.ts`

## Responsive layout
One content mount (skill mct-student-portal): `hidden md:block` toggling inside a single shell; bottom nav `<md`, sidebar `≥md`.

## Common Failure Modes
| Bug class | Example already fixed |
|---|---|
| Duplicate mounts/effects | single-mount refactor c764a8b |
| Token inaccessible | httpOnly cookie + api-client bridge (Phase 4) |
| Stale list after mutation | router.refresh() after create/delete flows |
| Unwrapped response read | `res.data` vs interceptor envelope confusion |

## Verification
`cd apps/web && npx tsc --noEmit` after every change; `next build` before delivery; manual mobile pass 375px for student pages.

## Do Not
- Do not add new global state libraries or data-fetching frameworks (no react-query/swr without approval).
- Do not store tokens in localStorage/sessionStorage.
