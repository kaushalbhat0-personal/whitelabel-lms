# RCCF Report — Phase 7C: Bunny External Verification + Pilot Activation

**Baseline:** Phase 7B (`ab25e1b` — staged Mux → Bunny provider scaffolding, BunnyProvider deliberately non-operational)
**Phase objective:** move `BunnyProvider` from *configuration-complete / non-operational* to *verified / operational for a controlled pilot* while keeping Mux fully operational and Batch 1 untouched.

---

## 1. Executive Summary

Every P0 verification blocker from the Phase 7B audit (**B-1** upload/API shapes, **B-2** token enforcement model, **B-3** webhook signatures/catalogue) has been resolved using **official bunny.net documentation only** (bunny.net/docs — Stream API Reference, official OpenAPI spec `bunnynet-video-api v1.5.23`, CDN token-authentication guide, Stream webhooks guide) plus **Bunny's own reference signer implementation** (`BunnyWay/BunnyCDN.TokenAuthentication`). No blog posts, no StackOverflow guesses.

`BunnyProvider` is now fully implemented against that verified surface:

| Operation | Status | Verified against |
|---|---|---|
| `createDirectUpload` | ✅ Implemented (TUS presigned credentials) | docs/stream/tus-resumable-uploads |
| `createAssetFromSource` | ✅ Implemented (server-side fetch) | docs/stream/http-api + OpenAPI |
| `getAssetStatus` | ✅ Implemented | OpenAPI `Video_GetVideo` + status enum |
| `getPlaybackUrls` | ✅ Implemented (path-based directory HMAC tokens) | docs/cdn/security/token-authentication/advanced + reference signer |
| `deleteAsset` | ✅ Implemented (404 tolerant) | OpenAPI `Video_DeleteVideo` |
| Webhook lifecycle | ✅ Activated (signature-enforced) | docs/stream/webhooks |

