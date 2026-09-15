# RCCF Report — Phase 7A: Mux → Bunny Video Migration Audit & Blueprint

**Scope:** Full audit of the recording/video pipeline (upload, processing, webhooks, playback security, HLS player, deletion) and a migration blueprint to Bunny. **No code, schema, config, or player changes were made** (per instruction).

**Evidence base:** `apps/api/src/modules/mux/*`, `modules/recordings/*`, `modules/playback/*`, `jobs/recording-*.job.ts`, `zoom-webhook.handler.ts`, `scripts/schema.sql` + `scripts/migrations/`, `apps/web/src/app/student/videos/[recordingId]/video-player-client.tsx`, `hooks/usePlaybackToken.ts`, `hooks/usePlayerPreferences.ts`, `components/admin/recordings/upload-recording-modal.tsx`, `lib/api/{playback,videos,recordings}.ts`, `app.module.ts`, both `package.json` files.

**Bunny claims policy:** Per instruction, no web browsing was performed. Every Bunny capability/pricing statement in this document is marked either **[VERIFIED-IN-REPO]** (impossible — nothing Bunny-related exists in the repo) or **⚠️ REQUIRES EXTERNAL CONFIRMATION**. No Bunny pricing numbers are stated.

---

## 1. Executive Summary

The LMS video stack is unusually well-positioned for a provider migration:

1. **All Mux API access is already chokepointed** into a single service (`mux.service.ts`, 401 lines). Nothing else imports `@mux/mux-node`.
2. **The HLS player is provider-generic.** It is plain hls.js consuming an opaque `.m3u8` URL + poster image URL handed to it by the backend. It uses zero Mux SDKs, zero Mux metadata, and zero Mux-specific events.
3. **Authorization is fully decoupled from the provider.** Access control lives in `recording_batches` + Redis opaque tokens (`PlaybackGuardService`) — none of it touches Mux except at the final URL-signing step.
4. The DB stores only three Mux-named columns (`mux_asset_id`, `mux_playback_id`, `mux_upload_id`). Everything else (`status`, `duration_seconds`, cleanup flags) is provider-neutral.

The migration risks are concentrated in exactly four places:

| # | Risk | Severity |
|---|------|----------|
| R1 | Mux webhook parity: 4 events control the ready-state machine; Bunny webhook granularity/API shape is unverified | P1 |
| R2 | Token semantics: today one 60-second signed URL authorizes an *entire viewing session*; if Bunny enforces token expiry per segment request (typical CDN token auth), a 60s token kills playback mid-stream. Bunny tokens must outlive the session, with tightness preserved at the LMS layer instead | P0 |
| R3 | Latent bug found by audit: `video.asset.errored` writes `status='error'` but the schema CHECK constraint only allows `'processing','ready','failed'` → the update would fail silently (webhook always returns 200) and recordings would stay stuck in `processing` | P1 |
| R4 | Cost case is unverified: repo contains no storage/delivery GB metrics; ₹12k/month is user-provided; Bunny pricing not confirmable from repo | P2 |

**Migration readiness: 74/100 — CONDITIONAL GO** (details in §20).

---

## 2. Current Mux Architecture

### 2.1 Component map [VERIFIED-IN-REPO]

```
BACKEND (apps/api)
├── modules/mux/
│   ├── mux.service.ts          ← THE ONLY file that talks to Mux API (@mux/mux-node ^8.0.0)
│   │     createUploadUrl(title, topicId)            direct upload, signed playback policy
│   │     createDirectUploadUrl(title)               direct upload, cors_origin '*'
│   │     uploadFromUrl(sessionId, url, title)       Zoom pull import (asset.create input:[{url}])
│   │     handleAssetReady(assetId, dur, pbId?)      DB status→ready + duration + playback-id backfill
│   │     getSignedPlaybackUrl(playbackId, session)  60s RS256 JWT → stream.mux.com/{pb}.m3u8?token=
│   │     getSignedThumbnailUrl(playbackId, session) 300s RS256 JWT → image.mux.com/{pb}/thumbnail.jpg?token=
│   │     signMuxJwt() / signJwt()                   manual RS256 via node:crypto (no jsonwebtoken dep)
│   │     deleteAsset(assetId)                       404 tolerated
│   │     verifyWebhookSignature(rawBody, header)    HMAC-SHA256 t=/v1= constant-time vs rawBody
│   └── mux.controller.ts       POST /mux/webhook (@Public) — 4 event types handled
├── modules/recordings/         CRUD, batch assignment, curriculum sync, student lists, playback entry
├── modules/playback/           PlaybackGuardService (opaque Redis tokens), /playback/event, admin violations
├── jobs/recording-upload.job.ts    cron */2min: upload_queue → Zoom token → Mux asset.create(url)
├── jobs/recording-cleanup.job.ts   cron 15min: cleanup_pending retry loop, MAX_RETRIES=10
└── zoom-webhook.handler.ts         'recording.completed' → upload_queue row (LIVE — wired in zoom.controller.ts:149)

FRONTEND (apps/web)
├── app/student/videos/[recordingId]/video-player-client.tsx   ← hls.js player (NOT @mux/mux-player-react)
├── hooks/usePlaybackToken.ts     authorize → play → {url, thumbnail}
├── hooks/usePlayerPreferences.ts localStorage prefs (speed/volume/muted/quality)
├── components/admin/recordings/upload-recording-modal.tsx     XHR PUT directly to Mux upload URL
└── lib/api/playback.ts, videos.ts, recordings.ts

DEAD CODE (verified):
├── modules/videos/*              VideosModule NOT registered in app.module.ts:112-146
└── @mux/mux-player-react ^3.13.0 declared in web/package.json:12, imported NOWHERE
```

