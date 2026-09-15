---
name: mct-production-debugging
description: Symptom-driven debugging playbook for this repo (401/403/404/500, infinite loading, buffering, duplicate API calls, PGRST errors, webhook failures, CORS/cookies). Use when diagnosing failures in dev or production-like environments.
---

# Skill: MCT LMS — Production Debugging

## Purpose
Fast diagnosis using knowledge of THIS system's failure history.

## Playbooks

**401 Unauthorized**
1. Redis session gone (24 h TTL / single-device re-login nukes old session) → expected; client should redirect to login.
2. api-client sent no Bearer → cookie missing/expired; check `access_token` cookie + middleware.
3. Playback token expired (`playback_token:*` 600 s sliding) → 401 with violation log row.

**403 Forbidden**
1. Missing `@Roles()` mismatch → check route decorator vs user.role.
2. Ownership/batch check failed (validateAccess, test_batches, session_batches) → verify the mapping-table row actually exists.
3. PlaybackGuard: revoked user / device mismatch / cross-user or cross-recording binding.
4. Bunny CDN: expired/absent/malformed token, or path-style token missing for HLS segments.

**404** — Supabase `.single()` on zero rows throws PGRST116 → surfaces as 500 unless mapped; distinguish real 404s from mapping bugs.

**500**
1. **PGRST204** ("could not find column X") = schema drift — TS writes a column the DB lacks. See skill mct-schema-drift (test_answers.sort_order, test_attempts.updated_at history).
2. **23503** FK violation → child inserted before parent / bad batch id.
3. **23505/CHECK violation** (23514) → invalid enum-ish value ('error' status incident).
4. Provider API failure → check chokepoint service logs (MuxService/BunnyProvider/ZoomService).

**Infinite loading (web)**
1. fetchApi timeout 30 s → backend hanging (Redis down? Supabase unreachable?).
2. Duplicate-mount double-fetch racing state → single-mount rule.
3. `await validateSession()` loop → auth-validation misfiring.

**Video buffering/stall**
1. HLS effect deps churned → hls.destroy() (skill mct-frontend-development).
2. CDN token expiry mid-playback (Mux 60 s JWT is per-request; Bunny 4 h directory token).
3. Segment 403s → Bunny path-token malformed; inspect network tab for bcdn_token form.

**Duplicate API calls** — two mounts/two effects (history: duplicate attempt POSTs); fix the mount, not the symptom with debounce.

**Webhook not applying** — Mux/Bunny signature mismatch (rawBody preserved? secret correct?); Zoom url_validation must bypass interceptor; always return 2xx to Mux.

**CORS/cookies** — FRONTEND_URL drives Mux cors_origin and cookies; localhost:3000 vs deployed domain mismatches break auth.

**Env vars** — API reads apps/api/.env at boot; web needs NEXT_PUBLIC_API_URL; private keys need `\n`→newline replacement (Mux signing key).

## Verification
After fixing: reproduce original symptom → confirm gone; run related unit specs; check logs for new noise.

## Do Not
- Do not restart/hotfix production data by hand without a rollback statement.
- Do not mask errors with catch-all empty catches.
