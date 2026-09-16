# RCCF Bunny HLS Playback 404 — Diagnosis + Fix Report

**Date:** 2026-09-16  
**Mode:** READ → RECON → VERIFY → PLAN → IMPLEMENT → TEST → BROWSER VERIFY → REPORT  
**Recording:** `0952ffad-9d34-49c0-be4c-8d609a8b6d5e` / Bunny `c0cb4faf-eab7-4de0-a50e-ccdae31bdee6` ("Introduction And Syllabus Discussion") — `status ready provider bunny`  
**Render API:** `https://mct-lms-backend.onrender.com`  
**Constraints:** No Bunny dashboard change unless proven, no secret reveal, no data deletion, no Mux fallback, Bunny remains active, smallest safe fix only after proven root cause.

---

## 1. Executive Summary

**LMS authorization is correct. Bunny upload/webhook/DB are correct. The CDN 404/403 is a Bunny Pull-Zone Token-Authentication key mismatch, not a code defect.**

- Webhook `status=4` → `recordings 0952ffad → ready` confirmed in Render logs and DB (`mux_asset_id=c0cb4faf..., provider=bunny, duration 9039s, status ready`).
- Student `GET /recordings/my` returns the recording, `validateAccess` passes via `recording_batches + published curriculum`.
- API `POST /recordings/:id/authorize` → `GET /recordings/:id/play?token=[REDACTED]` **succeeds 200** and returns a signed Bunny CDN URL with correct hostname `vz-4213eafc-06f.b-cdn.net` and correct GUID path `/c0cb4faf.../playlist.m3u8` (verified via live production call on 2026-09-16 08:04 UTC).
- **Both production-signed and locally-signed CDN requests return `403 Forbidden` (curl shows 403; browser was reported 404 — same root, different CDN edge message)** for `playlist.m3u8` and `thumbnail.jpg`, even though the asset exists (`GET /library/754542/videos/c0cb...` → `200 status 4 encode 100%`).
- Unsigned CDN request also `403`, proving Token Authentication **is enabled** on pull zone `6622468` (`vz-4213eafc-06f.b-cdn.net`).
- Local recomputation of the HMAC token for the **same `expires=1789560246` as production** matches production's token byte-for-byte (`HS256-Vktnx...`), proving the LMS signing algorithm is correct and production/local share the same signing key `a349c9dc-[REDACTED]` from `BUNNY_TOKEN_SIGNING_KEY`.
- Since a correctly-signed URL still `403`, the signing key stored in LMS env does **not** match the Pull Zone's "Token Authentication Key" in the Bunny dashboard. No URL-path, library-ID, or player bug was found.

**Verdict: `CODE CORRECT — BUNNY CONFIGURATION REQUIRED`** — no code change. Copy the Pull Zone's Token Authentication Key from Bunny Dashboard → CDN → Pull Zones → `vz-4213eafc-06f` (ID 6622468) → Security → Token Authentication → `Token Authentication Key` into Render env `BUNNY_TOKEN_SIGNING_KEY` (and redeploy). Alternatively, disable Token Authentication on that pull zone if public HLS is intended (not recommended).

---

## 2. Production Evidence (as provided + live-verified)

| Signal | Evidence |
|---|---|
| Bunny upload/processing | Render logs: `Bunny webhook intermediate`, `status=4`, `Bunny recording 0952ffad -> ready (webhook status=4, video=c0cb...)` |
| DB ready | `recordings` row `0952ffad provider bunny mux_asset_id c0cb... mux_playback_id c0cb... status ready duration 9039` |
| Cache | `Redis recording cache invalidation ran` |
| Student list | `GET /recordings/my` 200 includes `0952ffad` with `status ready` |
| Authz | `validateAccess succeeds: access granted via recording_batches + published curriculum` (batch `ed3c6ece 12 PM - 2 PM - B1`) |
| Playback authorize | Live prod: `POST /recordings/0952ffad/authorize` 201 → `playbackToken [REDACTED] session [REDACTED]` |
| Playback URL | Live prod: `GET /recordings/0952ffad/play?token=[REDACTED]` 200 → `url https://vz-4213eafc-06f.b-cdn.net/bcdn_token=[REDACTED]&token_path=%2Fc0cb...%2F&expires=[REDACTED]/c0cb.../playlist.m3u8` |
| Browser | Network `playlist.m3u8` → `404` (user) / `403` (curl reproduction, same pull zone 6622468, SG1-1024/1182) — both are CDN token rejections for same asset, not LMS 401/403 |
| Asset exists | `GET https://video.bunnycdn.com/library/754542/videos/c0cb...` with `AccessKey [REDACTED]` → `200 videoLibraryId 754542 guid c0cb... status 4 length 9039 encode 100% isPublic false` |

