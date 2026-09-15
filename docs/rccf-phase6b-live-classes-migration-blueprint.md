# RCCF Phase 6B/6C — Live Classes Migration Blueprint (Revised)

**Status:** DESIGN ONLY — no code changes, no commits.
**Supersedes:** `rccf-phase6a-live-classes-migration-blueprint.md`
**Revision rationale:** incorporate review feedback — (1) keep legacy as a compatibility layer, not delete; (2) no features during migration; (3) no hardcoded teacher seeding; (4) preserve the old API contract; (5) tests before deleting the fallback.

---

## Revised Principles (from review)

| # | Principle | Why |
|---|-----------|-----|
| 1 | **Keep `TradingSessionsService`** — convert to a thin compatibility layer over `LiveSessionsService` | Zero routing changes, no frontend change initially, trivial rollback, incremental migration. Delete only after several production iterations. |
| 2 | **No features during migration (Phase 6B)** — only schema alignment, webhook wiring, compatibility layer, admin-on-live_sessions | Isolates every bug to one cause (migration vs new feature vs schema vs webhook). |
| 3 | **No hardcoded teacher seeding** — allow an admin to be the Zoom host; abstract "host" away from a future teacher system | Avoids introducing a teacher-architecture dependency before the teacher module exists. |
| 4 | **Keep `/admin/sessions` contract** — change only the backend implementation | Users never know the architecture changed. |
| 5 | **Tests before deleting legacy** — migration → unit → e2e → browser → production verification → delete | Never remove the fallback until the replacement is fully verified. |

---

## Phase 6B — Stabilize & Make Work (NO NEW FEATURES)

### B1. Schema alignment (code → DB; DB is source of truth per `schema.sql`)
Columns to align in `LiveSessionsService` + `ZoomWebhookHandler`:
- `live_sessions.host_user_id` → **`teacher_id`** (DB has `teacher_id`)
- `live_sessions.zoom_join_url` → **`zoom_webinar_join_url`**
- `live_sessions.zoom_start_url` → **add/rename** (DB has no `zoom_start_url`; store host start URL in a column that exists, or add via migration `034` if required by host flow)
- `session_registrants.join_url` → **`personal_join_url`**
- `session_registrants.registered_at` → remove or add column (not in schema.sql)
- `attendance.joined_at` → **`join_time`**
- `attendance.marked_at` → use **`marked_manually` / `marked_by`** (drop `marked_at`)
- `findById` reads `session.host_user_id` → **`session.teacher_id`**

Add missing indexes (migration `034`): `join_tokens(token)`, `join_attempts(session_id)`. Add RPC `mark_absent_for_session` (used by webhook).

> **Decision:** align CODE to the live DB (no destructive DB change in B). If `zoom_start_url` is genuinely needed for host flow, add ONE column via `034` — otherwise derive it. This keeps B reversible.

### B2. Webhook wiring (the dead pipeline)
- `ZoomController.handleZoomWebhook`: call `verifyWebhookSignature()` (with raw body) → `ZoomWebhookHandler.handle(event, payload, supabase)`. Always return 200; never throw to Zoom.
- Fix `ZoomWebhookHandler` column refs (B1 list) and the `mark_absent_for_session` RPC call.
- Register `ZoomWebhookHandler` as a provider (currently never wired).