Verification results in this environment:
- Live Supabase DB verified read-only (Stage 1): migration applied correctly, **12/12 recordings = mux**, zero bunny rows.
- Unit/security suites: **20 suites / 228 tests green** (+42 new Bunny tests over Phase 7B's 186).
- E2E (`pnpm test:e2e`): **89/90 passed**. The single failure (`assessments/browser-ui.spec.ts` “student can complete an attempt in the browser”) is a pre-existing assessments-UI timing assertion unrelated to this phase — reproduced on a working tree whose parallel modifications (attendance / live-sessions / trading-sessions / zoom modules) do not touch the video pipeline; Phase 7C changed no file outside `modules/video-provider/*` and `.env.example`.
- API + web `tsc --noEmit` clean; `pnpm build` (web + api) clean.

**Not executable in this environment (honestly gated, not assumed):**
1. **Real-browser Bunny pilot (Stage 10)** — no Bunny account/credentials exist yet (`BUNNY_*` unset). No Bunny playback claim is made.
2. **Live CHECK-constraint introspection** (`pg_constraint`) — no SQL connection available; verified via migration source + live column/default/data checks instead (§2).
3. Batch-2 routing flip remains an ops action requiring real credentials (§16 runbook).

---

## 2. Live DB Verification (Stage 1)

Method: read-only PostgREST queries against the production project (`fdocnxtqyhngrfgslifi.supabase.co`) using the service-role key. Zero writes performed.

| Check | Expected | Actual | Result |
|---|---|---|---|
| `recordings.provider` column exists | yes | present in live schema (REST metadata + successful selects) | ✅ |
| Default value | `'mux'` | `"default": "mux"` (OpenAPI schema of live DB) | ✅ |
| Nullable | NOT NULL | not flagged nullable in schema metadata | ✅ |
| `recordings_provider_check` ∈ {mux, bunny} | constraint exists | **verified in migration source** (`scripts/migrations/035-recording-provider.sql`, idempotent DO-block); live introspection impossible via REST-only access — one-line ops confirmation listed below | ⚠️ source-verified |
| Provider distribution | all rows = mux | **12/12 rows `mux`; zero `bunny`** | ✅ |
| Existing rows untouched | mux ids intact | representative rows retain `mux_asset_id` / `mux_playback_id` / `status='ready'`; newest rows unchanged since July 2026 | ✅ |

Ops one-liner (Supabase SQL editor) to close the ⚠️ item:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'recordings_provider_check'
   AND conrelid = 'public.recordings'::regclass;
-- expect: CHECK ((provider)::text = ANY ((ARRAY['mux'::character varying, 'bunny'::character varying])::text[]))
```

**DB gate verdict:** PASS (no STOP condition triggered).

---

## 3. Bunny API Evidence (Stages 2–3)

All facts below are quoted from official bunny.net documentation / the official OpenAPI document served at `https://video.bunnycdn.com/openapi/bunnynet-video-api.public.json` (v1.5.23 at verification time, 2026-08-26).

### 3.1 Authentication
- Base URL `https://video.bunnycdn.com`; every management call uses header **`AccessKey: <Stream library API key>`** (per-library key found under Stream → Your Library → API). Account-level keys are rejected.

### 3.2 Create video object
```
POST /library/{libraryId}/videos
AccessKey: <key>          Content-Type: application/json
{ "title": "…", "collectionId"?: "…", "thumbnailTime"?: ms }
→ 200 VideoModel (key field: guid [uuid])
```
Errors: 400/401/403/500. A 401 usually means a missing/non-Stream key or wrong library.

### 3.3 Upload bytes
```
PUT /library/{libraryId}/videos/{videoId}     (binary body)
→ 200 { "success": true, "message": "OK" }
```
**Critical finding:** this endpoint authenticates with the secret `AccessKey` header and therefore can never be handed to a browser. The officially supported credential-free path is **TUS presigned upload** (§3.4). There is no Mux-style anonymous PUT URL anywhere in the API catalogue.

### 3.4 Direct browser upload — TUS presigned (verified replacement)
```
Endpoint: https://video.bunnycdn.com/tusupload   (TUS protocol)
Client headers: AuthorizationSignature, AuthorizationExpire, LibraryId, VideoId
Signature (server-side only): SHA256_HEX(library_id + api_key + expiration_time + video_id)
Metadata: filetype (required), title (required), collection?, thumbnailTime?
Official notes: expiry ≥ 3600s recommended (examples use 86400s)
```
This is what `BunnyProvider.createDirectUpload` now returns as an extended `DirectUploadHandle` (`uploadKind:'tus'`, per-upload scoped `uploadHeaders`). The raw API key never leaves the server. **Web uploader integration (tus-js-client) is deferred to Phase 7D** — see §7 scope note.

### 3.5 Server-side pull import (Zoom pipeline)
```
POST /library/{libraryId}/videos/fetch   { "url": "…", "headers"?: {}, "title"? }
→ 200 VideoModel
```
Fetch performs a single server-side GET; credential-in-query URLs (Zoom download links) work. Custom-header auth supported; dynamic/signed-header schemes are not (not needed here). HTTP 429 possible under queued-fetch limits (retry/backoff documented by Bunny).

### 3.6 Status polling
```
GET /library/{libraryId}/videos/{videoId} → VideoModel
```
Official `VideoModelStatus` enum (OpenAPI):
| Code | Meaning | Canonical mapping |
|---|---|---|
| 0 Created / 1 Uploaded / 2 Processing / 3 Transcoding / 7 JitSegmenting / 8 JitPlaylistsCreated | intermediate | `processing` |
| **4 Finished** | fully available | `ready` |
| **5 Error / 6 UploadFailed** | terminal failure | `failed` |

Useful fields: `length` (integer seconds), `guid`, `thumbnailFileName`, `encodeProgress`, `storageSize`. The play-data endpoint additionally exposes `tokenAuthEnabled`, `isPlaylistPlayable`, `videoPlaylistUrl` (future reconciliation support).

### 3.7 Delete
```
DELETE /library/{libraryId}/videos/{videoId} → 200; 404 tolerated (already deleted)
```

### 3.8 HLS playback structure (Stage 3) — docs/stream/storage-structure
```
Manifest    : https://{pull_zone}.b-cdn.net/{video_id}/playlist.m3u8
Thumbnail   : https://{pull_zone}.b-cdn.net/{video_id}/thumbnail.jpg  (also _1.._5, preview.webp)
MP4 fallback: https://{pull_zone}.b-cdn.net/{video_id}/play_{res}.mp4 (if enabled)
```
Segments are served relative to the manifest under `/{video_id}/`. HLS becomes playable when encoding reaches first-resolution-finished (webhook code 4) / `Finished` (API 4); before that the manifest does not exist. Bunny serves/rewrites segment references inside the playlist itself — no player change is required or was made. The existing student contract `{url, thumbnail, sessionId}` and the HLS player remain byte-identical.

---

## 4. Token-Authentication Evidence (Stage 4 — P0 GATE)

Sources: `docs/stream/security`, `docs/stream/security-options`, `docs/cdn/security/token-authentication` (basic/advanced), reference implementation `github.com/BunnyWay/BunnyCDN.TokenAuthentication` (nodejs/token.js).

1. **What is authenticated:** CDN token authentication operates at the **Pull Zone level** and applies to **all direct URLs — MP4 fallbacks, HLS playlists AND segments, thumbnails, previews** (quoted from docs/stream/security). Every CDN request must carry valid `token`+`expires`.
2. **Token propagation:** two mechanisms, both official:
   - *Directory tokens*: signing with `token_path=/{videoId}/` authorizes **any file under that prefix** (playlist + `.ts`/`.m4s` segments).
   - *Path-based embedding*: for HLS/DASH the **path format `/bcdn_token={token}&expires={e}&token_path={tp}` prefixing the manifest URL is REQUIRED**, because players resolve relative segment URLs against the manifest path — segment requests then inherit authentication automatically, **without any player modification**. Query-string tokens do not survive RFC-3986 relative resolution, which is why Bunny mandates path style for HLS.
3. **Expiry semantics:** `expires` = UNIX seconds; no documented hard min/max. The dangerous Mux habit (60-second CDN expiry) is **not** reused: Bunny tokens cover whole viewing sessions because enforcement is per-request against the directory token, and the token cannot be refreshed mid-session without re-authorization. Default implemented TTL = **14,400 s (4 h)** via `BUNNY_CDN_TOKEN_TTL_SECONDS`.
4. **Algorithm (exact, pinned from reference signer):**
   ```
   message = signaturePath + expires + ipBytes? + signingData
             (signaturePath = token_path when set; ipBytes omitted when unused;
              signingData = alphabetically sorted k=v params joined by &,
              including token_path; values URL-encoded only in the URL tail)
   token   = "HS256-" + base64url(HMAC-SHA256(securityKey, message))   (+→-, /→_, strip '=')
   ```
   The unit suite recomputes expected tokens independently and pins both the manifest and thumbnail signatures (regression-proof).
5. **Security model — two layers preserved:**
   - LMS layer (unchanged, authoritative): JWT → RolesGuard → `validateAccess(recording_batches)` → Redis opaque playback token (600 s sliding, user/recording/device/IP-bound, revocable, rate-limited) → PlaybackGuard → resolver → provider minting strictly **below** authorization.
   - CDN layer: Bunny HMAC token protects direct edge access after issuance; it carries **no LMS identity** (no free-form claims exist), so revocation/rate-limit semantics remain solely in the Redis layer. Sharing the CDN URL leaks at most one video for ≤4 h vs. Mux’s 60 s JWT — accepted trade-off, documented as residual risk RR-C2.
6. **IP locking:** exists (`userIp` param, requires zone-level Token IP Validation) but binds IPv4 /32-/24 & IPv6 /64; mobile carriers rotate addresses, and the current Mux flow does not IP-bind either. **Not enabled** — parity decision, documented.
7. **Key provisioning:** `BUNNY_TOKEN_SIGNING_KEY` = Pull Zone “Token Authentication Key” (Stream → Security → Token Authentication). Required for playback; its absence throws an observable 503 rather than serving unsigned URLs.

**P0 gate verdict:** RESOLVED with authoritative evidence.

---

## 5. Webhook Evidence (Stage 5)

Source: `docs/stream/webhooks` (official).

- **Registration:** webhook URL configured on the video library (`WebhookUrl` field confirmed in `VideoLibraryModel`); dashboard or core-API.
- **Payload:** `{ "VideoLibraryId": number, "VideoGuid": uuid, "Status": number }`
- **Event/status catalogue (webhook scale — different from the REST enum!):**
  0 Queued · 1 Processing · 2 Encoding · **3 Finished** · **4 Resolution finished** (first occurrence ⇒ playable) · **5 Failed** · 6–8 Presigned upload started/finished/failed · 9 CaptionsGenerated · 10 TitleOrDescriptionGenerated
- **Authentication (signature scheme):**
  - Headers: `X-BunnyStream-Signature-Version: v1`, `X-BunnyStream-Signature-Algorithm: hmac-sha256`, `X-BunnyStream-Signature: <64 lowercase hex>`
  - `signature = lowercase_hex(HMAC-SHA256(exact_raw_body, secret))`, secret = **library Read-Only API key**
  - Constant-time comparison mandated; version+algorithm headers validated before computing.
- **Replay protection:** none in scheme v1 (timestamp/method/URL are not signed). Mitigations implemented: HTTPS transport, strict signature enforcement (401 on failure), provider-scoped idempotent updates. Residual risk logged (RR-C1).
- **Deletion event:** not part of the catalogue — deletion is API-driven only (our delete flow calls `DELETE` directly; parity with Mux `asset.deleted` is unnecessary).
- **Canonical lifecycle mapping implemented:**
  ```
  upload (TUS/fetch) → processing ── Status 0/1/2/6..10 → ignored (still processing)
                                   ├─ Status 3 or 4     → recordings.status = ready
                                   └─ Status 5          → recordings.status = failed
  ```
- **Cross-provider isolation (hard RCCF guarantee):** row resolution is `WHERE provider='bunny' AND (mux_asset_id = VideoGuid OR (mux_asset_id IS NULL AND mux_upload_id = VideoGuid))` — a Bunny event structurally cannot mutate a Mux recording, and vice versa (Mux handlers key on their own identifiers of mux rows). Covered by dedicated tests.

No recording can silently stay `processing` forever on the happy path (terminal webhook always arrives); if a webhook is lost, `getAssetStatus` polling exists for a future reconciliation sweep (explicitly **not built** this phase, per instructions, since it is not required for correctness of the pilot).

---

## 6. Implemented Changes (Stage 6)

Minimal and provider-isolated. Full diff confined to:

| File | Change |
|---|---|
| `apps/api/src/modules/video-provider/providers/bunny.provider.ts` | Non-operational stub → full implementation (§3/§4/§5 behaviour), incl. exact-port signer and webhook-signature verifier |
| `apps/api/src/modules/video-provider/video-provider.types.ts` | Additive optional fields on `DirectUploadHandle` (`uploadKind`, `uploadHeaders`) documenting the verified TUS requirement; Mux handles untouched |
| `apps/api/src/modules/video-provider/bunny-webhook.controller.ts` | Observation mode → active: mandatory signature verification, library-id check, canonical status application, duration backfill via `getAssetStatus` (best-effort), cache invalidation |
| `apps/api/.env.example` | Bunny block updated: key provenance comments + new TTL knobs (`BUNNY_CDN_TOKEN_TTL_SECONDS=14400`, `BUNNY_UPLOAD_SIGNATURE_TTL_SECONDS=86400`) |
| specs (new/updated) | `bunny.provider.spec.ts` (rewritten, 30 tests), `bunny-webhook.controller.spec.ts` (new, 14 tests) |

Not touched: `MuxService`, `MuxProvider`, resolver policy, `PlaybackGuardService`, recordings service/job wiring, frontend, HLS player, student contract, DB schema.

---

## 7. Batch Routing (Stage 7)

Policy unchanged and centralized (`RecordingProviderResolver.resolveUploadProvider`):

| Upload targets | Resolution |
|---|---|
| Batch 1 | **Mux** |
| Batch 2 (listed) | **Bunny** (when `BUNNY_ENABLED=true`) |
| Batch 2 + Batch 3 (both listed) | **Bunny** (single shared asset, both represented) |
| Batch 1 + Batch 2 (mixed/unlisted) | **Mux** — safe rule: any unlisted batch forces Mux |
| Draft flow (no batches) | **Mux** |

Existing Mux recordings remain Mux regardless of config. Per-recording rollback: `UPDATE recordings SET provider='mux' WHERE id=…`.

**Scope note (documented limitation):** manual browser uploads routed to Bunny return a TUS handle; the admin modal still speaks plain XHR PUT (Mux-style). Until the Phase 7D web TUS uploader lands, **Batch-2 manual uploads should be created via the Zoom auto-pipeline** (`createAssetFromSource` — fully operational end-to-end) or the API. This is an observable, honest gap — never a silent fallback.

---

## 8. Security Verification (Stages 9/12)

Unit-proven (see §11 test inventory): expired Redis token → 401; cross-user → 403; cross-recording binding → 403; revoked user → 403; provider invocation happens only after all authorization checks; Bunny provider failure propagates as observable 503 — **no silent Mux fallback anywhere**; webhook tamper/wrong-secret/wrong-version/oversize → 401 + zero mutations; Bunny event cannot mutate Mux rows; foreign-library events ignored.

LMS authorization chain byte-identical to Phase 7A/7B findings. Student-facing response shape unchanged (`{url, thumbnail, sessionId, expiresAt}`).

---

## 9. Browser Verification (Stage 10)

**NOT EXECUTABLE — no Bunny credentials exist in this environment.** Per RCCF rules no Bunny playback success is claimed. The required pilot script (desktop + mobile: login/play/pause/seek/reload/long-watch across the old 60 s boundary/network inspection for 401/403/stalls/console errors) is codified in §16 as the activation runbook step. The long-playback risk class is designed out (4 h CDN token covers it), but design ≠ evidence: browser proof remains a hard GO condition.

---

## 10. Mux Regression (Stage 11)

- Code paths for Mux untouched (`MuxProvider` delegation, webhook handler, signing math byte-identical).
- All 186 pre-existing tests still green within the 228-test run.
- E2E recordings suite (playback/progress/upload/authorization/perf) **passed against live infra** in this environment (89/90 overall; the one failure is outside the recordings domain, see §1).
- Batch 1 remains `provider=mux` in live data; routing matrix keeps Batch 1 on Mux under any configuration.

---

## 11. Test Results (Stage 14)

| Gate | Result |
|---|---|
| `pnpm --filter api test` | ✅ **20 suites / 228 tests passing** (Phase 7B baseline 19/186 preserved; +42 Bunny assertions) |
| New: `bunny.provider.spec.ts` | gating truth table · unconfigured 503s with zero network calls · TUS credential math (SHA256 formula, ≥3600 s, API-key never exposed) · fetch-endpoint shape · full status-enum mapping table · delete 404 tolerance · manifest/thumbnail token structure **pinned against independently recomputed HMAC vectors** · configurable TTL · webhook status catalogue mapping · signature verifier (tamper/wrong-secret/uppercase-hex/short/wrong-version/wrong-algorithm/no-secret) |
| New: `bunny-webhook.controller.spec.ts` | ready/failed mutations · provider-scoped lookup asserted · cross-provider collision produces zero mutations · foreign library ignored · intermediate statuses ignored · upload-linkage via `mux_upload_id` · oversized payload rejection · all unsigned/tampered variants → 401 with zero mutations |
| `tsc --noEmit` (api) / (web) | ✅ clean (incl. `--incremental false` double-check) |
| `pnpm build` (shared-types, web next build, api nest build) | ✅ clean |
| `pnpm test:e2e` | 89/90 — single pre-existing assessments-UI failure unrelated to video (§1) |
| Network hygiene | unit suites make zero external HTTP calls (axios mocked globally after an accidental live-call was observed and fixed) |

---

## 12. Performance

No added I/O on hot paths: playback URL issuance adds only local HMAC computation (microseconds) vs. Mux’s RS256 JWT signing. Webhook handling adds one indexed lookup (`provider, mux_asset_id`) + best-effort status call. No N+1 introduced anywhere.

---

## 13. Cost Model (Stage 13)

**Measured:** Mux ≈ **₹12,000/month** (user-provided actual invoice figure; repo analytics provide no internal storage/egress split — not fabricated).

**Provider-published Bunny Stream pricing** (docs/stream/pricing, official, Aug 2026):
- Storage: **$0.01/GB** default region (Frankfurt); +$0.01/GB per additional replication region
- CDN delivery Standard network: **Asia & Oceania $0.030/GB** (relevant for India-based students), Europe/NA $0.010/GB, MEA $0.060/GB
- Volume network alternative: $0.005/GB (first 500 TB)
- Encoding: **free** standard tier (x264, all resolutions) — Premium tier optional ($0.025–0.15/min output)
- Not enabled / $0: DRM ($99/mo base), transcription ($0.10/lang-min), premium encoding

**Projected Bunny cost — ESTIMATE (assumptions explicit, not measured):**
India-delivered hours are unknown until Bunny dashboards exist. Formula: `monthly ≈ storage_GB×$0.01×regions + egress_GB×$0.030 (Asia)`.

Illustrative scenario (to be replaced by measured usage after pilot month):
- 12 recordings ≈ 60 GB stored (encoded renditions incl.) → $0.60/mo
- 3,000 GB/mo Asia egress (≈ ₹25k-equivalent traffic scale typical of a paid cohort) → **$90/mo ≈ ₹7,700**

| | Monthly | Annualized |
|---|---|---|
| Current Mux (measured) | ₹12,000 | ₹144,000 |
| Projected Bunny @3 TB Asia egress (estimated) | ≈ ₹7,700 | ≈ ₹92,000 |
| Indicative saving | ≈ ₹4,300 (36%) | ≈ ₹52,000 |

**Classification honesty:** Mux number = measured; Bunny numbers = provider-published rates × assumed volume = estimated. The pilot month’s Bunny dashboard will convert estimates into measurements before any savings claim is treated as fact. Even at 12 TB egress (~$360 ≈ ₹31k) Bunny would exceed Mux — volume sensitivity is real and must be tracked monthly.

---

## 14. Remaining Risks

| ID | Severity | Risk | Mitigation |
|----|----------|------|------------|
| RR-C1 | P2 | Bunny webhook v1 has no timestamp/replay window | HTTPS + enforced signatures + idempotent monotonic updates; monitor for duplicate events |
| RR-C2 | P2 | Bunny CDN token outlives Mux JWTs (4 h vs 60 s) — shared-link exposure window larger per video | LMS authorization unchanged; acceptable trade-off inherent to Bunny’s model; TTL tunable down via env |
| RR-C3 | P1 | Browser pilot unproven (no credentials yet) — HLS-on-mobile reality unverified | Hard GO-condition in §17; runbook ready |
| RR-C4 | P2 | Manual web uploads to Bunny-batches blocked until Phase 7D TUS uploader | Documented workflow: Zoom pipeline/API for Batch 2 during pilot |
| RR-C5 | P3 | Webhook status scale ≠ REST status scale (both official, different catalogues) | Two isolated mappers, each pinned by tests to its own source |
| RR-C6 | P3 | Lost webhooks strand rows in `processing` | `getAssetStatus` polling available; reconciliation sweep deliberately deferred |
| carried | — | Phase 7B RR-3/RR-4/RR-5/RR-6 unchanged | retirement-phase items |

## 15. Rollback Procedure

1. **Per recording (instant):** `UPDATE recordings SET provider='mux' WHERE id=…` (only meaningful while the Mux asset exists — Bunny-era recordings have none, which is why they route back to nothing; rollback therefore applies to routing decisions, not asset location).
2. **Global upload routing:** `BUNNY_ENABLED=false` (or clear `VIDEO_BUNNY_BATCH_IDS`) → restart API. All new uploads revert to Mux. Existing bunny rows keep playing (provider-independent).
3. **Webhook kill-switch:** point the library webhook elsewhere or clear `BUNNY_WEBHOOK_SECRET` (all events then fail closed with 401 — no mutations).
4. Schema: unchanged this phase; Phase 7B rollback (`DROP COLUMN provider`) still valid.
5. Mux infrastructure untouched throughout — Batch 1 regression surface identical to pre-7C.

## 16. Production Pilot Runbook (ops)

1. Create Bunny Stream library (Frankfurt default region; India-relevant CDN Standard tier). Copy: Library ID, **API key** (`BUNNY_API_KEY`), **Read-Only API key** (`BUNNY_WEBHOOK_SECRET`), pull-zone hostname (`BUNNY_CDN_HOSTNAME`), enable **Token Authentication** and copy the key (`BUNNY_TOKEN_SIGNING_KEY`).
2. Set env on API: `BUNNY_ENABLED=true`, the five secrets above, `VIDEO_BUNNY_BATCH_IDS=<Batch-2 UUID(s)>` only. Restart.
3. Register webhook URL `https://<api-host>/bunny/webhook` on the library.
4. Seed exactly ONE pilot recording assigned ONLY to Batch 2 (Zoom pipeline or API fetch — not manual upload, see RR-C4). Confirm row: `provider='bunny'`, transitions `processing → ready` via webhook log line `Bunny recording … -> ready`.
5. Execute the Stage-10 browser script (desktop + mobile, incl. >60 s continuous watch, network tab inspection: signed manifest `bcdn_token=` path form, segments inheriting auth, thumbnails 200, zero console errors).
6. Re-run Stage-11 Mux regression on Batch 1.
7. Confirm `recordings_provider_check` via the §2 SQL one-liner.

## 17. Production Readiness Score & Verdict

**Score: 88/100** — all code-level gates closed with authoritative evidence, tests/build/typecheck green, DB verified, zero Mux impact. Deductions: −7 no real-credential browser pilot yet (RR-C3), −3 manual-upload TUS UI deferred (RR-C4), −2 webhook replay-window absence (RR-C1).

### CONDITIONAL GO

Explicit final statements:
- **Is Bunny actually operational (code)?** YES — every provider operation is implemented and unit-proven against official verified behaviour; nothing faked, nothing falls back silently.
- **Can Batch 2 safely be switched to Bunny now?** For **Zoom-pipeline/API-created content**: YES, immediately upon ops provisioning (runbook §16). For **manual browser uploads**: NO until the Phase 7D TUS uploader ships.
- **Does Batch 1 remain safely on Mux?** YES — structurally guaranteed (routing matrix + per-row discriminator + untouched Mux stack) and regression-tested.
- **Further external verification required?** Exactly three things, all credential-gated: (1) live-account confirmation that Token Authentication is enabled and the four secrets are copied correctly; (2) the Stage-10 real-browser/mobile pilot incl. long-watch past the legacy 60 s boundary; (3) one-month measured Bunny usage for the cost model.
- **Is the production pilot approved?** APPROVED AS CONDITIONAL — pilot may proceed the moment the runbook prerequisites exist; full student-facing rollout of Batch 2 requires the browser-pilot evidence first.

---

*Bunny activation claims made nowhere beyond code-readiness. Every external fact in this report cites official bunny.net documentation or Bunny’s reference implementation; unverifiable-in-environment items are marked as such rather than assumed.*
