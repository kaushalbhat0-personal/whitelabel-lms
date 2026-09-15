# RCCF Phase 6A — Live Classes Architecture Migration Blueprint

**Status:** DESIGN ONLY — no code changes, no commits, no fixes.
**Goal:** Unify the two parallel Live Class systems into ONE canonical system.

---

## Step 1 — Feature Comparison

| Feature | Legacy (sessions) | Modern (live_sessions) | Verdict |
|---------|-------------------|------------------------|---------|
| **Tables** | `sessions`, `session_batch_mappings`, `webinar_attendance` | `live_sessions`, `session_batches`, `session_registrants`, `attendance`, `join_tokens`, `join_attempts` | Modern richer |
| **Status model** | `is_live` boolean (scheduled↔live only) | `status` enum: `scheduled/live/ended/cancelled` | **Modern better** — 4-state lifecycle |
| **Per-student join URL** | None (shared Zoom meeting URL) | `session_registrants.personal_join_url` (unique URL per student) | **Modern better** — attendance per student |
| **Join security** | None | Join tokens (single-use, Redis, userId+sessionId bound, audit trail, revocation) | **Modern far better** |
| **Attendance** | `webinar_attendance` (dead, no code) | `attendance` (+ `attendance.service` reports, manual mark, CSV) | **Modern** (legacy table dead) |
| **Teacher/host** | None | `teacher_id` + requires teacher with `zoom_user_id` | **Modern** — supports future teacher UI |
| **Multi-batch** | `session_batch_mappings` (M:N) | `session_batches` (M:N) | Equal |
| **Zoom identity** | `zoom_meeting_id` (meeting, not webinar) | `zoom_webinar_id` + `zoom_webinar_join_url` | **Modern** — webinar type |
| **Recordings linkage** | ❌ No FK | `recordings.session_id → live_sessions` FK (SET NULL); `recording-upload.job` reads `session_batches` | **Modern is REQUIRED** — recordings already bound |
| **Student UI** | ❌ None | `/student/live-sessions`, dashboard, courses, curriculum (12+ components) | **Modern** |
| **Admin UI** | `/admin/sessions` + schedule modal | ❌ None (gap) | Legacy has admin UI but wrong data target |
| **Create flow** | title, startTime, batchIds, duration (no teacher) | topic, teacherId, batches, duration | Modern more complete |
| **Schedule window / join gating** | None | `requestJoinToken` 15-min window, session status gating | **Modern** |
| **Notifications** | None | None (both missing — future) | Tie (both need future work) |
| **Calendar** | None | None (both missing) | Tie |
| **API surface** | `admin/sessions` (CRUD) | `live-sessions` (create/list/detail/my/join/leave/audit/revoke/status) | **Modern much richer** |
| **Schema drift (live DB)** | Aligned (`is_live`, `zoom_meeting_id` OK) | **Drifted** — code uses `host_user_id`/`zoom_join_url`/`join_url`/`joined_at`, DB has `teacher_id`/`zoom_webinar_join_url`/`personal_join_url`/`join_time` | Legacy works; modern needs schema/code realignment |

**Summary:** Modern wins on nearly every dimension (status, per-student URLs, security, attendance, recordings FK, student UI, future analytics/teacher support). Legacy wins only on "admin UI exists" and "schema aligned". Both lack notifications/calendar (future work on canonical model).

---

## Step 2 — Canonical Model Determination

**DECISION: `live_sessions` (the modern system) is canonical.**

Evidence:

1. **Recordings are already bound to it.** `recordings.session_id` FK references `live_sessions(id)` (schema.sql) and `recording-upload.job` queries `SESSION_BATCHES`. The recording pipeline — the platform's most mature module — depends on the modern system. Migrating to legacy would break recordings.
2. **Student workflow is built on it.** `/student/live-sessions`, dashboard next-class/upcoming widgets, course-detail sessions, and the video curriculum view all consume `live-sessions` (12+ files). The legacy system has zero student UI.
3. **Security model lives here.** Join tokens, single-use consumption, userId+sessionId binding, audit trail (`join_attempts`), active-join detection, and revocation are all modern-only. These are required for a production student-facing live class.
4. **Per-student attendee URLs** (`session_registrants`) enable attendance tracking — a hard requirement. Legacy has no equivalent.
5. **Future features** (teacher management, analytics, notifications, calendar) map naturally onto the richer modern schema (`status` enum, `teacher_id`, `attendance` with `join_time`/`duration_seconds`).
6. **API cleanliness**: modern has a coherent `/live-sessions` REST surface with proper role guards; legacy is a thin orphan.

**What must change on the canonical model:** resolve the schema drift (align code→DB or DB→code), add the missing admin UI on top of `live-sessions`, and wire the dead webhook.