### 2.2 Environment variables consumed

`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` (API client), `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` (RS256 playback tokens), `MUX_WEBHOOK_SECRET` (HMAC). All in `.env.example`.

---

## 3. Complete Mux Dependency Map

| Consumer | File | What it needs from Mux |
|---|---|---|
| Admin create-with-upload | `recordings.service.ts:240` `createRecordingWithUpload()` | Direct upload URL (+upload ID) |
| Admin draft upload | `recordings.service.ts:319` `requestUploadUrl()` | Direct upload URL (+upload ID) |
| Browser PUT | `upload-recording-modal.tsx:147-150` | Raw upload URL (XHR PUT, CORS) |
| Zoom auto-pipeline | `recording-upload.job.ts:83` | Asset creation from source URL (`uploadFromUrl`) |
| Webhook ready handler | `mux.controller.ts:116` → `mux.service.ts:163` | Asset retrieve (playback-ID backfill fallback) |
| Student playback | `playback-guard.service.ts:119-122` | Signed m3u8 URL + signed thumbnail URL |
| Admin delete | `recordings.service.ts:796`, `recording-cleanup.job.ts:117` | Asset delete (404-tolerant) |
| Webhook trust | `mux.controller.ts:61` | HMAC signature verification |

That is **exactly six provider operations**: `createDirectUpload`, `createAssetFromUrl`, `getAssetStatus`(implicit backfill), `signPlaybackUrl`, `signThumbnailUrl`, `deleteAsset` — plus webhook verification.

---

## 4. Recording Lifecycle (traced end-to-end)

```
Admin selects video (upload-recording-modal.tsx)
   ↓  POST /admin/recordings  (RolesGuard ADMIN)
Upload URL creation        RecordingsService.createRecordingWithUpload (recordings.service.ts:240)
   → MuxService.createUploadUrl (signed playback policy, passthrough metadata)
   → INSERT recordings (status='processing', mux_upload_id)
   → Transaction: upsert recording_batches + batch_recording_curriculum
   Failure: recording row deleted (orphan cleanup, recordings.service.ts:293-300);
            Mux upload URL left dangling (harmless, unused uploads expire at Mux ⚠️ expiry window unconfirmed)
   ↓  XHR PUT file → Mux ingest (browser-direct; video never touches our server)
Mux asset creation
   ↓  POST /mux/webhook  video.upload.asset_created  (mux.controller.ts:82)
   → UPDATE recordings SET mux_asset_id, mux_playback_id, status='processing' WHERE mux_upload_id
Processing (Mux internal)
   ↓  POST /mux/webhook  video.asset.ready           (mux.controller.ts:116)
DB status update           MuxService.handleAssetReady (mux.service.ts:163)
   → UPDATE recordings SET status='ready', duration_seconds(rounded int), playback-id backfill
   → RedisCacheService.invalidateRecordingsCache()
Recording becomes ready    (student queries filter .eq('status','ready'))
Batch assignment           POST /admin/recordings/:id/batches → Transaction(recording_batches ⇄ curriculum sync)
Student authorization      POST /recordings/:id/authorize (STUDENT)
   → validateAccess(): status==='ready' AND batch_students ∩ recording_batches ≠ ∅ (recordings.service.ts:1226)
   → PlaybackGuard.authorize(): random UUID token → Redis playback_token:{t}, TTL 600s,
     payload {userId, recordingId, deviceId?, sessionId, ip}
Playback token             GET /recordings/:id/play?token=…
   → validateAccess again + PlaybackGuard.getSignedUrl:
     revocation check → token exists → userId match → recordingId match → device match
     → Mux RS256 JWT (sub=playbackId, aud=v, exp=+60s, session_uuid) → https://stream.mux.com/{pb}.m3u8?token=
     → thumbnail JWT exp=+300s
     → writes video_views + video_access_logs, Redis playback_session:{sid} TTL 120s
     → rate windows: >8 URLs/min, >15 seeks/min, >60 events/min → playback_violations rows
HLS player                 hls.js loadSource(url); Safari native path (video-player-client.tsx:228-287)
Progress tracking          POST /recordings/:id/progress (upsert video_progress every ≥20s / pause / seek)
                           POST /playback/event heartbeats every ~30s → playback_events
Completion                 on 'ended': updateVideoProgress(duration, completed=true) (video-player-client.tsx:134)
Deletion / cleanup         DELETE /admin/recordings/:id (recordings.service.ts:732)
   → Transaction: delete curriculum → delete recording_batches → set cleanup_pending=true
   → outside tx: MuxService.deleteAsset → success ⇒ hard-delete recordings row
                              → failure ⇒ RECORDING_CLEANUP_PENDING event, return {cleanupPending:true}
   → RecordingCleanupJob (cron 15min): retries pending cleanups, MAX_RETRIES=10 then cleanup_failed=true;
     orphan rows (no mux_asset_id) hard-deleted immediately
Side door: Mux dashboard deletion → video.asset.deleted webhook → DB row hard-deleted (mux.controller.ts:162)
```

**Per-stage failure/retry behaviour**