### B3. Host abstraction (NO teacher seeding)
Replace the hard `role === 'teacher'` + `zoom_user_id` gate in `create()` with a **resolved-host** concept:
- **Host source priority:** (a) explicit `hostUserId` if provided and has `zoom_user_id`; (b) fallback to a configured **default admin host** (env `LIVE_SESSION_DEFAULT_HOST_ID` or the creating admin's own `zoom_user_id`); (c) reject only if NO user in the system has a `zoom_user_id`.
- Do **not** create fake teacher rows. If an admin has a `zoom_user_id`, they can host. When the teacher module arrives, "host" maps to teacher cleanly.
- The legacy compat layer does not need to know about hosts — `LiveSessionsService.create` resolves it internally (admin's own `zoom_user_id` by default).

### B4. Compatibility layer (legacy `TradingSessionsService` → `LiveSessionsService`)
`TradingSessionsController` and `TradingSessionsService` are **kept**, but `TradingSessionsService` becomes a thin delegate:
```
Admin → TradingSessionsController → TradingSessionsService (compat)
            │
            ▼
        LiveSessionsService (canonical)
```
- `createSession(dto)` → `liveSessionsService.create({ topic: dto.title, startTime, durationMinutes, batchIds, teacherId: resolvedHost })` — field names map 1:1 (legacy DTO is a strict subset).
- `findAll()` → `liveSessionsService.findAll(page, limit, batchId, status)` + map `is_live` → `status` in the response so **the old API contract is unchanged**.
- `remove(id)` → `liveSessionsService.deleteSession(id)` (add a delete method on canonical — this is a migration-enabler, not a feature).
- Keep `DELETE /admin/sessions/:id`, `GET /admin/sessions`, `POST /admin/sessions` exactly as-is on the wire.
- Legacy tables `sessions`/`session_batch_mappings`/`webinar_attendance` are **read-only fallback** during B (not written).

### B5. Admin uses `live_sessions` (no frontend change yet)
- `/admin/sessions` page + `schedule-session-modal` **unchanged** — they already call `/admin/sessions`; only the backend now writes `live_sessions`.
- Admin creates → `TradingSessionsService` → `LiveSessionsService.create` → `live_sessions` + `session_batches` + `session_registrants`.
- Student `/student/live-sessions` now sees admin-created sessions (the P0 disconnect is resolved with zero frontend edits).

### B6. Verify (no new features)
- Browser: admin create session → student list shows it → student detail renders → join gating works.
- API: all `/admin/sessions` + `/live-sessions` + `/attendance/*` endpoints.
- DB: rows land in `live_sessions`/`session_batches`/`session_registrants`/`attendance`; no legacy writes.

---

## Phase 6C — After It Works (features, deferred)

Only once B is verified in production:
- Edit / reschedule session (`PATCH /live-sessions/:id`)
- Duplicate session
- Batch assign/remove post-create
- Attendance improvement screens (grid, per-session view) on canonical
- Analytics (per-session attendance, join funnel)
- Notifications (session scheduled/started/ended) + calendar
- Optional: teacher UI once a real teacher module exists (map `host` → `teacher`)

---

## Testing Order (tests BEFORE deleting legacy)

1. **Unit tests** — `LiveSessionsService` (create/join/leave/audit/revoke/status/getForStudent), `ZoomService` (mocked Zoom), `ZoomWebhookHandler` (signature + event handling), `AttendanceService`, `TradingSessionsService` (compat delegate).
2. **E2E (API + DB)** — admin create → student sees → request-join → join → leave → attendance → status transitions.
3. **Browser tests** — admin `/admin/sessions` (unchanged contract), student `/student/live-sessions` + detail + join, at 390/768/1440px, 0 console errors.
4. **Production verification soak** — keep legacy tables + compat layer live for several iterations; monitor both write paths.

**Delete legacy only after all of the above pass AND the soak shows zero writes to `sessions`/`session_batch_mappings`.**

---

## Rollback Strategy

- **B1/B2/B4** are all additive/revertible — revert code, legacy path resumes.
- **B4 compat layer** means the legacy API never disappears; rollback = point `TradingSessionsService` back at old logic (kept in git history) or toggle a flag.
- **No data destruction in 6B.** Legacy tables remain until 6C deletion gate.
- **No Redis/JWT/session changes.**

---

## Risks (revised)

| Risk | Mitigation |
|------|-----------|
| **Admin create fails because no one has `zoom_user_id`** | B3 host abstraction: resolve to creating admin or env-configured default; reject only if truly none |
| **Legacy table still written during transition** | B4 writes ONLY to canonical; legacy is read-only; monitor via a one-time flag |
| **Webhook signature verification breaks Zoom** | Wire with `verifyWebhookSignature` + always-200; test with mocked + real challenge before enabling auto-processing |
| **Schema alignment mismatch (zoom_start_url)** | Prefer DB columns; add one column only if host flow requires it |
| **Bugs during 6B** | Scope is strictly B1-B5; every bug traceable to migration/webhook/schema — no feature noise |

---

## Dependency Graph (revised)

```
Admin (/admin/sessions, unchanged contract)
   │
   ▼
TradingSessionsController (KEPT, unchanged routes)
   │
   ▼
TradingSessionsService → COMPAT LAYER (thin)
   │
   ▼
LiveSessionsService (CANONICAL, schema-aligned)
   │              │              │
   ▼              ▼              ▼
live_sessions  session_batches  session_registrants
   │              │              │
   ▼              ▼              ▼
attendance     join_tokens    join_attempts
   │
   ▼
ZoomService ← ZoomWebhookHandler (now WIRED)

Student (/student/live-sessions, unchanged) → LiveSessionsService

Legacy tables (sessions, session_batch_mappings, webinar_attendance):
  KEPT READ-ONLY as fallback during 6B; deleted in 6C after test gate
```

---

## Implementation Order (revised)

| Order | Task | Phase |
|-------|------|-------|
| 1 | B1: schema alignment (code→DB) + migration `034` (indexes, RPC) | 6B |
| 2 | B3: host abstraction (admin-as-host, no teacher seeding) | 6B |
| 3 | B2: wire webhook (signature + handler + RPC + column fixes) | 6B |
| 4 | B4: compat layer (`TradingSessionsService` → `LiveSessionsService`) + add canonical `deleteSession` | 6B |
| 5 | B5: verify admin-on-live_sessions end-to-end (browser + API + DB) | 6B |
| 6 | Unit tests (5 modules) | 6B gate |
| 7 | E2E live-sessions suite | 6B gate |
| 8 | Browser tests (admin + student, 3 viewports) | 6B gate |
| 9 | Production verification soak (legacy read-only) | 6B |
| 10 | **Delete legacy only after gate** (tables + TABLES entries + DTO) | 6C |
| 11 | 6C features (edit/duplicate/attendance/analytics/notifications) | 6C |
| 12 | Teacher module (future) maps host → teacher | post |

**Effort:** 6B stabilization ≈ 4-5 days incl. tests; 6C features ≈ 1-2 weeks; legacy deletion is a small final step gated on soak.

---

## Blueprint Summary

- **Keep legacy as a thin compatibility layer** (Principle 1, 4) — zero routing/frontend changes, trivial rollback.
- **Phase 6B is strictly "make it work"** — schema alignment, webhook wiring, host abstraction, compat layer, admin-on-canonical. No features.
- **Host is abstracted, not teacher-seeded** (Principle 3).
- **Tests and production soak precede legacy deletion** (Principle 5).
- **Features are Phase 6C**, after everything is verified.

---

_End of Phase 6B/6C Live Classes Migration Blueprint (revised, design only)_
