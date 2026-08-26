# RCCF — Phase 7B Pre-Implementation Audit

**Status:** Read-only audit. No code modified during this phase of work.
**Purpose:** Establish the exact current architecture before the staged Mux → Bunny migration, and record ambiguities/blockers that constrain implementation.

---

## 1. Current recording schema (`scripts/schema.sql:345-362`)

```sql
CREATE TABLE recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES live_sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  mux_asset_id TEXT,
  mux_playback_id TEXT,
  mux_upload_id TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'failed')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  cleanup_pending BOOLEAN NOT NULL DEFAULT false,
  retry_count INTEGER NOT NULL DEFAULT 0,
  cleanup_failed BOOLEAN NOT NULL DEFAULT false,
  created_at / updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **No provider column exists.** Every row is implicitly Mux.
- Provider identifiers live in Mux-named columns only.
- Related tables: `recording_batches (recording_id, batch_id)` — access control; `batch_recording_curriculum` — display/progress; `video_progress`, `video_views`, `video_access_logs`, `playback_events`, `playback_violations`; `upload_queue.mux_asset_id` (Zoom pipeline).

### Batch identification capability (§7 investigation)

`batches` table (`schema.sql:111-122`): `id UUID, course_id UUID, name TEXT, description, schedule_type, start_date, end_date, is_active`.

**There is NO batch number/code/sequence column.** "Batch 1" has no reliable in-database representation — names are free-form admin-entered text (verified in use: e.g. `"P6 Test Session"`). Per migration instructions ("If no reliable batch identifier exists: STOP and document… do not invent a fragile heuristic") this is recorded as **AMBIGUITY A-1** with a configuration-based resolution (see §9 below).

## 2. Current Mux lifecycle (all verified in source)

| Flow | Entry | Provider calls |
|---|---|---|
| Admin create-with-upload | `POST /admin/recordings` → `RecordingsService.createRecordingWithUpload` (`recordings.service.ts:240`) | `MuxService.createUploadUrl(title, '')` → INSERT recordings(status='processing', mux_upload_id) → Transaction(batch links + curriculum) |
| Admin draft upload | `POST /admin/upload-url` → `requestUploadUrl` (:319) | `MuxService.createDirectUploadUrl` → INSERT recording. **No batchIds in DTO** |
| Browser upload | `upload-recording-modal.tsx:147` XHR PUT to returned URL | none server-side |
| Zoom auto-pipeline | cron */2min `RecordingUploadJob` | Zoom token → `MuxService.uploadFromUrl` → INSERT recording(mux_asset_id) → link session_batches→recording_batches → queue done |
| Ready transition | `POST /mux/webhook` `video.asset.ready` → `MuxService.handleAssetReady` | status='ready', duration_seconds(rounded), playback-id backfill via `assets.retrieve`, cache invalidate |
| Upload linked | webhook `video.upload.asset_created` | UPDATE by mux_upload_id → asset/playback ids, status='processing' |
| Error transition | webhook `video.asset.errored` | writes `status='error'` — **violates CHECK constraint** ('failed' is canonical); error swallowed, returns 200 ⇒ stuck 'processing' |
| Dashboard deletion | webhook `video.asset.deleted` | hard DELETE recordings row |
| Playback | `POST /recordings/:id/authorize` → `PlaybackGuard.authorize` (opaque Redis token, TTL 600s, bound userId+recordingId+deviceId) ; `GET /recordings/:id/play?token=` → `PlaybackGuard.getSignedUrl` → `MuxService.getSignedPlaybackUrl/getSignedThumbnailUrl` (RS256 JWT exp 60s/300s, query param) | stream.mux.com/image.mux.com |
| Delete | `DELETE /admin/recordings/:id` | tx(curriculum→links→cleanup_pending=true) → `MuxService.deleteAsset` outside tx → hard delete row; failure ⇒ cleanup_pending retry job |
| Cleanup retry | cron 15min `RecordingCleanupJob` | MAX_RETRIES=10 → cleanup_failed |

## 3. Authorization flow (unchanged by migration)

Student JWT → JwtAuthGuard/RolesGuard(STUDENT) → `validateAccess()`: status==='ready' AND `batch_students ∩ recording_batches ≠ ∅` → Redis playback token (revocation check, user/recording/device binding, slid TTL, rate windows 8 URLs/min, 15 seeks/min, 60 events/min) → provider signed URL. `recording_batches` is the single source of truth (ADR-001). **Provider layer sits strictly below LMS authorization.**

## 4. Webhook flow

Single endpoint `POST /mux/webhook` (`@Public()`): HMAC-SHA256 over `req.rawBody` (`main.ts:26` rawBody:true), header `mux-signature: t=…,v1=…`, constant-time compare, always HTTP 200. Four event types handled (§2). Unknown events logged debug. **No Bunny webhook endpoint exists.**

## 5. Exact provider-specific coupling points

| # | Location | Coupling |
|---|---|---|
| C1 | `recordings.service.ts:240,319` upload creation | direct `MuxService.createUploadUrl/createDirectUploadUrl` |
| C2 | `recordings.service.ts:794-815` delete | direct `MuxService.deleteAsset(recording.mux_asset_id)` |
| C3 | `recordings.service.ts:1303-1324` getPlaybackUrl | reads `mux_playback_id` → `playbackGuard.getSignedUrl(token, muxPlaybackId,…)` |
| C4 | `playback-guard.service.ts:119-122` | direct `MuxService.getSigned{Playback,Thumbnail}Url` inside security envelope |
| C5 | `recording-upload.job.ts:83` | direct `MuxService.uploadFromUrl` |
| C6 | `recording-cleanup.job.ts:117` | direct `MuxService.deleteAsset` |
| C7 | `mux.controller.ts` | Mux webhook lifecycle (stays Mux-owned) |
| C8 | DB columns | mux_asset_id / mux_playback_id / mux_upload_id naming |
| C9 | Frontend | `AdminVideo.mux_playback_id/mux_asset_id` types, grouped payload `muxPlaybackId` field name — display-only metadata; player receives opaque `{url, thumbnail}` and is provider-generic (hls.js, no Mux SDK/events; `@mux/mux-player-react` declared but imported nowhere) |

Dead code (out of scope): `modules/videos/*` unregistered in `app.module.ts`; `@mux/mux-player-react` unused dependency.

## 6. Current tests

- `recordings.service.spec.ts`: mocks `SupabaseService/MuxService/PlaybackGuardService/ObservabilityService/RedisService`; covers authorize access matrix, curriculum sync/rollback, delete flows, requestUploadUrl, student listing. Adding any constructor dependency to `RecordingsService` requires updating this spec's providers.
- `recording-cleanup.job.spec.ts`: mocks `MuxService.deleteAsset`; covers retry/404/orphan paths.
- No playback-guard spec, no mux controller spec, no E2E for video pipeline.

## 7. Bunny integration gaps (repository evidence)

Verified: **zero** Bunny references in the repository — no package, no credentials, no docs, no prior integration. Therefore:

- Bunny API shapes (upload, fetch-from-URL, status vocabulary, duration units, thumbnail timing) — UNVERIFIED.
- Bunny signed-URL/token enforcement model (per-request vs session) — UNVERIFIED. Phase 7A established that today one 60s Mux token authorizes an entire viewing session; if Bunny enforces expiry per segment/media-playlist request, reusing short expiries would stall playback mid-stream.
- Bunny webhook catalogue + signature scheme — UNVERIFIED.
- Bunny pricing/billing metrics — UNAVAILABLE (repo analytics do not touch video tables; no storage/egress data).

Per constraints #14/#15 these are **BLOCKERS B-1..B-3**: no invented API behavior, no faked success.

## 8. Migration risks (carried + new)

R1 missed-webhook tolerance is zero (no sweeper) · R2 token-lifetime semantics conflict (above) · R3 status CHECK violation bug (must be fixed as part of canonical mapping) · R5 historical re-sourcing strategy for old Mux assets undefined and OUT OF SCOPE this phase · R8 upload_queue failures never retried · multi-batch uploads share ONE asset across batches (single provider per recording is structurally required).

## 9. Ambiguities & resolutions (STEP 3 report)

| ID | Ambiguity | Resolution implemented in 7B |
|----|-----------|------------------------------|
| A-1 | No stable "Batch 1" identifier in DB (§1) | Centralized env-configured policy: `VIDEO_BUNNY_BATCH_IDS` (comma-separated batch UUIDs) declares bunny-routed batches. Resolver routes to bunny ONLY when `BUNNY_ENABLED=true` AND every target batch is explicitly listed. All other cases → `'mux'`. Default (unset) = 100% Mux = zero production behavior change until ops explicitly enables Bunny. Not a heuristic — explicit ops configuration, single resolution point. |
| A-2 | Multi-batch upload (Batch 1 + Batch 2 selected together): which provider? | Existing business model shares ONE asset across batches (`recording_batches` = pure access control), so one recording = exactly one provider. Deterministic rule: ALL selected batches in bunny set ⇒ bunny; ANY not in set (incl. Batch 1 or unknown) ⇒ mux (conservative — legacy batches stay on proven provider). Documented, never silent. |
| A-3 | Draft upload flow (`requestUploadUrl`) has no batchIds | Resolves to `'mux'` (safe default). Batch assignment happens after creation and does not move assets; noted as operational limitation. |
| A-4 | Schema: reuse mux-named columns as generic slots vs duplicate generic trio | Add ONLY `provider TEXT NOT NULL DEFAULT 'mux'` (+ CHECK). The three identifier columns are nullable TEXT keyed by `row.provider` and are treated as provider-agnostic slots ("provider asset/playback/upload id"); physical rename deferred to the Mux-retirement phase with coordinated frontend type updates. Avoids dual-write inconsistency across 6+ call sites; fully backwards compatible; satisfies "do NOT blindly add duplicate columns". |
| B-1 | Bunny API behavior unconfirmed | `BunnyProvider` ships as a config-gated provider: requires `BUNNY_ENABLED=true` + library id/API key/CDN hostname; every operation throws an explicit `ServiceUnavailableException` when unconfigured. NO guessed endpoints, token math, URL shapes, or webhook signatures. |
| B-2 | Bunny token enforcement model unconfirmed | Token/expiry logic deliberately NOT implemented. Documented blocker; activation requires external confirmation spike. |
| B-3 | Bunny webhook schema/signature unconfirmed | `POST /bunny/webhook` ships in observation mode: parses + logs events, performs ZERO mutations, returns 200. Activation gated on confirmed signature scheme + event catalogue. |

## 10. Proposed files to change

```
NEW   scripts/migrations/035-recording-provider.sql          additive provider column
MOD   scripts/schema.sql                                      reflect column (doc-of-record)
NEW   apps/api/src/modules/video-provider/
        video-provider.types.ts                               interface, provider names, status map
        recording-provider.resolver.ts                        centralized routing (A-1/A-2/A-3)
        providers/mux.provider.ts                             thin adapter over existing MuxService
        providers/bunny.provider.ts                           config-gated provider (B-1/B-2)
        bunny-webhook.controller.ts                           observation-mode endpoint (B-3)
        video-provider.module.ts
        *.spec.ts                                             resolver/provider unit tests
MOD   apps/api/src/modules/mux/mux.controller.ts              errored → 'failed' (canonical map)
MOD   apps/api/src/modules/recordings/recordings.service.ts   resolver at C1/C2/C3
MOD   apps/api/src/modules/playback/playback-guard.service.ts provider-aware URL issuance at C4 (security envelope unchanged)
MOD   apps/api/src/jobs/recording-upload.job.ts               resolver at C5
MOD   apps/api/src/jobs/recording-cleanup.job.ts              resolver at C6
MOD   apps/api/src/app.module.ts                              register VideoProviderModule
MOD   apps/api/src/modules/{recordings,playback}.module.ts    import VideoProviderModule
MOD   apps/api/.env.example                                   BUNNY_* keys (inactive, documented)
MOD   apps/api/src/modules/recordings/recordings.service.spec.ts  provide resolver mock
NEW   apps/api/src/modules/video-provider/*.spec.ts           §22 test matrix
NEW   docs/rccf-phase7b-preimplementation-audit.md            this file
NEW   docs/rccf-phase7b-mux-bunny-migration-report.md         final report
```

Frontend: **no changes** (contract `{url, thumbnail, sessionId}` preserved; player untouched per constraint #10/#12).

— End of audit. Implementation proceeds under resolutions A-1..A-4 / blockers B-1..B-3 above.
