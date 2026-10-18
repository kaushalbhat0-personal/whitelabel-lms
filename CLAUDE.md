# LMS Platform — White-Label LMS

## Project Overview
White-label Learning Management System. Monorepo with NestJS backend + Next.js frontend. Supports multiple client deployments with independent branding and configuration.

## Commands
- `pnpm dev` — Run both API + web in parallel
- `pnpm build` — Build all workspace packages
- `cd apps/web && npx tsc --noEmit` — TypeScript check frontend
- `cd apps/api && nest start --watch` — Dev API server
- `cd apps/web && next dev` — Dev web server
- `cd apps/api && pnpm test` — Run API Jest tests (9 passing)
- `cd apps/api && pnpm test:watch` — Watch mode

## Monorepo Structure
```
lms-platform/
  apps/
    api/          — NestJS backend (port 3001)
    web/          — Next.js frontend (port 3000)
  packages/
    shared-types/ — Shared TS types & enums
  scripts/
    schema.sql    — DB schema
```

## Architecture

### Backend (`apps/api`)
- **NestJS** — Controllers → Services → Supabase/Redis/Zoom/Mux
- **Supabase** — Primary DB (Postgres). Tables in camelCase via `TABLES` constant.
- **Redis** — Session management via `@liaoliaots/nestjs-redis`
- **Mux** — Video upload/playback via `@mux/mux-node`
- **Zoom** — Webinar creation/registration via Server-to-Server OAuth
- **Resend** — Email delivery (SMTP replaced, HTTPS port 443)
- **Auth** — JWT (sub, sessionId, role) + Redis session store, rate-limited login
- **ResponseTransformInterceptor** — Wraps all responses in `{ success, data }`
- **Jest** — Test infrastructure: `jest.config.ts`, `ts-jest`, `@nestjs/testing`, `supertest` available

### Frontend (`apps/web`)
- **Next.js 14** — App Router, RSC + client components
- **Tailwind CSS** — Design tokens in `tailwind.config.ts`
- **Zustand** — `auth.store.ts` for client-side auth state
- **`fetchApi()`** — `lib/api-client.ts`: auto-injects Bearer token from cookie, unwraps `{ success, data }`
- **Supabase SSR** — `lib/supabase/server.ts` for server component auth
- **Lucide React** — Icons
- **Mux Player** — `@mux/mux-player-react` for video playback

## Critical Architecture (DO NOT REGRESS)

### Zoom Webhook — `POST /zoom/webhook`
- **MUST be `@Public()`** to bypass the global LMS `JwtAuthGuard`. Zoom cannot send JWTs.
- **MUST use `@Res() res: Response`** to manually `res.json()` responses. This bypasses `ResponseTransformInterceptor` which would wrap Zoom-required payloads (e.g., `{ plainToken, encryptedToken }` for `endpoint.url_validation`). Zoom requires this exact un-wrapped structure.

### Destruction Pipeline
- Deleting a session: `ZoomService.deleteWebinar` in try/catch (continue on Zoom 404) → delete `session_batch_mappings` → delete `sessions` row.
- Deleting a recording: delete from `batch_recording_curriculum` (where `content_id = id AND content_type = 'recording'`) → delete Mux asset → delete `recordings` row.
- Always delete child/mapping rows before parent rows to avoid FK constraint errors.

### Bulk Uploads (CSV)
- Backend: `@UseInterceptors(FileInterceptor('file'))` for multipart/form-data.
- Frontend: When sending `FormData`, **omit `Content-Type` header** — let the browser set `multipart/form-data; boundary=...`.
- `GET /bulk-upload/template` is `@Public()`, sends raw CSV string with `Content-Disposition: attachment`.

### Recording Authorization
- **Single source of truth:** `recording_batches` table only. The `batch_recording_curriculum` table is for curriculum display and progress calculation only — never for access control.
- `validateAccess()` in `recordings.service.ts:495` gates all student-facing recording access via `recording_batches`. No curriculum fallback exists.

### Curriculum Synchronization (batch_recording_curriculum)
Every recording mutation must keep `batch_recording_curriculum` in sync:
- `assignToBatches()` — inserts curriculum entries with defaults after inserting into `recording_batches`
- `removeBatchAccess()` — deletes curriculum entries after deleting from `recording_batches`
- `deleteRecording()` — deletes curriculum entries (before recording deletion)
- `createRecordingWithUpload()` — calls `autoCreateCurriculumEntries()` after recording_batches upsert

### Mux Webhook — `POST /mux/webhook`
- **MUST be `@Public()`** (Mux cannot send JWTs).
- Verifies signature against `req.rawBody` (preserved by `rawBody: true` in `main.ts`).
- Always returns 200 — never throws to Mux or it will retry.
- Handles: `video.upload.asset_created` (links upload to asset), `video.asset.ready` (marks recording ready), `video.asset.errored` (marks error), `video.asset.deleted` (removes orphan rows).
- Unhandled event types logged at `debug` level (not warn) — intermediate events like `video.upload.created` and `video.asset.created` are expected and need no action.

### Reconciliation Service
- `RecordingCurriculumReconciliationService` detects and repairs drift between `recording_batches` and `batch_recording_curriculum`.
- Dry-run mode for production safety (`dryRun=true` returns diff without mutations).
- Accessible via `POST /admin/reconciliation/curriculum?dryRun=true` (admin-only).
- Detects: missing curriculum entries (exist in recording_batches, not in curriculum → inserts) and orphan entries (exist in curriculum, not in recording_batches → deletes).

