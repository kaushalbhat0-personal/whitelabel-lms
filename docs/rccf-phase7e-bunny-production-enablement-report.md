# RCCF Report — Phase 7E: Bunny Production Enablement (LMS Goes Bunny-First)

**Date:** 2026-08-26
**Base:** working tree on `ab25e1b` (Phases 7B–7D uncommitted in tree)
**Scope:** provider policy flip to Bunny-first, browser TUS upload path, state-machine hardening, webhook test completion, verification. Zero player changes. Mux untouched.

---

## 1. Executive Summary

Phase 7E converts the Phase 7C *pilot* Bunny capability into the **production video path from day one**, per the business decision that the LMS launches with no existing content and therefore needs no migration.

Shipped:
- **Bunny-first provider policy** — every NEW recording routes to `provider='bunny'`; batch numbers are irrelevant. If Bunny is not configured, creation **fails visibly with 503** — silent fallback to Mux is structurally impossible. A single env switch (`VIDEO_UPLOAD_PROVIDER=mux`) is the documented dormant rollback.
- **Browser TUS uploader** (`apps/web/src/lib/upload/tus-uploader.ts`) — resumable, chunked (32 MiB), progress + cancel + safe retry with offset re-sync, zero new dependencies, using the exact presign algorithm verified in Phase 7C. The admin modal branches on the API-returned protocol handle; video bytes go browser → Bunny directly (never proxied).
- **State-machine bug fixed** — `UpdateRecordingDto` accepted status `'error'`, which violates the live CHECK constraint (the exact 7B-R3 incident class). Now validates only `processing|ready|failed` (+ dedicated DTO spec).
- **Webhook suite completed** — added signed-but-malformed-body and repeated-delivery idempotency cases; all 8 prompt-required scenarios now covered.

Verification: **240/240 unit tests**, API tsc/build clean, web tsc clean, **E2E 89/90** (the one failure is the pre-existing documented `assessments/browser-ui.spec.ts` flake, unchanged from baseline), live DB verified (12 legacy mux:ready rows, no test strays).

**Real-Bunny end-to-end verification (real library upload → webhook → CDN playback) is BLOCKED — manual Bunny configuration required** (no `BUNNY_*` credentials exist in any environment yet). Everything verifiable without them was verified.

## 2. Before Architecture

```
Admin modal ──POST /admin/recordings──► resolver.resolveUploadProvider(batchIds)
    Batch-list policy: BUNNY_ENABLED && every batch ∈ VIDEO_BUNNY_BATCH_IDS ⇒ bunny
    anything else ⇒ mux                                   ← migration scaffolding
Browser XHR PUT (Mux-style plain PUT only; Bunny handle's uploadKind/uploadHeaders
were DROPPED at the service return boundary — {recording, uploadUrl} only)
Zoom auto-pipeline: same batch-list policy
```
Known gaps at recon: TUS pieces absent client-side; response shape discarded the TUS handle; status DTO accepted illegal `'error'`; policy depended on batch numbers (retired requirement).

## 3. After Architecture

```
Admin modal ──POST /admin/recordings──► resolver.resolveUploadProvider()
   VIDEO_UPLOAD_PROVIDER=bunny (DEFAULT) ⇒ bunny for EVERY new recording
     (admin batch-linked / draft / Zoom auto-pipeline)
     not configured ⇒ VISIBLE 503, no row written, no fallback
   VIDEO_UPLOAD_PROVIDER=mux ⇒ dormant emergency rollback switch
API returns { recording, uploadUrl, upload:{ url, kind:'tus', headers, recordingId } }
Browser tusUpload() ──PATCH chunks──► https://video.bunnycdn.com/tusupload
   (per-video presigned headers; secret library key never leaves server)
Bunny processing ──signed webhook POST /bunny/webhook──► status ready|failed
Student: authorize → play (validateAccess + Redis token) → PlaybackGuard
   → resolver.providerFor(provider='bunny') → path-based CDN directory token
   → existing HLS.js player (unchanged, provider-generic)
```

## 4. Provider Policy