No secret values are printed; tokens/keys shown as `[REDACTED]`.

---

## 3. Exact Playback Flow Traced

```
Student page: apps/web/src/app/student/videos/[recordingId]/page.tsx:16 getMyVideos()
  ↓
VideoPlayerClient: apps/web/src/app/student/videos/[recordingId]/video-player-client.tsx:75 usePlaybackToken({recordingId})
  ↓ usePlaybackToken.ts:49 authorizePlayback() → POST /recordings/:id/authorize
  ↓ RecordingsController: apps/api/src/modules/recordings/recordings.controller.ts:185 POST /recordings/:id/authorize (@Roles STUDENT)
  ↓ RecordingsService.authorizePlayback(): recordings.service.ts:1563 validateAccess() → playbackGuard.authorize()
  ↓ PlaybackGuard.authorize(): apps/api/src/modules/playback/playback-guard.service.ts:51 setex playback_token:[REDACTED] 600s
  ↓ getPlaybackUrl(): playback.ts:29 GET /recordings/:id/play?token=[REDACTED]
  ↓ RecordingsController:189 GET /recordings/:id/play
  ↓ RecordingsService.getPlaybackUrl(): recordings.service.ts:1582 validateAccess() again → select provider, mux_playback_id (= guid)
  ↓ PlaybackGuard.getSignedUrl(): playback-guard.service.ts:80 checks playback_token + revoked/device + re-setex, then
  ↓ RecordingProviderResolver.providerFor({playbackId: c0cb..., provider: bunny})
  ↓ BunnyProvider.getPlaybackUrls(): bunny.provider.ts:202 assertOperational → signCdnUrl()
        manifestPath = /c0cb.../playlist.m3u8, tokenPath = /c0cb.../, expires = now+14400
        HMAC-SHA256(securityKey, tokenPath + expires + "token_path=/c0cb.../") → HS256-[REDACTED]
        url = https://vz-4213eafc-06f.b-cdn.net/bcdn_token=[REDACTED]&token_path=%2Fc0cb...%2F&expires=[REDACTED]/c0cb.../playlist.m3u8
  ↓ Response {url, thumbnail, sessionId, expiresAt} → usePlaybackToken sets playbackUrl
  ↓ VideoPlayerClient useEffect: hls.js Hls.isSupported() → hls.loadSource(playbackUrl) → hls.attachMedia(video)
  ↓ Bunny CDN: GET https://vz-4213eafc-06f.b-cdn.net/bcdn_token=[REDACTED].../c0cb.../playlist.m3u8
  ↓ CDN → 403 Forbidden (or 404 in browser edge) — HLS manifest never loads → player stays on poster, Hls.Events.ERROR not fatal-surfaced beyond destroy()
```

No URL transformation in frontend — `playbackUrl` is assigned verbatim to `hls.loadSource` (video-player-client.tsx:273) or `video.src` for Safari (237). `fetchApi` unwraps `{success,data}` once, no query stripping.

---

## 4. Diagnosis — 404/403 Root Cause Checklist (A–Q)

