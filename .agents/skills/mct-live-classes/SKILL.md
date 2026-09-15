---
name: mct-live-classes
description: Canonical live_sessions architecture, legacy sessions compatibility layer, Zoom integration, webhook verification, attendance and join-token security. Use when touching live-sessions, zoom, attendance, trading-sessions, or webinar code.
---

# Skill: MCT LMS — Live Classes

## Purpose
Keep `live_sessions` canonical; the legacy `sessions` tables are a frozen compatibility layer only.

## Architecture
```
Admin creates session → LiveSessionsService (transactional)
  → live_sessions (status: scheduled|live|ended|cancelled; teacher_id,
     zoom_webinar_id, zoom_webinar_join_url)
  → session_batches (batch isolation source of truth)
  → registration → session_registrants (personal_join_url, zoom_registrant_id)
  → Zoom webinar create/register (Server-to-Server OAuth, token cached)
  → student join: single-use join_tokens row + Redis active_join marker
  → Zoom signed webhook POST /zoom/webhook (@Public, rawBody!)
       → ZoomWebhookHandler verifies signature → status/attendance/recording updates
  → webinar.ended → RPC mark_absent_for_session(session_id) marks no-shows absent
```

## Important Files
`modules/live-sessions/*` · `modules/zoom/{zoom.service,zoom.controller,zoom-webhook.handler}.ts` · `modules/attendance/*` · `modules/trading-sessions/*` (legacy read layer) · migrations `004/005/010/034`

## Database Contracts
- Canonical trio: `live_sessions`, `session_batches`, `session_registrants`; attendance `status CHECK IN ('present','absent','late')`, `ON CONFLICT (session_id,user_id)`.
- Legacy: `sessions`, `session_batch_mappings`, `webinar_attendance` — READ-MODEL ONLY. Migration 034 aligned code to EXISTING live columns instead of altering them (`teacher_id`, `join_time/leave_time/duration_seconds/marked_manually/marked_by`, registrant personal_join_url). Do not invent column names here.
- `join_tokens(token)` indexed; `join_attempts(session_id)` indexed for audit.

## Rules
- **Legacy tables must never become a second source of truth.** New writes go to the canonical trio; legacy views exist for compatibility.
- Zoom webhook MUST be `@Public()` and MUST respond with exact unwrapped payloads via `@Res() res.json()` (bypasses ResponseTransformInterceptor) for `endpoint.url_validation` `{plainToken, encryptedToken}`. Signature verified against `req.rawBody`.
- Host resolution: host user id comes from config/business-config (`LIVE_SESSION_DEFAULT_HOST_ID`) — never from client input.
- Join URLs are single-use, bound userId+sessionId, Redis-enforced (15-min TTL, active-join duplicate detection).
- Session creation is transactional (Transaction util): session + batch links roll back together.

## Common Failure Modes
| Trap | Consequence |
|---|---|
| Writing new features against `sessions` | dual-source-of-truth drift (the exact problem Phase 6 fixed) |
| Wrapping Zoom url_validation in the interceptor | Zoom validation fails |
| Trusting unsigned webhooks | forged attendance/status mutations |
| Assuming attendance columns | migration 034 documents actual names |

## Verification
- Unit: live-sessions/zoom/attendance specs. E2E/docs: `docs/testing/live-classes-*.md`.
- Blueprint: `docs/rccf-phase6b-live-classes-migration-blueprint.md`.

## Do Not
- Do not delete legacy session tables (compatibility layer).
- Do not bypass the host resolver or batch isolation when creating/joining sessions.