Implemented in `RecordingProviderResolver`:
- `productionUploadProvider` getter: `VIDEO_UPLOAD_PROVIDER` (default **bunny**); unknown values fail closed to bunny.
- bunny mode requires `BUNNY_ENABLED=true` AND full configuration, else throws `ServiceUnavailableException` **before** any DB row exists (fail fast, no orphans).
- mux mode = explicit emergency switch (logs a warning each use).
- `providerFor()` unchanged: bunny rows never fall back to Mux; NULL/legacy rows remain Mux (playback of the 12 existing recordings unaffected).
- Zoom auto-pipeline job inherits the policy automatically through the same resolver (`createAssetFromSource` → Bunny fetch endpoint).

## 5. TUS Implementation

- Server (`BunnyProvider.createDirectUpload`, Phase 7C, unchanged): create video → GUID; presign `SHA256(libraryId + apiKey + expire + videoGuid)`; TTL default 86 400 s (`BUNNY_UPLOAD_SIGNATURE_TTL_SECONDS`). The raw PUT endpoint remains unusable for browsers by design (secret AccessKey header) — TUS is the only credential-free path.
- Service layer now returns the FULL handle: `{ uploadUrl, upload: { url, kind, headers, recordingId } }` in both `createRecordingWithUpload` and `requestUploadUrl` (this was the missing link found in recon).
- Client `tusUpload()`:
  - PATCH chunks of 32 MiB with `TUS-Resumable: 1.0.0`, `Upload-Length` (total), `Upload-Offset`, `application/offset+octet-stream` + presigned headers on **every** request;
  - authoritative new offset read from response `Upload-Offset`;
  - per-chunk retry ×3 with **HEAD offset re-sync** before each retry (no duplicate/skipped bytes);
  - progress callback (intra-chunk via `xhr.upload.progress`) and cancellation via registered XHR (modal Cancel button keeps working);
  - visible errors surface into the existing error phase.
- No new dependencies (plain XHR; `tus-js-client` deliberately avoided).

## 6. Webhook Implementation

Verified intact from Phase 7C and completed with tests: `rawBody:true` preserved (`main.ts:26`); HMAC-SHA256 lowercase-hex over exact bytes vs `BUNNY_WEBHOOK_SECRET`; version/algorithm headers enforced; constant-time compare; 401 + zero mutations on failure; payload size cap; foreign-library rejection; provider-scoped row lookup (`provider='bunny'` + asset/upload-id slots) so a Bunny event can NEVER mutate a Mux row; duration backfill best-effort; cache invalidation; intermediate statuses ignored; failures logged, always 2xx to Bunny.

Test matrix now covers all 8 required scenarios: valid ready (3/4), failed (5), invalid signature (missing/tampered/wrong-secret/version/algorithm), oversized body, malformed non-JSON body (**new**), recording not found, Mux-row collision isolation, unlinked-upload linkage, foreign library, absent rawBody, repeated delivery idempotency (**new**). Signature verification was NOT weakened anywhere.

## 7. Playback Implementation