| Stage | Failure mode | Retry |
|---|---|---|
| Upload URL creation | 500 to admin modal; recording rolled back | Manual re-submit |
| Browser PUT | Modal error state | Manual re-upload |
| asset_created webhook missed | Row stays `processing` with NULL asset id | None (⚠️ no reconciliation sweep for this gap) |
| asset.ready webhook missed | Stuck `processing` forever | None |
| asset.errored webhook | UPDATE violates CHECK constraint (see §9/R3) → swallowed → stuck `processing` | None |
| authorize/play denial | 403 logged to playback_violations | Client shows error overlay + retry button |
| Signed URL expired (>60s before manifest fetch) | Player fatal error → overlay retry (`refreshUrl`) | User-initiated |
| Mux delete fails | cleanup_pending=true → cron retry ×10 → cleanup_failed=true | Automatic |
| Zoom→Mux queue job fails | upload_queue.status='failed' (error_message saved) | **None** — `attempts` column never incremented/used |

---

## 5. Playback Architecture

Two-layer token design [VERIFIED-IN-REPO]:

```
Layer 1 (LMS):   opaque UUID token in Redis, TTL 600s, bound to {userId, recordingId, deviceId?, ip},
                 slid on use, revocable per-user (24h marker). Provider-agnostic. NEVER expires mid-playback issues
                 because it's only checked at URL issuance.
Layer 2 (CDN):   RS256 JWT, kid=MUX_SIGNING_KEY_ID, sub={playbackId}, aud=v|t, exp=+60s (video) / +300s (thumb),
                 custom session_uuid claim for audit. Verified by Mux edge on stream.mux.com/image.mux.com.
```

Key operational observation: playback sessions run far longer than 60s in production today. Therefore Mux's effective semantics are *"one valid token on the master playlist authorizes the whole delivery session"* (exact edge mechanics are internal to Mux). Any provider whose token auth is enforced **per request** (segments, media playlists) cannot use a 60s token. This asymmetry drives requirement **BUN-SEC-1** below.

---

## 6. HLS Player Analysis

**File:** `apps/web/src/app/student/videos/[recordingId]/video-player-client.tsx` (632 lines)

### What the player receives today [VERIFIED]
- `playbackUrl`: `https://stream.mux.com/{playbackId}.m3u8?token=<RS256 JWT>` — a **fully-formed, signed, opaque URL** produced by the backend (`usePlaybackToken` → `/recordings/:id/authorize` → `/recordings/:id/play?token=`).
- `thumbnail`: signed poster URL (`image.mux.com/{playbackId}/thumbnail.jpg?token=<JWT>`), used as `<video poster>`.
- `sessionId`: UUID for watermarking (`WatermarkOverlay`) and event reporting.

### Answers to the mandated checklist

| Question | Answer | Evidence |
|---|---|---|
| Does it receive a Mux HLS URL? | Yes — but as an opaque string. Player code contains no Mux knowledge | hook contract, `usePlaybackToken.ts` |
| Is the URL signed? | Yes — RS256 JWT in `?token=` query param, generated server-side | `mux.service.ts:224-234` |
| Token embedded in URL or query params? | Query param (`?token=`) | same |
| Does Hls.js require anything Mux-specific? | **No.** Standard `new Hls()`, `loadSource`, `attachMedia`. Safari native HLS branch | `video-player-client.tsx:228-287` |
| Are quality levels provider-specific? | **No.** Levels parsed generically from the manifest into `{index,height,width,bitrate,name}` | `updateLevels()` :186-207 |
| Does the player rely on Mux metadata? | **None.** Duration from `<video>` element, buffering from `Hls.Events.BUFFER_APPENDED` | :246-264 |
| Are poster images Mux-generated? | Yes, but delivered as an opaque `<img src>`-able URL | `poster={thumbnailUrl}` :508 |
| Does it rely on Mux-specific events? | **No.** Only `Hls.Events.{MANIFEST_PARSED, LEVEL_SWITCHED, BUFFER_APPENDED, ERROR}` + native media events | :246-271 |
| Can Bunny HLS be consumed with minimal/no frontend changes? | **Yes, conditional:** any standards-compliant ABR HLS master playlist works unchanged. Two conditions: (a) backend keeps returning `{url, thumbnail}` of the same shape; (b) Bunny's token auth must survive segment/media-playlist fetches by hls.js without URL rewriting client-side. Bunny Stream documents that generated playlists carry embedded segment tokens when token auth is enabled — **⚠️ REQUIRES EXTERNAL CONFIRMATION** | — |

### MUST change (Phase 7B, minimal)
- **Nothing in the render/lifecycle paths**, provided backend response shape `{url, thumbnail, sessionId, expiresAt}` is preserved.
- Optional P3 hygiene (separate PR): remove unused `@mux/mux-player-react` dependency from `apps/web/package.json`; fix stale CLAUDE.md references ("Mux Player", `MuxVideoPlayer` component does not exist).
- If Bunny thumbnails require different sizing params, that is backend URL construction only — not player changes.

### MUST NOT change
- The HLS effect dependency array `[playbackUrl, updateLevels, handleLevelChanged]` (:287) — `updateLevels`/`handleLevelChanged` are stable `useCallback`s; prefs are applied in the separate guarded effect (`prefsApplied` ref, :97-115). This is the regression fix; do not touch.
- Single-Hls-instance discipline: destroy-on-recreate (:242), destroy-on-fatal-error (:266-271), destroy-on-unmount (:281-286).
- `seekToOnReady` ref pattern for resume-before-media-attached (:249-252, :441-444).
- Native-Safari branch and final `else` fallback (:236, :276).

---

## 7. Security Analysis

### Current chain [VERIFIED]

```
Student JWT (24h, Redis sliding session, single-device enforced)
  → JwtAuthGuard (global) + RolesGuard(STUDENT)
  → validateAccess(): recordings.status==='ready' AND batch_students ∩ recording_batches (ADR-001 single source of truth)
  → PlaybackGuard.authorize(): opaque token, Redis TTL 600s, bound {userId, recordingId, deviceId, sessionId, ip}
  → PlaybackGuard.getSignedUrl(): revocation check → 4 binding checks → Mux RS256 JWT (60s)
  → HLS via stream.mux.com (signed playback policy enforced on ALL assets)
```