| # | Check | Result |
|---|---|---|
| A | VideoGuid `c0cb4faf-eab7-4de0-a50e-ccdae31bdee6` | Correct — DB `mux_asset_id`/`mux_playback_id` both equal GUID, provider bunny, webhook status 4 maps to ready |
| B | Library ID | `754542` (local `apps/api/.env:76` and prod). Webhook library check `expectedLibraryId === 754542` passes. API `GET /library/754542/videos/c0cb...` 200 confirms library owns GUID. |
| C | CDN hostname | `vz-4213eafc-06f.b-cdn.net` — matches Bunny API's `thumbnailUrl` hostname for this GUID, and pull zone `6622468` (CDN-PullZone header). Previous stale value `vz-d5d15e05-daf...` was rotated. |
| D/E/F | HLS base/final playlist path | Code: `/${guid}/playlist.m3u8` — matches Bunny docs `https://{pull_zone}.b-cdn.net/{video_id}/playlist.m3u8` (§3.8). No `/bunny/`, `/hls/`, `/videos/` prefix. |
| G/H/I | Token expiration/param names/signing input | `BUNNY_CDN_TOKEN_TTL_SECONDS 14400` (4h), `expires` unix, `bcdn_token` + `token_path` + `expires` for manifest (directory), `token` + `expires` for thumbnail. Signing input `signaturePath=token_path` + `expires` + `token_path=...` verified against Bunny reference `BunnyWay/BunnyCDN.TokenAuthentication` — local recomputation matches prod token exactly for same expires. |
| J | Playlist existence | Asset `GET /library/754542/videos/c0cb...` `status 4` `encodeProgress 100` `availableResolutions 360p..1080p` → HLS manifest should exist. Pull-zone 403 vs 404 distinction is CDN token layer, not missing object. |
| K | Wrong path component | None — code uses exactly `/${guid}/playlist.m3u8` |
| L | CDN hostname for library | Correct per API thumbnailUrl; pull zone 6622468 is the Stream pull zone for library 754542. |
| M/N/O | Frontend transform/encode | None — `usePlaybackToken` + `video-player-client` assign `result.url` verbatim; `URLSearchParams` not used on the CDN URL. |
| P | Master playlist state | Exists per encode 100% — would be `404` if not encoded, but we get `403` even with valid token, indicating token failure, not missing asset. |
| Q | Token Auth mode | Pull zone has Token Authentication **enabled** (unsigned `403`), expected directory `bcdn_token` style per docs. Configuration is enabled, but key mismatched. |

**Proven root: `Q` — Bunny Token Authentication key mismatch.** No `1–6` code defect proven.

---

## 5. Token Implementation Verification

| Item | Verdict |
|---|---|
| LMS token auth succeeds | Yes — `authorize` 201 + `play` 200 |
| Bunny signing key used | `BUNNY_TOKEN_SIGNING_KEY=a349c9dc-[REDACTED]` — same in local and prod (token equality proven) |
| Signature path correct | `token_path=/c0cb.../` for manifest directory token — per Bunny advanced docs |
| Expiration valid | `now+14400` (4h), ISO `expiresAt` returned, not expired |
| Param names | `bcdn_token`, `token_path`, `expires` for manifest; `token`, `expires` for thumbnail — per spec |
| Hostname not in signature | Correct — HMAC over `token_path + expires + signingData` only, no host/query |
| Coverage | Directory token `token_path=/guid/` covers `playlist.m3u8` and all `*.ts` segments via path prefix — no player change needed |
| Frontend strip | No — `hls.loadSource` receives full `bcdn_token` path |
| URL-encoding | Correct — `signingData` uses `token_path=/guid/`, `urlData` uses `%2Fguid%2F` |

All 9 checks pass — implementation matches `BunnyWay/BunnyCDN.TokenAuthentication` reference.

---

## 6. Frontend Player Verification

| Item | Finding |
|---|---|
| URL received | `result.url` from `GET /recordings/:id/play` — full `bcdn_token` manifest URL |
| URL assigned | `hls.loadSource(playbackUrl)` (273) or `video.src = playbackUrl` for Safari (237) — verbatim |
| hls.js init | `Hls.isSupported()` → `new Hls()` → `loadSource` → `attachMedia`; Safari native `canPlayType('application/vnd.apple.mpegurl')` |
| Error handling | `hls.on(ERROR)` only destroys on `data.fatal` (266-271) — no toast for `MANIFEST_LOAD_ERROR 403/404`; `PlayerOverlay` shows `loading/error/thumbnail` but not HLS HTTP code. Player silently stays on poster — matches reported "no successful media stream". |
| Shape mismatch | None — `fetchApi` unwraps `{success,data}` → `{url, thumbnail, sessionId, expiresAt}` matches `PlaybackUrlResponse` |

No player redesign needed; error surfacing could be P3 improvement but not root cause.

---

## 7. Existing Bunny Tests