---

## Step 3 — Migration Strategy

### Phase 1 — Stabilize the canonical model (no user impact)
1. **Resolve schema drift.** Pick DB columns as source of truth (they match `schema.sql` and are immutable at runtime): `teacher_id`, `zoom_webinar_join_url`, `personal_join_url`, `join_time`, `leave_time`, `marked_manually`. Fix `live-sessions.service.ts` + `zoom-webhook.handler.ts` to use these (or add a compatibility view).
2. **Wire the Zoom webhook.** `zoom.controller.ts` must call `verifyWebhookSignature()` then `ZoomWebhookHandler.handle()`; add `mark_absent_for_session` RPC; fix handler column names.
3. **Add admin CRUD on `live_sessions`.** Extend `LiveSessionsController` with `PATCH /live-sessions/:id` (edit/reschedule), `POST /live-sessions/:id/duplicate`, `PATCH /live-sessions/:id/batches` (assign/remove), and link recording.
4. **Teacher onboarding:** seed/register teacher profiles with `zoom_user_id`; ensure a teacher exists to exercise create.

### Phase 2 — Build the canonical admin UI (feature parity)
5. Replace `/admin/sessions` page + `schedule-session-modal` to call `live-sessions` (via a new admin client in `live-sessions.ts`). Keep the visual identical.
6. Add admin views: status badge (scheduled/live/ended/cancelled), attendance per session, join-audit, active-joins, recording link.
7. Switch the admin sidebar "Live Sessions" target to the new page (same route `/admin/sessions`, new data source).

### Phase 3 — Data + API cutover
8. **Data migration** (one-time backfill): copy any rows from legacy `sessions`/`session_batch_mappings`/`webinar_attendance` into `live_sessions`/`session_batches`/`attendance` with a mapping script (likely empty pre-launch — the DB is empty). Migrate `is_live` → `status`, `zoom_meeting_id` → `zoom_webinar_id`, single `batch_id` → `session_batches` rows.
9. **API retirement:** remove `TradingSessionsController`/`TradingSessionsService`/`sessions.ts` client; point `ROUTES.ADMIN_SESSIONS` at `live-sessions` admin routes (or keep `/admin/sessions` as an alias returning `live_sessions` data).
10. **Compatibility:** during a short overlap window, keep `GET /admin/sessions` (legacy) returning mapped `live_sessions` data via a thin shim, so nothing breaks mid-deploy.

### Phase 4 — Cleanup + hardening
11. Drop legacy tables `sessions`, `session_batch_mappings`, `webinar_attendance` + remove `TABLES` entries after verification.
12. Add **test coverage** (unit + e2e for live-sessions, zoom, attendance) to match the Recordings/Assessments standard.
13. Enable notifications (session scheduled/started/ended) + calendar on the canonical model (future feature).

### Rollback strategy
- **Phase 1-2 are additive** — no data destroyed, no route removed. Rollback = revert code.
- **Phase 3 data migration is one-way but reversible pre-cutover:** back up `sessions` tables; the mapping script can be reversed while legacy endpoints still exist.
- **Phase 4 drop is gated on a 1-week soak** with legacy tables read-only and a monitoring flag; rollback = restore from backup.
- Every phase lands behind the existing single-device JWT session; no Redis/JWT schema changes.

### Compatibility strategy
- Keep legacy `GET /admin/sessions` as a read shim until Phase 4; admins keep a working page.
- Keep `sessions.ts` client exporting the same shape (mapped from `live_sessions`) until the frontend swap completes.
- `scheduleSession()` payload is a subset of `CreateSessionDto` — reuse field names so the modal's `onSubmit` is unchanged in Phase 2.

### Testing strategy
- Unit: `LiveSessionsService` (create/join/leave/audit/revoke/status/getForStudent), `AttendanceService`, `ZoomService` (mocked Zoom), `ZoomWebhookHandler` (event handling, signature).
- E2E: admin create→publish→student sees→join (token)→attendance→recordings link.
- Regression: recordings (session FK), assessments, student dashboard (next-class/upcoming widgets).

---

## Step 4 — Every File That Changes

