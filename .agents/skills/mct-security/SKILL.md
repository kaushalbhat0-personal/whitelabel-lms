---
name: mct-security
description: Project-specific security checklist — roles, ownership, batch isolation, IDOR, answer leakage, playback/join authorization, webhook signatures, secrets hygiene. Use when adding endpoints, exposing data, or reviewing changes for security.
---

# Skill: MCT LMS — Security

## Purpose
Encode the vulnerabilities found and fixed across RCCF phases so they are never reintroduced.

## Checklist (every new endpoint/page)
1. **Role:** `@Roles(...)` present and correct? (No decorator = any authenticated user!)
2. **Ownership:** does the service compare `request.user.id` to row owner? (attempts/results/devices/progress)
3. **Batch isolation:** gated via canonical mapping table only — recording_batches / test_batches / session_batches (+batch_students intersection).
4. **IDOR sweep:** can user A fetch/modify resource id belonging to user B by changing the UUID? Write the negative test.
5. **Data exposure:** select explicit columns; never `select *` on questions (correct answers!), payments, violations.
6. **Answer leakage:** students must never receive correct-answer flags during attempts or before publish (Phase 5 fix).
7. **Playback:** URLs ONLY via PlaybackGuard → provider minting below authorization; Redis token bindings enforced; revocation checked first.
8. **Join security:** live-session join = single-use token + active-join duplicate detection + batch membership.
9. **Webhooks:** @Public but signature-verified against rawBody (Mux t=/v1=, Bunny X-BunnyStream-*, Zoom signed) + provider-scoped mutations (Bunny events must not touch mux rows and vice versa).
10. **Rate limits:** login per-IP 15-min lockout; playback URL generation 8/min violation logging.

## Secrets policy
Secrets live ONLY in env files (`apps/api/.env`, `apps/web` env, Vercel). Skills/docs/tests reference env var NAMES, never values. Never commit: SUPABASE_SERVICE_ROLE_KEY, MUX_*, BUNNY_*, ZOOM_*SECRET*, JWT_SECRET, REDIS_PASSWORD. `.env.example` documents shape. If a secret appears in output/logs/git history → rotate immediately.

## Production logging
Debug-level for routine events (unknown webhook types are debug, not warn); never log tokens, signatures, passwords, full personal data. Violation logging writes to playback_violations with details JSON.

## Common Failure Modes (historical)
| Vulnerability class | Where it happened |
|---|---|
| Correct-answer leak | assessment attempt payloads |
| Cross-user access | results/devices/profile email |
| Missing role guard | admin routes assumed cookie-only protection |
| Unsigned webhook trust | would have allowed forged status mutations |
| Curriculum table used for authz | display table ≠ auth source |

## Verification
Security specs: `tests/e2e/recordings/security-edge-cases.spec.ts`, `assessments/security.spec.ts`; unit suites include cross-user/cross-recording denials. Manual: run the IDOR sweep for any new id-bearing route.

## Do Not
- Do not add auth bypasses ("temporary" @Public).
- Do not log secrets even at debug level.