Unchanged by design (hard constraints #1/#4): `authorize` → `validateAccess(recording_batches)` + Redis playback token (600 s sliding, device-bound, revocable, 8/min rate limit) → `getPlaybackUrl` → `PlaybackGuard.getSignedUrl(token, {provider}, …)` below authorization → Bunny path-based directory token (4 h TTL) covering playlist AND segments; thumbnail query-token. HLS init effect deps remain `[playbackUrl, updateLevels, handleLevelChanged]` — `prefs` verified NOT present (buffer-reset fix intact); both callbacks are stable `useCallback`s.

## 8. DB Verification

Live schema confirmed via PostgREST OpenAPI introspection (authoritative; `schema.sql` ignored):
`recordings(id uuid pk, session_id?, title, description?, mux_asset_id?, mux_playback_id?, duration_seconds?, status default 'processing', created_at, updated_at, topic_id?, mux_upload_id?, sort_order default 0, cleanup_pending false, retry_count 0, cleanup_failed false, provider default 'mux')`.

- `recordings_provider_check CHECK (provider IN ('mux','bunny'))` per migration 035 (constraint DDL itself still pending ops-side introspection — REST cannot see CHECKs).
- Live data: **12 recordings, all `mux:ready`** before AND after E2E runs (suite cleanup left no strays). No student content. No schema change made or needed in this phase.

## 9. Security Verification

API-level, executed against the real environment (E2E suites):
- wrong-batch / cross-user / unauthenticated playback → blocked (`security-edge-cases.spec.ts`, `authorization.spec.ts`, `playback.spec.ts`);
- expired/invalid Redis token paths covered by guard specs (7B);
- provider ID confusion → webhook collision test proves Mux rows untouchable;
- forged/replayed webhooks → rejected (signature tests; replay-safe outcome test).

Design-level: presigned TUS headers are per-video + expiring (not secrets, but scoped); library key/token-signing key/webhook secret stay server-side; browser receives only derived handles; no Bunny values appear in web code (scan: comment-only mention of "AccessKey"), skills, fixtures or logs.

BLOCKED (needs real credentials/library): copied-CDN-URL-without-token behaviour, expired CDN token 403s, real webhook delivery over HTTPS.

## 10. Browser Verification

- **Desktop 1440 / tablet 768 / mobile 390 real upload+playback: BLOCKED — manual Bunny configuration required.** With the production policy active and zero Bunny credentials, recording creation correctly refuses to proceed — there is intentionally nothing to drive a real upload against.
- Verified instead: web tsc clean; modal logic unit-reasoned (TUS branch preserves phases/cancel/error UX; text de-provider-branded); API E2E exercised the identical endpoints the modal consumes (62/62), including real upload creation under the dormant-mux switch proving the response-shape change end-to-end.

## 11. Performance Measurements

No fabricated numbers. Instrumentation points ready for the credentialed run: TUS chunk timing (client), upload-complete→webhook-ready delta (log timestamps exist), playlist/first-segment timings (browser devtools/PW trace), long-session stability via 4 h CDN token design. Baselines to capture on first real upload: MB/s up, encode minutes, startup latency, segment fetch pattern.

## 12. Cost Measurement Plan

Track per recording: uploaded GB, stored GB-month, delivered GB (CDN logs/dashboard), encoding minutes. Compare against Mux baseline (≈₹12 000/mo current spend, storage+delivery+encoding bundled). Bunny published rates (Asia, Standard): $0.030/GB delivery, $0.01/GB storage, standard encoding free. **No savings claimed until first measured billing cycle.**

## 13. Tests

| Suite | Result |
|---|---|
| Unit (Jest) | **240/240** (21 suites; +12 vs Phase 7C baseline) |
| New: resolver bunny-first policy | 10 tests incl. visible-503 + dormant-switch |
| New: `UpdateRecordingDto` status vocabulary | canonical accepted / 'error' & others rejected |
| New: webhook malformed-body + repeated-delivery | pass |
| Extended: service upload-handle passthrough (plain + TUS) | pass |
| E2E recordings-api | **62/62** (incl. real Mux upload via dormant switch) |
| E2E assessments-api | 27/28 — pre-existing known flake only |
| API tsc + nest build · web tsc | exit 0 |

## 14. Files Changed (this phase)

- `apps/api/src/modules/video-provider/recording-provider.resolver.ts` (+spec) — bunny-first policy
- `apps/api/src/modules/recordings/recordings.service.ts` (+spec) — full upload-handle return shape
- `apps/api/src/modules/recordings/dto/update-recording.dto.ts` (+new spec) — canonical statuses only
- `apps/api/src/modules/video-provider/bunny-webhook.controller.spec.ts` — +2 cases
- `apps/api/.env.example` — `VIDEO_UPLOAD_PROVIDER=bunny`, docs; `VIDEO_BUNNY_BATCH_IDS` marked deprecated
- `apps/web/src/lib/upload/tus-uploader.ts` (NEW), `lib/api/recordings.ts` (type), `components/admin/recordings/upload-recording-modal.tsx` (TUS branch, neutral copy)
- `.agents/skills/mct-video-pipeline/SKILL.md`, `mct-admin-portal/SKILL.md` — institutional facts updated
- `docs/rccf-phase7e-bunny-production-enablement-report.md` (this file)

Note: the working tree also contains earlier uncommitted Phase 7B/7C implementation files (`bunny.provider.ts`, `bunny-webhook.controller.ts`, `video-provider.types.ts`, etc.) and an unrelated parallel work stream (attendance/live-sessions/trading-sessions/zoom). None were modified by this phase. Local-only: `VIDEO_UPLOAD_PROVIDER=mux` appended to `apps/api/.env` so this credential-less machine keeps running the Mux-based E2E suite (documented rollback switch doing its job).

## 15. Environment Variables Required

Server-side only: `BUNNY_ENABLED`, `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY` (Stream library key), `BUNNY_CDN_HOSTNAME`, `BUNNY_TOKEN_SIGNING_KEY` (Pull Zone Token Auth), `BUNNY_WEBHOOK_SECRET` (library Read-Only key), optional `BUNNY_CDN_TOKEN_TTL_SECONDS=14400`, `BUNNY_UPLOAD_SIGNATURE_TTL_SECONDS=86400`, policy switch `VIDEO_UPLOAD_PROVIDER` (default bunny). Dormant Mux vars remain as-is. **None may ever become NEXT_PUBLIC_\*.**

## 16. Manual Bunny Configuration Required

`BLOCKED — manual Bunny configuration required` for the following checklist:
1. Create Stream library (or use existing) → record Library ID.
2. Copy library **API key** (Stream → API).
3. Enable **Token Authentication** on the Pull Zone → copy **Token Signing Key**; set CDN hostname.
4. Copy library **Read-Only API key** → `BUNNY_WEBHOOK_SECRET`.
5. Register webhook URL `https://<api-host>/bunny/webhook` (Bunny dashboard).
6. Set the five `BUNNY_*` values + `VIDEO_UPLOAD_PROVIDER=bunny` in the deployment env; restart API.
7. Then execute runbook §16 of `rccf-phase7c-bunny-verification-report.md`: real upload → webhook → playback, plus the §9 BLOCKED security checks and §11 measurements.

## 17. Remaining Risks

1. Real-path behaviours (TUS CORS preflight on `video.bunnycdn.com`, webhook HTTPS delivery, CDN token 403 semantics) are doc-verified but not machine-verified until creds exist.
2. Bunny v1 webhook signature has no timestamp/replay window (mitigated: HTTPS, idempotent monotonic updates — documented 7C).
3. TUS uploader is dependency-free custom code (~170 lines) — mitigated by offset re-sync retries and the plain-PUT fallback path kept intact.
4. Pre-existing assessment browser-ui flake unrelated to video.
5. Ops must remember `VIDEO_BUNNY_BATCH_IDS` is now inert (deprecated) — presence causes no effect.

## 18. Rollback Plan

- **New uploads:** set `VIDEO_UPLOAD_PROVIDER=mux`, redeploy/restart → all new recordings go Mux again (proven working by today's E2E). No code change.
- **Single recording:** `UPDATE recordings SET provider='mux' WHERE id=…` (if its asset actually lives on Mux).
- **Feature-off:** `BUNNY_ENABLED=false` (with policy still bunny this yields visible 503s — intentional; combine with the mux switch for full rollback).
- Existing 12 Mux recordings are untouched throughout; playback routing for them never changed.

## 19. Production Readiness Score

**82/100** — deductions: real-Bunny E2E/browser/cost evidence outstanding (−12), webhook replay window inherent to Bunny v1 (−3), custom TUS client maturity (−3).

## 20. Decision

**CONDITIONAL GO.**
Code path is complete, tested (240 unit / 89-90 E2E), type-clean, DB-verified, and fails safe in every unconfigured direction. GO becomes unconditional after the Section-16 checklist is executed once against a real Bunny library (real upload → webhook → desktop + mobile playback → CDN token checks), which is the same gate style used in Phases 6/7A/7C.
