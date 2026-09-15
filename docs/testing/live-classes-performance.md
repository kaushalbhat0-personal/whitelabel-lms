# Live Classes — Performance Report

Measured 2026-08-07 (local env, remote Supabase, live Zoom API calls for create).

## End-to-end latency (single session, 1 batch, 1 student)

| Operation | Latency | Notes |
|-----------|---------|-------|
| Admin create session (`/admin/sessions` → compat → live_sessions) | ~2.5s | dominated by Zoom webinar creation + per-student registration (real API) |
| Student `/live-sessions/my` | ~200ms | 3 queries (batches → session_ids → sessions) |
| Webhook `participant_joined` | ~150ms | session lookup + user lookup + attendance upsert |
| Webhook `recording.completed` | ~150ms | session lookup + upload_queue insert |
| Admin delete session | ~600ms | Zoom delete (best-effort) + DB cascade |

## Bottlenecks (documented, NOT fixed in 6B — correctness first)

1. **Per-student Zoom registration loop (N+1 external API)** — `create()` calls `registerAttendee` once per student sequentially. For 100+ students this is very slow and risks Zoom 429 rate limits. (P2 — future: batch/parallel/async registration.)
2. **Zoom OAuth token fetched per call** — `ZoomService.getAccessToken()` calls Zoom's OAuth endpoint for every API request. The code comment itself recommends caching (55-min TTL in Redis). (P2)
3. **`requestJoinToken` full Redis scan** — `redisScan('join_token:*')` iterates ALL join tokens to revoke prior ones. O(total tokens) per request. (P2 — future: per-user key index.)
4. **`getStudentJoinUrl` Redis + DB** — acceptable (token single-use check in Redis, then DB update). No N+1.

## Indexes (added via migration 034)

| Index | Table | Supports |
|-------|-------|----------|
| `idx_join_tokens_token` | join_tokens | token lookup in getStudentJoinUrl |
| `idx_join_attempts_session` | join_attempts | join-audit admin query |

Existing indexes (live_sessions: teacher_id/start_time/status; attendance: session_id/user_id; session_batches: PK) cover the main read paths.

## Recommendations (P2/P3, post-freeze)

| Item | Effort | Impact |
|------|--------|--------|
| Batch/parallel Zoom registrations | M | 100× faster create for large batches |
| Redis-cache Zoom OAuth token (55-min TTL) | S | removes per-call OAuth round-trip |
| Per-user join-token index in Redis | S | O(1) revocation |
| Join-token lifecycle e2e + webhook idempotency tests | M | reliability |