| Question | Answer | Evidence |
|---|---|---|
| How does playback authorization work? | Two layers: LMS opaque token gates *issuance*; Mux JWT gates *delivery* | §5 |
| Token lifetime | LMS token 600s (slid per use); Mux video JWT 60s; thumbnail JWT 300s | `redis-keys.constant.ts:53`, `mux.service.ts:228,248` |
| Tokens reusable? | LMS token reusable within TTL (slides); Mux JWT reusable until exp | `playback-guard.service.ts:113-117` |
| URLs shareable? | Only within ≤60s and only to whoever holds them; no identity binding inside Mux JWT (only audit `session_uuid`) | by design |
| Origin/referrer restrictions? | **None** at CDN layer. Upload CORS: `FRONTEND_URL` for create-flow, `'*'` for draft flow (`mux.service.ts:81,113`) — P2 note | — |
| Playback IDs public? | Never returned raw by any endpoint (student selects exclude `mux_playback_id` in flat list; grouped list returns `muxPlaybackId` **in the payload** but it is unusable without a fresh server-side signature because all assets are `playback_policy:['signed']`) | `fetchMyRecordingsGrouped` :1098 |
| Signed URLs used? | Yes, universally | — |
| Raw Mux asset URLs exposed? | No | — |
| Another student's recording? | Blocked: token userId must equal authenticated userId AND recordingId must match; plus `validateAccess` re-runs | `playback-guard.service.ts:98-106` |
| Cross-batch access blocked? | Yes: `validateAccess` requires intersection of user's batches with `recording_batches` | `recordings.service.ts:1254-1270` |
| Device pinning | Implemented but **inactive** — frontend passes `deviceId: undefined` (`video-player-client.tsx:84`) | — |
| Forensics | `video_access_logs`, `video_views`, `playback_events`, `playback_violations`, rate thresholds (8 URLs/min, 15 seeks/min, 60 events/min) | `playback-guard.service.ts:130-153,181-198` |

### Equivalent Bunny security requirements (authorization must NOT weaken)

- **BUN-SEC-1 (P0):** Keep Layer 1 identical (opaque Redis token, bindings, revocation, thresholds). Move *time-tightness* entirely to Layer 1. Issue Bunny delivery tokens with expiry ≥ expected viewing session length (hours, exact value = product decision) since Bunny-style CDN token auth is typically enforced per request — **⚠️ confirm Bunny enforcement model first**.
- **BUN-SEC-2:** Token authentication MUST be mandatory on the Bunny zone/library so a bare GUID/ID URL (the equivalent of an unsigned playback ID) is rejected — preserves "no unsigned playback IDs" guarantee. ⚠️ confirm feature name/settings.
- **BUN-SEC-3:** Thumbnails follow the same signed policy (or a documented, accepted weaker policy — decision required; today they are signed).
- **BUN-SEC-4:** Server-side authorization flow (`authorize` → `play`) remains the ONLY path to a playback URL; the provider abstraction must not expose raw CDN hostnames to callers.
- **BUN-SEC-5:** Preserve violation logging semantics; add provider field to access logs so incidents are attributable per provider.
- **BUN-SEC-6 (nice-to-have, currently absent everywhere):** origin/referrer restrictions do not exist today under Mux; adding them under Bunny is an improvement, not a parity requirement.

---

## 8. Webhook Analysis

Endpoint: `POST /mux/webhook` — `@Public()`, HMAC-SHA256 over `req.rawBody` (`main.ts` sets `rawBody:true`), header `mux-signature: t=…,v1=…`, constant-time compare, **always HTTP 200 `{message:'ok'}`** even on verification failure (deliberate: prevents retry storms; trade-off documented).

| Event | Endpoint | Sig verify | DB mutation | Required in Bunny |
|---|---|---|---|---|
| `video.upload.asset_created` | `/mux/webhook` | ✅ HMAC | `UPDATE recordings SET mux_asset_id, mux_playback_id, status='processing' WHERE mux_upload_id` (`mux.controller.ts:82-111`) | Equivalent "upload accepted/linked" event — maps upload→asset. ⚠️ CONFIRM Bunny has an analogous signal (or emulate via polling after upload completion) |
| `video.asset.ready` | `/mux/webhook` | ✅ | `status='ready'`, `duration_seconds`, playback-id backfill, cache invalidation (`mux.service.ts:163-206`) | **CRITICAL** — controls ready state & playback availability. ⚠️ CONFIRM Bunny "video finished encoding" webhook + duration payload |
| `video.asset.errored` | `/mux/webhook` | ✅ | `UPDATE status='error'` — **latent bug: violates CHECK constraint** (see §10/R3) | Encode-failure signal needed for error state. ⚠️ CONFIRM |
| `video.asset.deleted` | `/mux/webhook` | ✅ | Hard `DELETE FROM recordings WHERE mux_asset_id` (`mux.controller.ts:162-180`) | Deletion propagation from provider dashboard. ⚠️ CONFIRM (or accept "dashboard deletions don't propagate" during migration) |
| everything else (`video.upload.created`, `video.asset.created`, …) | logged `debug`, ignored | — | — | Not needed |

Events control: **processing** (asset_created), **ready state / playback availability** (asset_ready), **errors** (asset_errored — currently broken), **deletion** (asset_deleted). Metadata arrives via `passthrough` JSON on upload/asset creation (title/topicId/sessionId) — Bunny equivalent of passthrough metadata ⚠️ CONFIRM.

