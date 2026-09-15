# Live Classes — Test Documentation

Production safety net for the Live Classes module (sessions, Zoom, attendance, compatibility layer).

## Suites

| Suite | Location | Tests | Scope |
|-------|----------|-------|-------|
| Unit (Jest) | `apps/api/src/modules/{live-sessions,zoom,attendance,trading-sessions}/*.spec.ts` | 25 new | Services, host resolver, webhook, schema mapping, compat layer, attendance |
| E2E (Playwright) | `tests/e2e/` (recordings + assessments) | 90 | Full regression across all modules |

## Run Commands

```bash
# Unit tests
pnpm --filter api test

# Full e2e regression
npx playwright test --config=tests/e2e/playwright.config.ts
```

## Unit Test Inventory (new, Phase 6B)

### LiveSessionsService (`live-sessions.service.spec.ts`) — 10 tests
- Host Resolver: explicit host (valid/invalid/missing), default host from config, no-host rejection
- Schema-aligned create: writes `teacher_id` + `zoom_webinar_join_url` (NOT the drifted columns), registrants with `personal_join_url`
- deleteSession (deletes Zoom + session, NotFound)
- updateStatus

### TradingSessionsService compat layer (`trading-sessions.service.spec.ts`) — 3 tests
- create delegates to LiveSessionsService with mapped fields + preserves legacy `ScheduledSession` shape
- is_live mapping (status live → true)
- findAll maps each item; remove delegates to deleteSession

### ZoomWebhookHandler (`zoom-webhook.handler.spec.ts`) — 6 tests
- participant_joined writes attendance with `join_time` (not `joined_at`)
- unknown email ignored
- participant_left updates `duration_seconds` + `leave_time`
- webinar.ended sets status + calls `mark_absent_for_session` RPC
- recording.completed queues MP4 into upload_queue
- no-MP4 event ignored

### ZoomService (`zoom.service.spec.ts`) — 2 tests
- verifyWebhookSignature accepts valid, rejects invalid + expired
- validateWebhookChallenge returns HMAC

### AttendanceService (`attendance.service.spec.ts`) — 4 tests
- getBatchAttendanceReport maps students via `profiles` (not `users`)
- getStudentAttendance summary/empty
- markManual rejects non-ended session, upserts ended

## Browser Verification (Playwright scripts)

- Admin `/admin/sessions` create via UI → session appears in table (0 console errors)
- Student `/student/live-sessions` → sees admin-created session (correct batch)
- Non-member student → not visible (batch isolation)
- Admin delete → removed
- Viewports: 390px (mobile), 1440px (desktop) — no overflow, 0 console errors

## Database Verification

- live_sessions (teacher_id, zoom_webinar_join_url, status) populated correctly
- session_batches, session_registrants (personal_join_url) populated
- attendance (join_time, leave_time, duration_seconds) written by webhook
- upload_queue (session_id, MP4 URL, pending) written by webhook
- mark_absent_for_session RPC callable
- Legacy sessions/session_batch_mappings remain at 0 rows (compat writes only to canonical)

## Verified Production Bugs Caught (Phase 6B)

| Bug | Where Caught |
|-----|--------------|
| Schema drift (host_user_id/zoom_join_url/join_url/joined_at) | unit tests + live DB probes |
| Dead Zoom webhook (no signature/no dispatch) | live signed-event tests |
| Host hard-gate (role=teacher) | host-resolver unit tests |
| attendance s.users → s.profiles | unit test + live API |
| attendance/me missing @Roles | code review + security test |
