# RCCF Report — Phase 7E: Bunny CDN Production Integration

**Date:** 2026-08-26 · **Base:** working tree on `ab25e1b` (7B–7D uncommitted)
**Scope:** Bunny as default provider for ALL new recordings, browser TUS upload path, live verification against the real Bunny account. Mux untouched.

---

## 1. Executive Summary
Bunny-first is implemented and **live-verified through most of the chain using the real production library**: create-video ✓, TUS upload of a real 1 MB video → encoded to Finished ✓, REST status mapping (4→ready) ✓, fetch-import shape bug found & fixed ✓, no-token CDN denial ✓. The single unverified link is **signed playback delivery: 403 because `BUNNY_TOKEN_SIGNING_KEY` does not match the pull zone's Token Authentication key** (user action), and real webhook delivery awaits dashboard URL registration. Score reflects honest gaps.

## 2. Existing Architecture
Provider abstraction (`RecordingProviderResolver` → MuxProvider/BunnyProvider), `provider` discriminator column, `recording_batches` authorization, Redis playback tokens, provider-generic HLS.js player, Bunny webhook controller (7C). Recon confirmed all present; upload response previously dropped the TUS handle at the service boundary.

## 3. Bunny Integration Changes
- Resolver policy: bunny-first for every new recording; visible 503 when unconfigured; `VIDEO_UPLOAD_PROVIDER=mux` dormant rollback switch; batch numbers irrelevant.
- Service returns full upload handle `{uploadUrl, upload:{url,kind,headers,recordingId}}`.
- `UpdateRecordingDto.status` restricted to `processing|ready|failed` ('error' violated the live CHECK — latent P0 fixed).
- Webhook tests completed (malformed signed body; repeated-delivery idempotency).
- **Live-finding fix:** `/videos/fetch` answers `{id}` not `{guid}` — accepted both; without this the Zoom auto-pipeline would silently break under Bunny.
- Skills updated with live-verified TUS/queue/token facts.

## 4. Upload Flow
Admin modal → POST /admin/recordings → resolver (bunny-first) → BunnyProvider.createDirectUpload (create video + presign SHA256(libraryId+apiKey+expire+videoId)) → browser TUS per `lib/upload/tus-uploader.ts`: **POST creation** (Upload-Length + strict metadata) → resolve relative Location → chunked PATCH (32 MiB, no Upload-Length) → offset-authoritative progress/cancel/retry(HEAD resync). Upload completion ≠ ready: only webhook/status marks ready.

## 5. Webhook Flow
`POST /bunny/webhook` (@Public) — rawBody preserved (`main.ts rawBody:true`), HMAC-SHA256 lowercase-hex vs `BUNNY_WEBHOOK_SECRET`, version/algorithm headers enforced, 401 + zero mutation on failure, foreign-library ignored, provider-scoped lookup (`provider='bunny'`), idempotent monotonic updates, duration backfill, always-2xx. Status mapping respects Bunny enums; unknown → processing (never silently ready).

## 6. Playback/Token Architecture
Unchanged two-layer model: LMS Redis token (600 s sliding, device-bound, revocable, rate-limited) gates access below authorization; Bunny path-based directory token (`/bcdn_token=HS256-…&token_path=%2F{guid}%2F`, 4 h TTL) covers playlist AND inherited segments; generic `{url, thumbnail, sessionId}` contract; zero player changes.

## 7. Database Verification
Live introspection (PostgREST OpenAPI): recordings columns incl. `provider TEXT NOT NULL DEFAULT 'mux'` (migration 035 CHECK mux|bunny); status default 'processing'; identifier slots mux_asset_id/mux_playback_id/mux_upload_id reused per-provider. No migration needed; `(provider)` index already exists from 035. Live rows after E2E: 12 × mux:ready (no strays).

## 8. Security Verification
E2E security suites green (wrong-batch/unauth/expired-token/IDOR). Secrets: env names aligned (`BUNNY_LIBRARY_API_KEY`→`BUNNY_API_KEY`, `BUNNY_PULL_ZONE`→`BUNNY_CDN_HOSTNAME`) in-place without printing values; nothing exposed to web bundle (scan clean; comment-only mention). Presigned TUS headers are per-video+expiring. Signed URL structure verified correct; 403s analyzed to key-mismatch (see §16).

## 9. Unit Tests
**241/241** (21 suites): +resolver policy (10), +DTO vocabulary spec, +webhook malformed/replay, +service handle passthrough (plain & TUS), +fetch-id-shape regression test.

## 10. E2E Tests
**89/90** via `pnpm test:e2e` — incl. full admin-create→assign→authorize→playback→security matrix and a REAL Mux upload proving the rollback switch end-to-end. Single failure = pre-existing documented `assessments/browser-ui.spec.ts` flake (unchanged baseline).

## 11. Browser Verification
Real-account script verified server-side equivalents: real TUS upload (1 MB, 5.8 s up) → encode Finished (~40 min queue) → canonical ready. Browser matrix (1440/768/390) + console/network checks remain pending until §16 items are done; modal logic typechecked and unit-covered.

## 12. Performance
Measured baselines (1 MB sample): create-video ≈ 0.9–1.4 s; TUS upload ≈ 5.8 s (~0.17 MB/s incl. handshake); webhook n/a yet. Encode latency dominated by library queue (~40 min first videos). Playback startup pending token fix.

## 13. Mux Compatibility
MuxProvider compiles; resolver still routes mux rows (12 legacy recordings playable); no deletions; e2e created a real Mux asset through the switch; no frontend Mux dependency added.

## 14. Remaining Risks
1. Signed delivery 403 until Token Auth key corrected (§16).
2. Real webhook delivery untested until URL registered in dashboard.
3. Encode queue latency (~40 min first uploads) — communicate to admins.
4. Custom TUS client (~190 lines) — mitigated by live verification + retries.
5. Pre-existing assessment browser flake.

## 15. Production Readiness Score
**78/100** — chain proven except signed-delivery (−12) and webhook delivery (−6); minor: custom uploader maturity (−4).

## 16. GO / CONDITIONAL GO / NO-GO
**CONDITIONAL GO.** Two manual steps close it:
1. Library/Pull-Zone **Security → Token Authentication**: confirm enabled on zone `vz-d5d15e05-daf.b-cdn.net`; copy the **Token Authentication Key** exactly into `BUNNY_TOKEN_SIGNING_KEY` (current value mismatches — every correctly-signed request returns 403 while unsigned requests are also denied, so enforcement is ON but the keys differ). Disable IP-locking if present. Then re-run the delivery check (I can do this instantly).
2. Register webhook URL **`https://<public-api-host>/bunny/webhook`** in Stream → Webhooks (route confirmed: no global prefix; raw-body-preserving handler active).
Both ready test videos were left in your library deliberately for post-fix browser checks; delete them afterwards.