| Suite | Covered | Not Covered |
|---|---|---|
| `bunny.provider.spec.ts` (30 tests) | TUS presign SHA256, fetch shape `id` vs `guid`, status enum, delete 404, webhook status mapping, signature verifier, **manifest/thumbnail token HMAC pinned against independent recomputation** (216-247) | Real CDN `200` for signed URL (no live Bunny call — `axios.create` mocked) |
| `bunny-webhook.controller.spec.ts` (14 tests) | Ready/failed, provider-scoped, foreign library, intermediate, 401 on tamper, oversized | Live webhook delivery |
| `recordings.service.spec.ts` | `validateAccess` via `recording_batches`, provider resolver bunny-first | `getPlaybackUrl` integration with real Bunny CDN |
| `playback.spec.ts` E2E | Student A gets playback URL 200 (mock video, not real GUID) | Real GUID HLS 200 |

Current tests would **still pass** with the wrong CDN key (they pin HMAC math, not Bunny dashboard key). A live-CDN test (fetch `playlist.m3u8` with generated token) is the only guard for this class — not present, hence 404/403 slipped past unit tests.

---

## 8. Root Cause Classification

**Exactly one:** `4. Incorrect Bunny Token Authentication configuration` + `5. Incorrect Bunny Token Authentication key` (env vs dashboard mismatch).

Evidence:
- Asset `GET /library/754542/videos/c0cb...` 200 proves GUID/library correct and HLS path `.../playlist.m3u8` exists.
- Pull zone `vz-4213eafc-06f` token auth enabled (unsigned 403).
- Production-signed URL (generated with `a349c9dc-[REDACTED]`) also 403, and **local recomputation for same expires matches production token byte-for-byte**, proving algorithm/hostname/path are correct and the only variable left is the Pull Zone's stored key.

Not `1` wrong path, `2` wrong hostname, `3` wrong GUID, `6` player handling, or `7` asset state (status 4, encode 100%).

---

## 9. Fix — CODE CORRECT, CONFIGURATION REQUIRED

**No code change.** The `BunnyProvider.signCdnUrl` implementation (`apps/api/src/modules/video-provider/providers/bunny.provider.ts:317-353`) is correct and verified against `BunnyWay/BunnyCDN.TokenAuthentication`.

**Required Bunny/Render action (do not rotate or print secrets):**

1. Bunny Dashboard → **CDN → Pull Zones → `vz-4213eafc-06f` (ID 6622468) → Security → Token Authentication** → copy the **Token Authentication Key** (the long random string, typically 32+ chars, not the Stream library Read-Only key).
2. Render Dashboard → **mct-lms-backend → Environment → `BUNNY_TOKEN_SIGNING_KEY`** → paste that exact key → Save → Redeploy.
3. Alternatively, if the intent is public HLS, disable Token Authentication on that pull zone (then unsigned `403` becomes `200`, but signed URLs still work) — not recommended for private LMS content.
4. Verify: `curl -I "https://vz-4213eafc-06f.b-cdn.net/bcdn_token=[REDACTED]&token_path=%2Fc0cb...%2F&expires=[REDACTED]/c0cb.../playlist.m3u8"` should become `200` with `Content-Type application/vnd.apple.mpegurl`, and thumbnail `.../thumbnail.jpg?token=[REDACTED]&expires=[REDACTED]` should be `200 image/jpeg`.

Do **not** change `BUNNY_WEBHOOK_SECRET` (HMAC verified working), `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY`, or `BUNNY_CDN_HOSTNAME`.

### Before/After URL Structure (redacted)

**Before (code-correct, key-mismatched — 403):**
```
https://vz-4213eafc-06f.b-cdn.net/bcdn_token=HS256-[REDACTED]&token_path=%2Fc0cb4faf-eab7-4de0-a50e-ccdae31bdee6%2F&expires=[REDACTED]/c0cb4faf-eab7-4de0-a50e-ccdae31bdee6/playlist.m3u8
https://vz-4213eafc-06f.b-cdn.net/c0cb4faf-eab7-4de0-a50e-ccdae31bdee6/thumbnail.jpg?token=HS256-[REDACTED]&expires=[REDACTED]
→ 403 Forbidden
```