### Backend (API)
| File | Change |
|------|--------|
| `apps/api/src/modules/live-sessions/live-sessions.service.ts` | Fix schema drift (8 column refs: `host_user_id`→`teacher_id`, `zoom_join_url`→`zoom_webinar_join_url`, `zoom_start_url`→(new/remove), `join_url`→`personal_join_url`, `registered_at`→(remove/add), `marked_at`→`marked_manually`); add update/duplicate/batches; fix `updateStatus` previousStatus log; make create transactional |
| `apps/api/src/modules/live-sessions/live-sessions.controller.ts` | Add PATCH `/live-sessions/:id`, POST `/:id/duplicate`, PATCH `/:id/batches`; add `@Roles` to `findById` or enrollment check |
| `apps/api/src/modules/live-sessions/live-sessions.module.ts` | (unchanged or add new providers) |
| `apps/api/src/modules/live-sessions/dto/create-session.dto.ts` | Align teacherId/column semantics; add update DTO |
| `apps/api/src/modules/zoom/zoom.controller.ts` | Wire `verifyWebhookSignature` + `ZoomWebhookHandler.handle()`; remove inline business logic from `createSignature` (delegate to service) |
| `apps/api/src/modules/zoom/zoom-webhook.handler.ts` | Fix column names (`joined_at`→`join_time`, `left_at`→`leave_time`, `marked_at`); fix `mark_absent_for_session` RPC; add signature param |
| `apps/api/src/modules/zoom/zoom.service.ts` | Cache OAuth token (55-min TTL) — performance |
| `apps/api/src/modules/trading-sessions/trading-sessions.service.ts` | **DELETE** (or redirect to LiveSessionsService) |
| `apps/api/src/modules/trading-sessions/trading-sessions.controller.ts` | **DELETE** (or shim returning live_sessions) |
| `apps/api/src/modules/trading-sessions/dto/create-trading-session.dto.ts` | **DELETE** |
| `apps/api/src/modules/trading-sessions/trading-sessions.module.ts` | **DELETE** |
| `apps/api/src/modules/attendance/attendance.service.ts` | Fix `s.users`→`s.profiles` bug (P1); align column refs |
| `apps/api/src/modules/attendance/attendance.controller.ts` | Add `@Roles(STUDENT)` to `GET /attendance/me` |
| `apps/api/src/modules/attendance/dto/manual-attendance.dto.ts` | (unchanged) |
| `apps/api/src/common/constants/tables.constant.ts` | Remove `SESSIONS`, `SESSION_BATCH_MAPPINGS`, `WEBINAR_ATTENDANCE` after retirement |
| `apps/api/src/app.module.ts` | Remove `TradingSessionsModule` import |
| `apps/api/src/jobs/recording-upload.job.ts` | (no change — already reads modern) |

### DB migrations
| File | Change |
|------|--------|
| `scripts/migrations/034-live-sessions-unify.sql` | (new) add missing modern columns OR rename legacy→canonical, backfill, add `join_tokens(token)`/`join_attempts(session_id)` indexes, add `mark_absent_for_session` RPC |
| `scripts/migrations/035-retire-legacy-sessions.sql` | (new) drop `sessions`, `session_batch_mappings`, `webinar_attendance` (Phase 4) |

### Frontend (Web)
| File | Change |
|------|--------|
| `apps/web/src/lib/api/live-sessions.ts` | Add admin functions (create, update, duplicate, batches, list); keep student functions |
| `apps/web/src/lib/api/sessions.ts` | **DELETE** (after swap) |
| `apps/web/src/app/admin/sessions/page.tsx` | Point to `live-sessions` client; add status badge, attendance, audit views |
| `apps/web/src/components/admin/sessions/schedule-session-modal.tsx` | Call `live-sessions` create; add teacher selection |
| `apps/web/src/app/admin/sessions/*` | Any new detail/attendance views |
| `apps/web/src/lib/constants.ts` | `ADMIN_SESSIONS` route stays `/admin/sessions` (new data source) |
| `apps/web/src/app/student/live-sessions/*` | (no change — already modern) |
| `apps/web/src/app/student/dashboard-next-class.tsx`, `dashboard-upcoming-list.tsx`, `course-detail-sessions.tsx`, `curriculum-view.tsx` | (no change — already modern) |

### Tests
| File | Change |
|------|--------|
| `apps/api/src/modules/live-sessions/live-sessions.service.spec.ts` | NEW — unit tests |
| `apps/api/src/modules/zoom/zoom.service.spec.ts` | NEW |
| `apps/api/src/modules/zoom/zoom-webhook.handler.spec.ts` | NEW |
| `apps/api/src/modules/attendance/attendance.service.spec.ts` | NEW |
| `tests/e2e/live-sessions/*.spec.ts` | NEW — e2e suite |
| `tests/e2e/fixtures/live-sessions-fixture.ts` | NEW |

### Documentation
| File | Change |
|------|--------|
| `docs/rccf-phase6a-live-classes-migration-blueprint.md` | THIS document |
| `docs/testing/live-classes-tests.md` | NEW (after implementation) |
| `docs/architecture.md` | Update session model |
| `docs/modules/recordings.md` | Confirm session linkage to `live_sessions` |

