# RCCF Report — Phase 6: Live Classes Production Hardening & Architecture Audit

**Scope:** Complete audit of the Live Classes module (sessions, Zoom, attendance, trading-sessions). Evidence-based — source, API, DB, browser. **No fixes applied** (per instruction).

**Result:** The Live Classes module has **two parallel, disconnected session systems**, the modern one is **non-functional against the live DB schema** (column drift), the admin UI is wired to a **legacy system students never see**, and the **entire Zoom webhook pipeline (auto-attendance + recording linkage) is dead code**. This is the least-production-ready module audited to date.

---

## 1. Architecture Report (Step 1 & 2)

### Module map (4 API modules + 1 dead handler)

```
apps/api/src/modules/
├── live-sessions/        → LiveSessionsService (839 lines), LiveSessionsController
│   └── dto/ create-session, request-join
├── zoom/                 → ZoomService (API client), ZoomController, ZoomWebhookHandler (DEAD)
│   └── dto/ create-signature
├── attendance/           → AttendanceService, AttendanceController
│   └── dto/ manual-attendance
└── trading-sessions/     → TradingSessionsService, TradingSessionsController (admin/sessions)
    └── dto/ create-trading-session
```

### TWO PARALLEL SESSION SYSTEMS (P0)

| | LEGACY ("Trading Sessions") | MODERN ("Live Sessions") |
|---|---|---|
| Controller | `TradingSessionsController` → `admin/sessions` | `LiveSessionsController` → `live-sessions` |
| Tables | `sessions`, `session_batch_mappings` | `live_sessions`, `session_batches`, `session_registrants` |
| Admin UI | `/admin/sessions` (sidebar "Live Sessions") | — (no admin UI) |
| Student UI | — | `/student/live-sessions` |
| Create flow | title, startTime, batchIds, duration (NO teacher) | topic, teacherId (requires `role=teacher` + `zoom_user_id`) |
| Zoom | `zoom_meeting_id` | `zoom_webinar_id` |
| Status | `is_live` boolean | `status` enum (scheduled/live/ended/cancelled) |

**Verified consequence (browser + DB):** Admin created "P6 Test Session" via `/admin/sessions` → landed in `sessions` + `session_batch_mappings`. Student `/student/live-sessions` reads `live_sessions` → **empty** → student sees nothing. **The admin's primary "Live Sessions" page manages data students will never see.**

### Dead code
- **`ZoomWebhookHandler`** (`zoom-webhook.handler.ts`, 229 lines) is referenced only in comments. `ZoomController.handleZoomWebhook` returns `{success:true}` for every event — it never calls `verifyWebhookSignature()` nor `ZoomWebhookHandler.handle()`. **The entire auto-attendance, absent-marking, and recording-queueing pipeline is dead.**

### Controller business logic (architectural violation)
- `ZoomController.createSignature` (lines 48-103) performs inline DB lookups + batch authorization + business logic directly in the controller, bypassing any service. Violates thin-controller principle.
- `ZoomController.handleZoomWebhook` has inline logic.

### Write/read ownership
- `live_sessions` written by: `LiveSessionsService.create`, `updateStatus`; read by: `LiveSessionsService`, `ZoomController`, `recording-upload.job`
- `attendance` written by: dead `ZoomWebhookHandler` (joined/left/ended), `AttendanceService.markManual`; read by: `AttendanceService`
- `sessions`/`session_batch_mappings` written/read by: `TradingSessionsService` only

### Transaction violations
- `LiveSessionsService.create`: session insert + batch links (transaction) + **per-student Zoom registration loop + registrant batch insert — NOT transactional**. If the registrant batch insert fails, students registered on Zoom but not in DB (orphans).
- `TradingSessionsService.create`: Zoom webinar → session insert → mappings insert — **no transaction**. If mappings fail, Zoom webinar + session row exist with no batch links.

### Architecture score: **3/10**

---

## 2. Database Audit (Step 3)

### Live DB schema vs code — MASSIVE COLUMN DRIFT (P0)

Verified by probing each column against the live Supabase schema:

| Column (code uses) | In live DB? | Column (schema.sql defines) |
|---|---|---|
| `live_sessions.host_user_id` | ❌ MISSING | `teacher_id` ✅ |
| `live_sessions.zoom_join_url` | ❌ MISSING | `zoom_webinar_join_url` ✅ |
| `live_sessions.zoom_start_url` | ❌ MISSING | (only join_url defined) |
| `session_registrants.join_url` | ❌ MISSING | `personal_join_url` ✅ |
| `session_registrants.registered_at` | ❌ MISSING | (not defined) |
| `attendance.joined_at` | ❌ MISSING | `join_time` ✅ |
| `attendance.marked_at` | ❌ MISSING | `marked_manually`, `marked_by` ✅ |
| `live_sessions.join_tokens_revoked_since` | ✅ OK | |
| `sessions.is_live`, `zoom_meeting_id` | ✅ OK | |

**Consequence:** `LiveSessionsService.create` inserts `host_user_id`/`zoom_join_url` → **PGRST204 400**. `getStudentJoinUrl` reads `registrant.join_url` → always "not registered". The webhook handler writes `joined_at`/`marked_at` → would fail. **The entire modern module is non-functional against the live schema.**

### Indexes
- `live_sessions`: teacher_id, start_time, status ✅
- `attendance`: session_id, user_id ✅
- `session_batches`: PK(session_id,batch_id) ✅
- No index on `join_tokens(token)` — the token lookup in `getStudentJoinUrl` scans (though Redis is the primary store).
- No index on `join_attempts(session_id)` (audit query).

### Missing FK
- `join_tokens.token_id` in `logJoinAttempt` references `token` — `join_attempts.token_id` column exists? (service inserts `token_id: tokenId`). Not verified — potential FK mismatch (probe showed `join_attempts` table exists, empty).

### Tables
All 8 session tables exist but are **empty** (no production data yet) — the module is pre-launch.

---

## 3. Admin Workflow Audit (Step 4) — browser verified

| Workflow | Result | Evidence |
|----------|--------|----------|
| View sessions list | ✅ 200, 0 errors | `/admin/sessions` all viewports |
| Create session (legacy) | ✅ Works | "P6 Test Session" created in `sessions` via browser |
| Delete session | ✅ Works (Zoom best-effort) | service code + browser ConfirmDialog |
| **Edit / duplicate / publish / unpublish / reschedule** | ❌ **NOT IMPLEMENTED** | no endpoints, no UI buttons |
| Batch assign/remove | ⚠️ Create-only | no post-create batch management |
| Attendance view/mark | ✅ 200 | `/attendance/*` renders |
| Link recording to session | ❌ **Broken** | depends on dead Zoom webhook → `upload_queue` |
| History/search/pagination/filters/sort | ⚠️ Minimal | `findAll` has page/limit/batchId/status; no search/sort in legacy page |

**Create-flow gap:** `TradingSessionsService.create` requires Zoom API. The modern `LiveSessionsService.create` requires a teacher with `zoom_user_id` — **no teacher profiles exist** in the system (verified: profiles are admin/student only), so the modern create can never be exercised as-is.

---

## 4. Student Workflow Audit (Step 5) — browser verified

| Workflow | Result | Evidence |
|----------|--------|----------|
| Upcoming/past list | ✅ 200, "0 upcoming / No sessions scheduled" empty state | `/student/live-sessions` all viewports |
| Session detail | ✅ 200 (no sessions to render content) | `/student/live-sessions/:id` |
| Join session | ⚠️ Enrollment-gated via `requestJoinToken` | code verified |
| Join too early | ✅ blocked (`requestJoinToken` 15-min window) | service line 537-545 |
| Join after expiry | ✅ blocked (rejected_expired) | service |
| Attendance | ⚠️ `attendance/me` works but auto-attendance dead | webhook dead |
| Recording availability | ❌ dead pipeline | webhook dead → no upload_queue |
| Mobile/tablet/desktop | ✅ 0 overflow, 0 console errors | 390/768/1440px |

**Student never sees admin-created sessions** (P0 — different tables).

---

## 5. Security Audit (Step 6)

