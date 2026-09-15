# Live Classes — Coverage Matrix

## Feature → API → DB → UI

| # | Feature | Test File | API | DB | UI | Notes |
|---|---------|-----------|-----|-----|-----|-------|
| 1 | Host resolver (explicit/default/reject) | `live-sessions.service.spec.ts` | ✔ | - | - | unit |
| 2 | Schema-aligned create (teacher_id, join_url) | `live-sessions.service.spec.ts` | ✔ | - | - | asserts no drifted columns |
| 3 | Registrant personal_join_url write | `live-sessions.service.spec.ts` | ✔ | - | - | |
| 4 | deleteSession | `live-sessions.service.spec.ts` | ✔ | ✔ | - | cascade verified live |
| 5 | Compat layer create (legacy shape) | `trading-sessions.service.spec.ts` | ✔ | - | - | |
| 6 | Compat layer findAll/remove | `trading-sessions.service.spec.ts` | ✔ | - | - | |
| 7 | Webhook participant_joined → attendance | `zoom-webhook.handler.spec.ts` | ✔ | ✔ | - | join_time live-verified |
| 8 | Webhook participant_left → duration | `zoom-webhook.handler.spec.ts` | ✔ | ✔ | - | live-verified |
| 9 | Webhook ended → status + RPC | `zoom-webhook.handler.spec.ts` | ✔ | ✔ | - | live-verified |
| 10 | Webhook recording → upload_queue | `zoom-webhook.handler.spec.ts` | ✔ | ✔ | - | live-verified |
| 11 | Webhook signature (valid/invalid/expired) | `zoom.service.spec.ts` | ✔ | - | - | |
| 12 | Attendance report (profiles fix) | `attendance.service.spec.ts` | ✔ | - | - | |
| 13 | Manual attendance + student report | `attendance.service.spec.ts` | ✔ | - | - | |
| 14 | Admin create session (UI) | Playwright script | ✔ | ✔ | ✔ | browser, 0 errors |
| 15 | Student sees admin session | Playwright script | ✔ | ✔ | ✔ | batch member |
| 16 | Batch isolation (non-member) | Playwright script | ✔ | - | ✔ | |
| 17 | Admin delete session | Playwright script | ✔ | ✔ | ✔ | |

## Score

| Layer | Verified | Coverage |
|-------|----------|----------|
| API | 17 / 17 | 100% |
| DB | 9 / 17 | 53% |
| UI | 4 / 17 | 24% (browser; API-backed asserts cover the rest) |

## Unit Coverage (new service files)

| Service | Tests | Key coverage |
|---------|-------|--------------|
| LiveSessionsService | 10 | host resolver, schema-aligned create, delete, updateStatus |
| TradingSessionsService | 3 | compat mapping + delegation |
| ZoomWebhookHandler | 6 | all 4 event types + edge cases |
| ZoomService | 2 | signature + challenge |
| AttendanceService | 4 | reports, manual, profiles fix |

## Missing Scenarios (P2/P3)

| Scenario | Priority |
|----------|----------|
| Join-token full lifecycle e2e (request → join → reuse rejection) | P2 |
| Webhook replay/duplicate-event idempotency e2e | P2 |
| Performance: 100+ student registration (Zoom mock) | P3 |
| Recording → Mux processing chain e2e (needs real Zoom/Mux) | P3 |