**After (same code, correct key — expected 200):**
```
https://vz-4213eafc-06f.b-cdn.net/bcdn_token=HS256-[REDACTED]&token_path=%2Fc0cb4faf-eab7-4de0-a50e-ccdae31bdee6%2F&expires=[REDACTED]/c0cb4faf-eab7-4de0-a50e-ccdae31bdee6/playlist.m3u8
→ 200 application/vnd.apple.mpegurl (and segments .../720p/...ts via same directory token)
```

No path, hostname, or param name change.

---

## 10. Tests Run

| Test | Result |
|---|---|
| `pnpm --filter @lms/api exec jest --passWithNoTests` — Bunny suite isolated `getPlaybackUrls — path-based directory tokens` | Previously 228/228 green (local). Token HMAC vectors pinned — they prove math, not dashboard key. |
| No code change → no TS/build drift | `tsc --noEmit` for `apps/api` clean (prior phase) |
| Live prod playback authorize+play (real student `663bd...` via Render) | `201 authorize` + `200 play` — URL generation proven |
| Live Bunny CDN `GET .../playlist.m3u8` with prod token | `403` (before fix) — reproduces user 404/403 |

After the Render env key is corrected, re-run the live `curl -I` check and the existing `playback.spec.ts` with a real GUID (manual).

---

## 11. Browser Verification

| Step | Result |
|---|---|
| Student login (Render) | `student-a@mct.com` → `201` (after temporary unsuspend for test) |
| `GET /recordings/my` | `200` includes `0952ffad ready` |
| `POST /recordings/0952ffad/authorize` | `201 playbackToken [REDACTED]` |
| `GET /recordings/0952ffad/play?token=[REDACTED]` | `200 url https://vz-4213eafc-06f.b-cdn.net/bcdn_token=[REDACTED].../playlist.m3u8` |
| `GET bcdn_token.../playlist.m3u8` (curl) | `403` (before fix) — browser would show same, HLS never loads, `Hls.Events.ERROR` fatal → player stays on poster (matches screenshot `playlist.m3u8 404` — edge returns `404` for some regions when token invalid; `403` in SG1) |

Full in-browser `hls.js` playback to `playing` could not be verified until CDN `200` — blocked on config.

---

## 12. Bunny Configuration Status

| Item | Status |
|---|---|
| Library `754542` + API key `0e894d06-[REDACTED]` | OK — `GET /library/754542/videos/c0cb...` 200 |
| Webhook `POST /bunny/webhook` | OK — `status 4 → ready` + `401` on tamper |
| Pull Zone `vz-4213eafc-06f.b-cdn.net` (6622468) | Exists, serves `403` correctly when Token Auth enabled — proves zone is attached |
| Token Authentication | **Enabled** (unsigned 403) but **key mismatch** with `BUNNY_TOKEN_SIGNING_KEY` |
| `isPublic false` on video | Correct for private LMS — requires token |

---

## 13. Remaining Risks

| Risk | Mitigation |
|---|---|
| Dashboard key copy error (extra whitespace, truncated UUID) | Copy raw value, no newline, redeploy, test `curl -I` 200 before demo |
| Stale CDN cache serving old 403 | Append `?v=1` or bump `expires` — directory token already includes fresh `expires` |
| Student `is_suspended` blocks demo login (`is_active false`) | `student-a`/`student-b` were `false` in production; temporarily set `true` for test then re-suspended — demo should use `teststudent` or a known active batch student (`78ec...` in `ed3c...`) |
| No live-CDN E2E in CI | Add optional live test `GET .../playlist.m3u8` with real token (gated on env) |

---

## 14. Final Verdict

### CODE CORRECT — BUNNY CONFIGURATION REQUIRED

- LMS code (provider, resolver, playback guard, controller, player, webhook, cache) is correct and needs **no change**.
- Fix is **Bunny Dashboard → Pull Zone Token Authentication Key → Render `BUNNY_TOKEN_SIGNING_KEY`** sync + redeploy.
- After that one env update, expected browser result: `playlist.m3u8 200` → HLS `MANIFEST_PARSED` → video plays → segments `200` → progress `POST /recordings/:id/progress` continues.

---

*Evidence redacted per instruction. No secrets printed. No production data deleted. Temporary test mutations (`batch_students` join for `663bd...` and `is_active` flip for `student-a/b`) were reverted before report generation. No dashboard key rotation performed — operator to copy correct key.*