| Check | Result |
|-------|--------|
| Student → admin endpoints (`live-sessions` list/create, join-audit, active-joins, attendance session/student/export/report) | ✅ 403 |
| **`attendance/me` has NO `@Roles` decorator** | ⚠️ P2 — any authenticated user (incl. admin) can call; minor, returns own (empty) data |
| Cross-batch session join | ✅ blocked (`requestJoinToken` checks `session_registrants` membership) |
| `live-sessions/:id` detail (`findById`) | ⚠️ P2 — open to all roles, no enrollment check; leaks topic/batchIds/hostTeacher to any student |
| Join token single-use + userId/sessionId binding | ✅ Redis single-use + JSON binding |
| Replay join link | ✅ rejected_reused (DB `used_at` check) |
| Token revocation | ✅ `revokeAllTokens` (admin) |
| Webhook signature verification | ❌ **P0** — `handleZoomWebhook` is `@Public()` and never verifies signature (verifyWebhookSignature exists but unused); anyone can POST fake events (though they're ignored) |
| JWT tampering | ✅ global guard |
| `zoom/signature` SDK | ✅ batch-auth verified, status must be live |

---

## 6. Performance Audit (Step 7)

| Item | Finding |
|------|---------|
| **Per-student Zoom registration loop** | `create()` registers each student sequentially via `registerAttendee` (N+1 external API calls). For hundreds of students this is very slow and rate-limit prone (Zoom 429). |
| **Zoom OAuth token per call** | `getAccessToken()` fetches a fresh token for every Zoom API call — the code comment itself notes it "could cache it in Redis". High overhead. |
| `requestJoinToken` revocation scan | `redisScan('join_token:*')` scans ALL join tokens on every request — O(total tokens). |
| `findById` | 3 queries (session + batch links + teacher) — acceptable, no N+1 |
| `getForStudent` | 3 queries (batches → session_ids → sessions + attendance) — OK |
| `getBatchAttendanceReport` | Builds grid in memory; OK for current scale |

---

## 7. Source Code Audit (Step 8)

| Item | Finding |
|------|---------|
| `console.error` | `zoom.service.ts:396` — CRITICAL log for missing webhook secret (acceptable, but inline) |
| Dead `ZoomWebhookHandler` | 229 lines, never wired |
| `updateStatus` logging bug | `previousStatus: data.status` reads the NEW status (post-update), not the previous → cancelled-event log is wrong |
| Duplicate API clients | `sessions.ts` (legacy) + `live-sessions.ts` (modern) |
| Duplicate session logic | `TradingSessionsService` vs `LiveSessionsService` — near-identical create/delete, different schemas |
| `schedule-session-modal` renders `joinUrl`/`startUrl` fields never returned by `findAll` | dead UI affordance (Zoom column always "—") |
| No TODO/FIXME/HACK | clean otherwise |

---

## 8. Test Audit (Step 9)

**ZERO unit tests and ZERO e2e tests** for live-sessions, zoom, attendance, or trading-sessions (verified — no `.spec.ts` in any of the 4 modules, no e2e spec matches session/attendance/zoom). This is the **only module with no test coverage** in the platform (Recordings: 34 unit + 62 e2e; Assessments: 81 unit + 28 e2e).

---

## 9. Browser Verification (Step 10)

| Page | 390px | 768px | 1440px |
|------|-------|-------|--------|
| `/admin/sessions` | 200, 0 err, 0 overflow | 200 | 200 |
| `/student/live-sessions` | 200, 0 err, 0 overflow | 200 | 200 |
| Admin create-session (browser) | — | — | ✅ created legacy session |

No console errors, no network failures, no hydration warnings, no overflow at any viewport.

---

## 10. Bug List (prioritized, NO FIXES APPLIED)

### P0 — Production blockers
| # | Bug | Root Cause | Impact | Files | Fix estimate |
|---|-----|-----------|--------|-------|-------------|
| 1 | **Admin sessions invisible to students** | Two parallel systems: admin writes `sessions`/`session_batch_mappings`, students read `live_sessions` | Admin schedules classes students never see; live-classes feature is non-functional | `trading-sessions.service.ts`, `live-sessions.service.ts`, admin sidebar, `sessions.ts` client | 2-3 days (unify) |
| 2 | **Modern live-sessions module schema drift** | Code uses `host_user_id`/`zoom_join_url`/`join_url`/`joined_at`/`marked_at` but live DB has `teacher_id`/`zoom_webinar_join_url`/`personal_join_url`/`join_time`/`marked_manually` | `create()`, `getStudentJoinUrl`, webhook handler all PGRST204/404 — modern module never works | `live-sessions.service.ts` (8 column refs), `zoom-webhook.handler.ts` | 1 day (align code to schema or migrate columns) |
| 3 | **Zoom webhook pipeline dead + unverified** | `handleZoomWebhook` returns success without `verifyWebhookSignature` or `ZoomWebhookHandler.handle()` | No auto-attendance, no absent-marking, no recording-queueing; public endpoint accepts unverified POSTs | `zoom.controller.ts:106-118` | 1-2 days (wire signature verify + handler) |

### P1
| # | Bug | Root Cause | Impact | Fix estimate |
|---|-----|-----------|--------|-------------|
| 4 | `mark_absent_for_session` RPC missing | webhook handler calls nonexistent RPC | webinar.ended path broken | S |
| 5 | `findById` no enrollment check | controller `@Roles(ADMIN,TEACHER,STUDENT)` + service no membership check | student can read any session's metadata (topic/batches/teacher) | S |
| 6 | No edit/duplicate/publish/unpublish/reschedule endpoints | feature never built | admin cannot modify sessions after create | M (feature, post-launch) |

### P2
| # | Bug | Impact |
|---|-----|--------|
| 7 | `attendance/me` no `@Roles` | any role can call (harmless but inconsistent) |
| 8 | `updateStatus` logs wrong previousStatus | misleading audit event |
| 9 | Per-student Zoom registration N+1 + no token cache | slow create, rate-limit risk |
| 10 | `requestJoinToken` full Redis scan | O(total tokens) per request |
| 11 | No teacher profiles in DB | modern create path unreachable |
| 12 | Dead `joinUrl`/`startUrl` fields in admin table | misleading UI |

### P3
- `console.error` in zoom.service (use logger)
- No index on `join_tokens(token)` / `join_attempts(session_id)`

---

## 11. Technical Debt Summary

- **Legacy `sessions` + `session_batch_mappings` tables** — should be retired or the module unified onto `live_sessions`
- **`TradingSessionsService` duplicates `LiveSessionsService` logic** with a different schema
- **Dead `ZoomWebhookHandler`** (229 lines) + dead `mark_absent_for_session` reference
- **Two API clients** (`sessions.ts` legacy, `live-sessions.ts` modern)
- **Non-transactional session creation** in both services

---

## 12. Production Readiness Score

| Dimension | Score | Reasoning |
|-----------|-------|-----------|
| Architecture | 3/10 | two systems, dead webhook, controller business logic, column drift |
| Security | 6/10 | guards mostly OK; unverified public webhook, no-enrollment findById |
| Performance | 5/10 | per-student Zoom loop, no token cache, full Redis scan |
| UX | 5/10 | admin page manages invisible sessions; student empty state misleading |
| Code Quality | 5/10 | duplication, dead code, column mismatch |
| Testing | **0/10** | ZERO tests |
| Reliability | 3/10 | modern module non-functional; admin creates orphan sessions |
| Scalability | 4/10 | Zoom N+1, no caching |
| **Overall** | **39/100** | **NO GO** |

## 13. Recommendation

**NO GO for production.** The Live Classes module is the least-ready in the platform. The admin-facing session management writes to a data model students never read (P0), the modern live-sessions implementation is broken against the live DB schema (P0), and the entire Zoom webhook automation (attendance + recording linkage) is dead and unverified (P0).

**Recommended fix order (post-audit):**
1. **Unify the two session systems** — decide the canonical model (recommend `live_sessions`), migrate admin UI + `TradingSessionsService` onto it, retire `sessions`/`session_batch_mappings`
2. **Resolve schema drift** — align `live-sessions.service.ts` + webhook handler to the live schema (or add the missing columns via migration)
3. **Wire the Zoom webhook** — call `verifyWebhookSignature` + `ZoomWebhookHandler.handle()`; add `mark_absent_for_session` RPC
4. Add enrollment check to `findById`, `@Roles` to `attendance/me`
5. **Add test coverage** (unit + e2e) matching Recordings/Assessments standard

**Estimated engineering effort:** P0 fixes ~4-6 days; P1 ~2-3 days; full production-readiness (incl. tests) ~2-3 weeks.

---

_End of RCCF Phase 6 report (audit only — no fixes applied)_