### E2E Testing Pattern
- Uses NestJS `Test.createTestingModule` with `supertest`.
- External APIs (ZoomService) strictly mocked via `.overrideProvider()`.
- Tests are stateful (capture `createdSessionId` in POST → reuse in DELETE).
- Global `afterAll` hook queries Supabase directly to delete orphaned test rows if a test fails mid-execution.

## Design System

### Colors
```
brand.navy:       #1e3a5f  — Primary CTAs, headers, active states
brand.navyDark:   #152d4a  — Hover/pressed
brand.gold:       #f59e0b  — Accent
brand.goldLight:  #fef3c7  — Gold tint
surface.page:     #f8fafc  — Page background
surface.card:     #ffffff  — Card background
surface.muted:    #f1f5f9  — Muted surfaces
surface.border:   #e2e8f0  — Dividers
text.primary:     #0f172a  — Headings
text.secondary:   #475569  — Subtext
text.muted:       #94a3b8  — Placeholders
text.inverse:     #ffffff  — On dark backgrounds
status.live:      #ef4444  — Live now
status.scheduled: #3b82f6  — Upcoming
status.ended:     #6b7280  — Past
status.success:   #10b981  — Success
```

### Breakpoints
- Mobile: default (< 768px), full-width, `px-4`, bottom nav `pb-20`
- Desktop: `md:` breakpoint, sidebar 240px, `px-6 py-8`, grid-cols-2/3

## Student Portal Architecture

### Layout
- **Mobile** (`< md`): Full-width content + fixed bottom nav (`StudentBottomNav`, 5 tabs)
- **Desktop** (`>= md`): Fixed left sidebar (`StudentSidebar`, 240px) + max-w-5xl content

### Pages
| Route | File | Description |
|-------|------|-------------|
| `/student` | `page.tsx` | Dashboard — greeting, next class, up next, recent recordings, courses |
| `/student/courses` | `courses/page.tsx` | Enrolled courses list |
| `/student/courses/[id]` | `courses/[courseId]/page.tsx` | Course detail — sessions + recordings |
| `/student/live-sessions` | `live-sessions/page.tsx` | Sessions grouped Today/Upcoming/Past |
| `/student/videos` | `videos/page.tsx` | Recordings grouped by topic |
| `/student/videos/[id]` | `videos/[recordingId]/page.tsx` | Video player (full-width) |
| `/student/profile` | `profile/page.tsx` | Profile, batches, change password, logout |

### Student Components
```
components/
  layout/
    StudentSidebar.tsx     — Desktop sidebar nav (client component)
    StudentBottomNav.tsx   — Mobile bottom tab bar (client component)
  shared/
    PageHeader.tsx          — Mobile-aware sticky header with back button
    SessionStatusBadge.tsx  — Live/scheduled/ended badge
    EmptyState.tsx          — Generic empty state
    LoadingSpinner.tsx      — Generic loading
  student/
    dashboard/              — Dashboard widgets
    courses/                — Classroom components (CourseClassroomHeader, VideoTheater, MuxVideoPlayer)
    live-sessions/          — SessionList
    videos/                  — VideoLibrary
  ui/
    Button.tsx, Card.tsx, Badge.tsx, Modal.tsx, DataTable.tsx, ConfirmDialog.tsx
```

### API Layer (`lib/api/`)
| File | Key Functions | Endpoints |
|------|---------------|-----------|
| `courses.ts` | `getMyCourses()`, `getStudentCourse()` | `GET /courses/my`, `GET /courses/:id` |
| `live-sessions.ts` | `getMySessions()`, `getSessionJoinUrl()` | `GET /live-sessions/my`, `GET /live-sessions/:id/join` |
| `videos.ts` | `getMyVideos()`, `getVideoPlaybackUrl()` | `GET /recordings/my`, `GET /recordings/:id/play` |
| `recordings.ts` | `getRecordings()`, `createRecording()` | Admin CRUD |
| `payments.ts` | `getMyPaymentPlans()` | `GET /payments/my` |

### Key Data Types
- `StudentCourse` — extends Course with `enrolledBatches`
- `LiveSession` — `{ id, topic, start_time, duration_minutes, status }`
- `StudentVideo` — Recording with `progress: { watched_seconds, completed }`
- `BatchVideo` — Recording for a specific batch with `muxPlaybackId`
- `PlaybackResponse` — `{ url, thumbnail }` from Mux signed URLs

## Auth Flow
1. Login: `POST /auth/login` → JWT cookie (`access_token`) + `must_change_password` cookie
2. Middleware (`middleware.ts`): reads cookies, decodes JWT, checks role/path
3. `fetchApi()`: reads `access_token` cookie, sends as `Authorization: Bearer`
4. Supabase SSR (`lib/supabase/server.ts`): for server component auth session
5. Auth store (`stores/auth.store.ts`): zustand for client-side state
6. Public routes: `/login`, `/change-password`, `/reset-password`
7. Student routes: `/student/*` — protected for `role === 'student'`

## Key Conventions
- `'use client'` for client components using hooks
- Pages use `export const dynamic = 'force-dynamic'`
- Server page fetches data, passes `token` to client sub-components
- `Promise.all()` for parallel data fetching
- Cards use `rounded-card` border radius, `surface-card` bg, `surface-border` border
- `cn()` from `lib/utils.ts` for conditional Tailwind classes
- Icons from `lucide-react`
- Do NOT double-unwrap API responses — `fetchApi` already handles `ResponseTransformInterceptor`
- Two-step validation: always delete child/mapping rows before parent rows