**Polling fallback requirement:** because the current pipeline has *zero* tolerance for a missed webhook (no sweeper), Phase 7B should add a cheap reconciliation poll (`provider.getStatus()` for rows stuck in `processing` > N hours) regardless of provider — this de-risks webhook-parity unknowns.

---

## 9. Database Analysis

Current provider fields [VERIFIED, `schema.sql:345-362`]:

```sql
mux_asset_id TEXT, mux_playback_id TEXT, mux_upload_id TEXT,
duration_seconds INTEGER,
status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
cleanup_pending BOOLEAN DEFAULT false, retry_count INTEGER DEFAULT 0, cleanup_failed BOOLEAN DEFAULT false
```

Provider-touching tables: `recordings` (above), `upload_queue.mux_asset_id` (`schema.sql:450`).

### Recommendation: single-table provider-discriminator design (as proposed)

```
recordings
├── id
├── provider             TEXT NOT NULL DEFAULT 'mux' CHECK (provider IN ('mux','bunny'))
├── provider_asset_id    TEXT   ← copies mux_asset_id
├── provider_playback_id TEXT   ← copies mux_playback_id   (name choice: keep semantic "playback id")
├── provider_upload_id   TEXT   ← copies mux_upload_id
├── status … (unchanged values; FIX constraint to include whatever error value we standardize on)
└── …
```