---

## Step 5 — Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Data loss** (legacy rows) | Low (DB empty) | High | Backfill + reverse-mapping script before drop; Phase 4 gated on soak |
| **Broken admin route** during swap | Medium | High | Keep `/admin/sessions` as read-shim until Phase 4 |
| **Student downtime** | Low | High | Phases additive; student UI already modern |
| **Zoom API rate limit** (per-student register loop) | Medium (hundreds of students) | Medium | Batch/async registration, token cache |
| **Attendance breakage** (webhook wiring) | Medium | Medium | Test webhook handler with mocked events before enabling |
| **Recordings FK** | Low (already modern) | High | No change; verify `recording-upload.job` still works |
| **Redis** (join tokens) | Low | Medium | Keep key schema; no Redis changes |
| **JWT/session** | Low | Low | No auth changes |
| **Browser** (mobile live join) | Medium | Medium | Browser e2e at 390/768/1440 |
| **Rollback** | — | — | Backup legacy tables; reversible mapping |

---

## Step 6 — Dependency Graph

```
                    ┌────────────────────────────────────────────┐
                    │          CANONICAL: live_sessions          │
                    └────────────────────────────────────────────┘
                        ▲                  │              ▲
   student UI (12 files)│                  │              │ recordings FK
   dashboard/courses/   │                  │              │ (schema.sql:347)
   videos/curriculum    │                  │              │
   lib/api/live-sessions│                  │              ▼
                        │          ┌───────┴──────┐   recording-upload.job
                live-sessions      │ session_batches│  (reads SESSION_BATCHES)
                service/controller │               │
                        │          └───────────────┘
                        │                  │
                        ▼                  ▼
              session_registrants    attendance (+attendance.service)
              join_tokens            join_attempts
                        │
                        ▼
              ZoomService (API client) ← ZoomWebhookHandler (DEAD → wire)
                        │
                        ▼
              ZoomController.webhook (currently no-op → wire)

        ┌──────────────────────────────────────────────────────┐
        │  TO BE DELETED (legacy):                              │
        │   TradingSessionsModule/Controller/Service/DTO        │
        │   sessions.ts (client)                                │
        │   tables: sessions, session_batch_mappings,           │
        │           webinar_attendance (already dead)           │
        └──────────────────────────────────────────────────────┘
```

- **Delete:** `TradingSessionsModule` (4 files), `sessions.ts` client, legacy tables.
- **Merge:** admin `/admin/sessions` page + modal → onto `live-sessions` API (page stays, data source changes).
- **Becomes dead:** nothing after migration (webhook becomes live).
- **Becomes canonical:** `live_sessions`, `session_batches`, `session_registrants`, `attendance`, `join_tokens`, `join_attempts`, `LiveSessionsService`, `LiveSessionsController`, `zoom.service`, `attendance.service`, `ZoomWebhookHandler`.

---

## Step 7 — Effort Estimate & Implementation Order

| # | Task | Size | Phase |
|---|------|------|-------|
| 1 | Resolve live-sessions schema drift (align code→DB) | Medium | 1 |
| 2 | Fix `attendance.service` `s.users`→`s.profiles` (P1) + `attendance/me` `@Roles` | Small | 1 |
| 3 | Wire Zoom webhook (signature + handler + RPC + column fixes) | Medium | 1 |
| 4 | Add admin CRUD on `live_sessions` (update/duplicate/batches) | Medium | 1 |
| 5 | Teacher onboarding (seed teacher + zoom_user_id) | Small | 1 |
| 6 | Admin UI → `live-sessions` (page + modal + new views) | Large | 2 |
| 7 | Data migration + legacy→canonical backfill | Medium | 3 |
| 8 | Retire legacy API/tables + cleanup | Small | 4 |
| 9 | Unit tests (4 modules) | Large | 4 |
| 10 | E2E live-sessions suite | Large | 4 |
| 11 | Notifications/calendar on canonical (future) | Large | post |

**Total (excl. future): ~2-3 weeks** for a 2-person team, with P0 stabilization (tasks 1-3) in the first 2-3 days.

---

## Phase 6A Migration Blueprint — Summary

- **Canonical model: `live_sessions`** (proven by recordings FK, student UI, security, attendance, per-student URLs).
- **Migration:** 4 phases — stabilize canonical (schema drift, webhook, admin CRUD) → build admin UI → data+API cutover (with read-shim) → retire legacy + tests.
- **Rollback:** additive phases are revertible; Phase 4 drop gated on soak + backup.
- **Net result:** one session system, one attendance model, recordings linked, admin and students on the same data, full test coverage.

---

_End of Phase 6A Migration Blueprint (design only)_