Why this design wins here:
- Exactly one provider per recording (no recording needs two providers simultaneously — migration replaces delivery, doesn't fan out).
- Keeps every existing query shape (`WHERE id=…`) untouched; only ID lookups change columns.
- `provider` enables routing in the abstraction (`getProvider(row)`), rollback (`provider='mux'` restores Mux delivery instantly), and per-provider cost attribution.
- Avoids a second table (`recording_provider_assets`), which adds joins for zero benefit at ~hundreds-of-recordings scale.

Rejected alternative (per-batch/per-quality child table): unnecessary — there is no multi-variant or multi-provider-per-recording requirement anywhere in the codebase.

**Migration implications (design now, execute in 7B):**
1. Additive migration: add `provider` (default `'mux'`), add generic columns.
2. Backfill: `UPDATE recordings SET provider_asset_id = COALESCE(provider_asset_id, mux_asset_id), …` (idempotent, non-destructive).
3. Dual-read period: code prefers generic columns, falls back to `mux_*`.
4. Drop `mux_*` columns only in the post-soak cleanup phase (Stage 8). Same pattern for `upload_queue`.
5. Constraint fix bundled: decide canonical error status (`'failed'` exists in enum `shared-types/enums.ts:20-24` — reuse it; stop writing `'error'`).

---

## 10. Provider Abstraction Proposal (design only — do not implement)

The codebase needs **exactly these methods** (derived from §3 — nothing more):

```ts
interface VideoProvider {
  // Admin browser upload (createRecordingWithUpload + requestUploadUrl flows)
  createDirectUpload(opts: { title: string; passthrough?: Record<string, unknown> }):
    Promise<{ uploadUrl: string; uploadId: string }>;

  // Zoom auto-pipeline (server-side pull import)
  createAssetFromUrl(opts: { sourceUrl: string; passthrough: Record<string, unknown> }):
    Promise<{ assetId: string }>;

  // Webhook backfill + future reconciliation sweeper
  getAssetStatus(assetId: string): Promise<{
    status: 'processing' | 'ready' | 'failed';
    durationSeconds?: number;
    playbackId?: string;
  }>;

  // Student playback (called by PlaybackGuard AFTER LMS authorization)
  getPlaybackUrls(playbackId: string, ctx: { sessionId: string }): Promise<{
    url: string; expiresAt: string;
    thumbnail: { url: string; expiresAt: string };
  }>;

  // Delete flows (admin delete + cleanup job); must tolerate already-deleted
  deleteAsset(assetId: string): Promise<void>;

  // Webhook trust
  verifyWebhook(rawBody: string, headers: Record<string, string>): void; // throws on bad signature
  parseWebhook(rawBody: string): { type: string; assetId?: string; uploadId?: string;
                                  playbackId?: string; durationSeconds?: number; isError?: boolean };
}
```

Explicitly **not** abstracted (would be speculative): list/search assets, update metadata, DRM, captions management UI, analytics APIs, static renditions, MP4 support.

### Operation mapping

| Existing Mux operation | Abstraction method | Bunny equivalent (conceptual) |
|---|---|---|
| `video.uploads.create` (direct upload, signed policy) | `createDirectUpload` | Create video GUID → obtain upload endpoint. ⚠️ CONFIRM direct-browser-PUT CORS support & resumable (TUS) option |
| `video.assets.create({input:[{url}]})` | `createAssetFromUrl` | Create video + trigger fetch from Zoom download URL. ⚠️ CONFIRM fetch-from-URL capability |
| `video.assets.retrieve` (ready backfill) | `getAssetStatus` | Get video (status/length). ⚠️ CONFIRM status vocabulary + duration units |
| `stream.mux.com/{pb}.m3u8?token=JWT` (RS256, 60s) | `getPlaybackUrls.url` | HLS playlist URL for GUID with token-auth query/signature; **expiry must be hours** (BUN-SEC-1). ⚠️ CONFIRM token scheme + whether manifests embed segment tokens |
| `image.mux.com/{pb}/thumbnail.jpg?token=` | `getPlaybackUrls.thumbnail` | Thumbnail/preview frame URL. ⚠️ CONFIRM generation + signing |
| `video.assets.delete` (404 tolerated) | `deleteAsset` | Delete video; treat already-deleted as success |
| HMAC verify `mux-signature` | `verifyWebhook` | Bunny webhook signature scheme. ⚠️ CONFIRM existence/shape of signatures & event catalogue |

---

## 11. Bunny Architecture Evaluation

| Criterion | Option A — Bunny Stream | Option B — Storage + CDN + own transcode | Option C — Hybrid |
|---|---|---|---|
| Storage | Managed by Stream | Own buckets, own lifecycle | Mixed |
| Transcoding / HLS packaging / ABR | Managed ⚠️ CONFIRM ladder presets match mobile-India audience | We own ffmpeg ladders, packaging, keyframes — full VOD engineering effort | Partially owned |
| CDN / bandwidth | Included per Stream pricing model ⚠️ CONFIRM | Separate CDN pricing | Mixed |
| Signed playback / token auth | Built-in token auth ⚠️ CONFIRM semantics (per-request?) | Must implement signing middleware ourselves | — |
| Upload API / resumable uploads | Stream upload API ⚠️ CONFIRM TUS/resumability + CORS | Own presigned multipart logic | — |
| Webhooks | ⚠️ CONFIRM event granularity vs our 4 required events | Self-generated (we control) | — |
| Thumbnails | Auto ⚠️ CONFIRM | Build sprite/poster extractor | — |
| Subtitles/captions | ⚠️ CONFIRM (current pipeline ingests Zoom MP4s with burned-in audio only; no caption workflow exists in repo → **not required today**) | Own | — |
| Deletion | API ⚠️ CONFIRM eventual-consistency window | Own | — |
| Operational complexity | Lowest | Highest (a transcoding pipeline is a product) | Medium-high |
| Migration complexity | Lowest — maps 1:1 onto the 6-operation abstraction | Highest — new failure domains in every lifecycle stage | High |

**Recommendation: Option A — Bunny Stream.** For an LMS whose requirements are: browser upload, Zoom pull-import, ABR HLS to mobile students, signed delivery, thumbnails, delete-with-retry — a managed stream service matches the existing six operations almost exactly, while Option B rebuilds Mux's value proposition internally (the very cost being escaped) and Option C inherits both complexities. All Stream-specific capabilities above are flagged for confirmation in Phase 7B spike #1.

---

## 12. Cost Model

**Current Mux cost:** ~₹12,000/month (user-provided figure; no billing data in repo).

**Metrics actually needed:**
1. Mux storage GB-month (by asset)
2. Mux delivery/egress GB-month
3. Encoding volume (minutes in / minutes out)
4. Number of recordings (repo: `SELECT count(*) FROM recordings`)
5. Average recording duration (repo: `avg(duration_seconds)` — populated only on asset.ready)
6. Average file size at ingest (not stored in repo — upload sizes never recorded)
7. Monthly video views (proxy in repo: `count(video_views)` per month; true plays need Mux dashboard)
8. Average watch duration (proxy in repo: `avg(watched_seconds)` in `video_progress`; true watched-minutes need player analytics)
9. Concurrent students (Redis session counts; not persisted)
10. Monthly egress GB (**not derivable in repo**)
11. Peak bandwidth (**not derivable in repo**)

**Repo analytics availability [VERIFIED]:** the analytics module does **not** touch `recordings`/`video_views`/`video_progress` at all. Available SQL proxies: items 4, 5, 7 (approximate), 8 (approximate). Items 1, 2, 3, 6, 10, 11 require a Mux dashboard/billing export. **Expected Bunny cost: NOT YET CALCULABLE** until (a) Mux export obtained, and (b) Bunny Stream pricing confirmed externally. Do not commit to savings figures before both exist.

---

## 13. Migration Strategy (blueprint)

Target architecture:

```
                    LMS (NestJS)
                        │
                 VideoProvider (interface, §10)
                   /                    \
             MuxProvider              BunnyProvider
                   \                    /
                  recordings (provider discriminator)
```

| Stage | Content | Exit criteria |
|---|---|---|
| 1. Abstraction | Extract `MuxProvider` from `MuxService` behind the interface; wire consumers (`RecordingsService`, `PlaybackGuardService`, both jobs, webhook controller) to a provider resolver keyed off `recordings.provider`. Behaviour byte-identical; Mux still serves 100% | All existing tests green; manual playback regression pass |
| 2. Schema prep | Additive migration (`provider` + generic ID columns + backfill + CHECK-constraint fix incl. canonical `'failed'`). No destructive changes | Backfill 100%; dual-read live |
| 3. New uploads → Bunny | Feature-flagged `VIDEO_PROVIDER_DEFAULT=bunny` for *new* uploads only (both browser and Zoom pipelines). Bunny webhook endpoint added alongside Mux's | First Bunny recording completes full lifecycle in staging, then production pilot |
| 4. Old recordings keep working | Untouched Mux rows continue via `provider='mux'` path. Zero action | Mux playback SLO unchanged |
| 5. Progressive backfill migration | Batch job: for each old recording → `createAssetFromUrl`? ⚠️ Mux source URLs are signed/expiring — actual re-source strategy must be designed (options: re-fetch from Zoom if still available; download from Mux renditions ⚠️ CONFIRM rendition access; or accept some recordings remain Mux-only permanently). Update row to `provider='bunny'` only after Bunny asset verified ready + playable | Each migrated recording individually verified (automated probe: fetch signed URL, assert manifest 200 + expected duration ±tolerance) |
| 6. Traffic switch | All reads route by `provider` column (already true after Stage 1). Mux kept warm for rollback | 100% new + migrated on Bunny |
| 7. Production soak | ≥2–4 weeks covering peak usage; watch delivery errors, buffer stalls (player telemetry via `playback_events`), webhook gaps | Error budgets met |
| 8. Remove Mux | Revoke Mux keys, drop `mux_*` columns, remove dependency, delete webhook config | Zero Mux references; costs stop |

No big-bang cutover exists in this plan; at every stage `provider` determines delivery, so partial states are fully functional.

---

## 14. Rollback Plan

- **Unit of rollback = one row.** Setting `recordings.provider='mux'` (and ensuring `mux_asset_id`/generic mirror intact) instantly restores Mux delivery — *provided the Mux asset was never deleted*.
- **Hard rule:** Stage 5's backfill must NOT delete Mux assets. Mux assets are deleted only in Stage 8 (or by the pre-existing admin-delete flow, which deletes whichever provider owns the row). This makes rollback data-preserving by construction.
- Data that must remain available for rollback:
  1. `mux_asset_id` + `mux_playback_id` mirrored into generic columns (never nulled during migration),
  2. `MUX_*` env credentials alive through soak,
  3. Mux webhook endpoint registered through soak,
  4. `@mux/mux-node` dependency until Stage 8.
- Rollback triggers (define now): Bunny delivery error rate > threshold, webhook-driven ready-state stall > X hours, token-auth mid-playback 403s observed in `playback_violations`/client telemetry.
- Rollback of *new* Bunny uploads (never existed on Mux): re-ingest to Mux via `createAssetFromUrl` requires a source file — therefore Stage-3 pilot should prefer content that also exists at its original source (Zoom) until confidence is established, OR accept that new-content rollback means re-upload. Document explicitly in runbook.

---

## 15. Test Plan (pre-implementation definition)

**Unit (Jest, follows `recording-cleanup.job.spec.ts` patterns):**
- Provider abstraction resolver (row.provider → correct implementation; default mux)
- MuxProvider: URL signing shape, expiry math, 404-tolerant delete, passthrough serialization
- BunnyProvider: token generation determinism/expiry ⚠️ against confirmed spec, status mapping (Bunny vocabulary → `processing|ready|failed`), delete tolerance
- Playback authorization: unchanged suite must stay green (it is provider-agnostic by construction)
- Status mapping incl. canonical `'failed'` fix; webhook parse/verify for both providers; failure/retry paths of cleanup job with each provider

**API E2E (supertest, mock external providers like ZoomService today):**
- upload → asset_created-equivalent → ready-equivalent → authorize → play → progress → complete
- unauthorized playback (403), expired token (401), cross-student token replay (403), cross-recording token replay (403), cross-batch direct request (403)
- delete happy-path + cleanup-pending retry path
- webhook: bad signature ignored-but-200, unknown type ignored, each handled event mutates correctly

**Browser (existing player QA script, both providers):**
- loads, starts playing, buffer grows monotonically (THE regression guard — see §16), quality switch up/down, seek backward/forward, pause/resume, progress persists across reload, completion marks `completed=true`, resume dialog appears mid-video
- mobile (Android Chrome primary audience) + desktop; no console errors; exactly one `Hls` instance per mount (assert via `window` counter in dev test build)

**Migration tests:**
- Mux row plays unchanged after deploy (Stage 1/2)
- Bunny row plays (Stage 3+)
- `provider` flip mux→bunny and bunny→mux both deliver (rollback proof)
- migrated row accessible across the flip with same `recordingId` (progress history continuity)

---

## 16. Special Regression Check — HLS Lifecycle Fix (must be preserved)

The fixed bug chain was: `prefs` object in the HLS effect deps → effect rerun on every pref write → `hls.destroy()` → MediaSource reset → buffer zeroed. Current code is protected by three mechanisms, all verified present (`video-player-client.tsx`):

1. Effect deps are `[playbackUrl, updateLevels, handleLevelChanged]` where the latter two are zero-dep stable callbacks — effect runs **only when `playbackUrl` changes** (:287).
2. Preferences apply through a separate effect keyed on `[playbackUrl]` with a `prefsApplied` ref guard (:97-115).
3. Quality persistence writes go through stable setters (`saveQuality` etc.), never touching the effect inputs.

**Migration rule:** Bunny integration changes only the *string* passed as `playbackUrl`. Any Phase 7B PR that edits the dependency array, introduces a derived/recreated `playbackUrl` (e.g., rebuilding the URL in render), or moves HLS setup into a component that remounts more often than the recording page **fails review automatically**. The §15 browser test asserting monotonic buffer growth on quality/speed/volume changes is the executable guard.

---

## 17. Explicit Non-Goals This Phase

No code modifications · no migrations · no Mux deletion · no Bunny credentials · no production config changes · no player rewrite · no UI redesign · no unrelated refactoring · no changes to recording access control. *(This document only.)*

---

## 18–19. Findings Consolidated

### Risk Register

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| R1 | P1 | Webhook parity unknown for all 4 lifecycle-controlling events; current pipeline has zero missed-webhook tolerance | §8; no sweeper exists |
| R2 | **P0** | 60s delivery-token model likely unreplicable on Bunny (per-request enforcement ⇒ mid-playback death). Requires Bunny-token-outlives-session redesign with tightness moved to LMS layer | §5/§7 BUN-SEC-1 |
| R3 | P1 | `video.asset.errored` writes `status='error'`; CHECK allows only `processing|ready|failed` ⇒ silent constraint failure, recording stuck in `processing`; webhook swallows the error and returns 200 | `mux.controller.ts:145-147` vs `schema.sql:355` |
| R4 | P2 | Cost inputs missing (storage/delivery GB, encoding minutes); analytics module ignores video tables | §12 |
| R5 | P2 | Old-Mux-recording re-sourcing strategy for Stage 5 undefined (signed/expiry-prone source URLs) | §13 Stage 5 |
| R6 | P2 | `cors_origin:'*'` on draft-upload flow | `mux.service.ts:113` |
| R7 | P2 | `sendBeacon` unload-progress posts to frontend origin without auth header — dead code path | `video-player-client.tsx:340-350` |
| R8 | P2 | upload_queue failures never retried (`attempts` unused) — will bite identically for Bunny imports | `recording-upload.job.ts:135-143` |
| R9 | P3 | Dead code: `modules/videos/*` unregistered; `@mux/mux-player-react` unused; stale CLAUDE.md player references; `deviceId` pinning dormant | §2.1, §7 |
| R10 | P2 | `fetchMyRecordingsGrouped` exposes `muxPlaybackId` to clients (unusable while signed-only, but leaks IDs; revisit when Bunny GUIDs may be less secret) | `recordings.service.ts:1098` |

### Files Expected To Change (Phase 7B only — not now)

```
apps/api/src/modules/video-provider/            NEW: interface + resolver (+ spec)
apps/api/src/modules/mux/                       refactor to MuxProvider impl
apps/api/src/modules/bunny/                     NEW: BunnyProvider + webhook controller (+ spec)
apps/api/src/modules/recordings/recordings.service.ts   provider resolution at call sites
apps/api/src/modules/playback/playback-guard.service.ts swap MuxService → VideoProvider.getPlaybackUrls
apps/api/src/jobs/recording-upload.job.ts       provider-aware import
apps/api/src/jobs/recording-cleanup.job.ts      provider-aware delete
apps/api/src/app.module.ts                      register new module/jobs
scripts/migrations/0XX-provider-columns.sql     additive (Stage 2)
.env.example                                    BUNNY_* keys (Stage 3)
docs/CLAUDE.md-adjacent docs                    stale Mux player references
apps/web/package.json                           remove @mux/mux-player-react (optional P3, isolated PR)
```

### Files That Must NOT Change

```
apps/web/src/app/student/videos/[recordingId]/video-player-client.tsx   (except nothing; §16 rules)
apps/web/src/hooks/usePlaybackToken.ts / usePlayerPreferences.ts
apps/web/src/components/player/*                         (VideoControls, QualityMenu, MiniPlayer, …)
apps/api/src/modules/recordings/ validateAccess + batch/curriculum transaction logic
apps/api/src/modules/recordings/reconciliation/*
Zoom webhook handler + upload_queue semantics
Global guard/filter/interceptor wiring; response envelope; @Public webhook patterns
```

### Phase 7B Implementation Plan (sequenced)

1. Spike (read-only, external): confirm Bunny Stream webhook catalogue + signature scheme, token-auth enforcement model, direct-upload/CORS/TUS, fetch-from-URL, thumbnail signing, status/duration payloads, deletion semantics. Output: filled-in "CONFIRM" boxes in this document.
2. Cost data pull: Mux billing export + SQL proxy queries (§12).
3. Stage 1 abstraction refactor (behind tests).
4. Stage 2 additive migration + constraint fix (includes R3 fix decision).
5. Stages 3–7 per §13 with rollback triggers armed.
6. Stage 8 decommission checklist.

### Production Migration Checklist (condensed)

☐ Spike confirmations recorded ☐ Mux billing export archived ☐ provider columns backfilled ☐ R3 fixed ☐ dual-provider E2E green ☐ buffer-regression browser test green on Bunny ☐ cross-student/cross-batch 403 tests green on Bunny ☐ rollback drill executed (flip one row both directions) ☐ webhook sweeper deployed ☐ soak error budget met ☐ Mux assets retained until Stage 8 sign-off.

---

## Final Recommendation

**RCCF Decision**

- **Migration readiness: 74/100**
  Strong (+): single-service Mux chokepoint · provider-blind player · provider-blind authorization · near-neutral schema · mature delete/cleanup retry machinery · existing test culture.
  Missing (−): zero Bunny facts verified (webhooks/token model decisive) · token-lifetime architecture conflict (R2) · latent errored-status bug (R3) · no cost data (R4) · Stage-5 re-sourcing strategy open (R5) · abstraction not yet extracted.
- **Recommendation: CONDITIONAL GO**
  Proceed to Phase 7B **only after** the read-only spike resolves R1 and R2 (webhook catalogue + token enforcement model). If Bunny Stream cannot emit encode-complete/failure webhooks or cannot sign long-lived session tokens, fall back to polling-based status or re-evaluate providers before writing code.
- **P0 blockers:** R2 (delivery-token lifetime semantics — must be resolved by confirmation or design change before Stage 3).
- **P1 risks:** R1 (webhook parity), R3 (status-constraint bug — fix lands in Stage 2 regardless), plus rollback-data discipline (§14) enforced as process.
- **Exact next phase:** Phase 7B Step 1 — external Bunny capability spike (no code), followed by Stage 1 abstraction refactor.
- **Exact files expected to change:** see §Files Expected To Change.
- **Database migration required?** Yes — small additive migration (provider discriminator + generic ID columns + CHECK fix) in Stage 2; destructive drops deferred to Stage 8.
- **Frontend player changes required?** Functionally **none** (contract `{url, thumbnail, sessionId}` preserved); optional P3 dependency/doc cleanup in an isolated PR.
- **Dual-provider support required?** Yes — per-row `provider` routing is the core mechanism enabling staged migration and instant rollback; retire Mux only at Stage 8.

*STOP — audit complete. No Phase 7B implementation performed.*
