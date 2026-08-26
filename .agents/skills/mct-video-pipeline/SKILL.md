---
name: mct-video-pipeline
description: Dual-provider video architecture (Mux Batch 1 / Bunny Batch 2+), provider resolver, playback authorization chain, Bunny CDN tokens and webhooks. Use when touching recordings, uploads, playback, HLS, MuxService, BunnyProvider, or webhooks.
---

# Skill: MCT LMS — Video Pipeline (Mux + Bunny)

## Purpose
Everything an agent must know before touching video code — including the migration strategy that forbids deleting Mux.

## Architecture
```
Recording row (recordings.provider = 'mux' | 'bunny')
   ↓ upload routing: RecordingProviderResolver.resolveUploadProvider()  [PHASE 7E POLICY]
     VIDEO_UPLOAD_PROVIDER=bunny (DEFAULT) ⇒ bunny for EVERY new upload
       (admin batch-linked, draft, Zoom auto-pipeline — batch numbers irrelevant).
       Bunny not enabled/configured ⇒ VISIBLE 503. NEVER silent-fallback to mux.
     VIDEO_UPLOAD_PROVIDER=mux ⇒ dormant emergency rollback switch (no code change)
   ↓ processing (status: processing → ready | failed; CHECK constraint allows only these)
     mux: webhook video.asset.ready/.errored    bunny: POST /bunny/webhook (signed)
   ↓ playback authorization (UNCHANGED for both providers):
     JWT → RolesGuard → validateAccess(recording_batches) → Redis playback token
     (playback_token:<uuid>, 600s sliding, bound userId+recordingId+deviceId, revocable,
      rate-limited 8 URLs/min) → PlaybackGuard.getSignedUrl
   ↓ RecordingProviderResolver.providerFor({provider}) → provider.getPlaybackUrls()
     mux:   RS256 JWT-signed stream.mux.com URL (60 s) + image.mux.com thumb (300 s)
     bunny: https://{cdnHost}/bcdn_token=HS256-…&expires=…&token_path=%2F{guid}%2F{guid}/playlist.m3u8
            directory token (4 h default) so HLS segments inherit auth automatically;
            thumbnail = query-string token on /{guid}/thumbnail.jpg
```

## Important Files
`modules/video-provider/*` (types, resolver, providers/, bunny-webhook.controller) · `modules/mux/mux.service.ts` · `modules/playback/playback-guard.service.ts` · `modules/recordings/recordings.service.ts` (`createRecordingWithUpload`, `requestUploadUrl`, `getPlaybackUrl`) · `jobs/recording-upload.job.ts`, `recording-cleanup.job.ts` · web player `app/student/videos/[recordingId]/video-player-client.tsx`

## Database Contracts
- `recordings.provider TEXT NOT NULL DEFAULT 'mux' CHECK (provider IN ('mux','bunny'))`
- `recordings.status CHECK (status IN ('processing','ready','failed'))` — never write `'error'`.
- Identifier columns `mux_asset_id / mux_playback_id / mux_upload_id` are PROVIDER-GENERIC storage slots keyed by `provider`. For bunny rows they hold the Bunny video GUID. Do NOT rename them until the retirement phase.
- Bunny direct uploads start with only `mux_upload_id`; the signed webhook backfills `mux_asset_id` + `mux_playback_id` (= GUID).

## Rules
- **Bunny-first launch policy (Phase 7E): every NEW recording = bunny.** The old Batch 1=Mux / Batch 2+=Bunny plan was migration scaffolding only — batch numbers no longer influence provider selection. Mux stays compiled/registered as DORMANT rollback (`VIDEO_UPLOAD_PROVIDER=mux`), receives NO new production uploads, and must never be deleted.
- **NEVER delete or auto-migrate existing Mux assets.** Rollback for a single recording = `UPDATE recordings SET provider='mux' WHERE id=…`; rollback for all NEW uploads = `VIDEO_UPLOAD_PROVIDER=mux`.
- A bunny row NEVER silently falls back to Mux: BunnyProvider failures are observable 503s. Preserve this (resolver enforces it at upload time too).
- Browser uploads to Bunny MUST use the TUS handle (`upload.kind==='tus'`, presigned per-video headers) — the raw PUT endpoint needs the secret AccessKey and can never be browser-facing. Web uploader: `apps/web/src/lib/upload/tus-uploader.ts`.
- Student contract is `{url, thumbnail, sessionId}` (+expiresAt). The hls.js player is provider-generic — do not add provider branches to it.
- Bunny webhook signature (v1): lowercase-hex HMAC-SHA256 of exact rawBody with the library **Read-Only API key** (`BUNNY_WEBHOOK_SECRET`); validate version+algorithm headers; reject with 401.
- Bunny status scales differ: webhook {3 Finished,4 Resolution finished→ready; 5→failed} vs REST enum {4→ready; 5 Error,6 UploadFailed→failed}. Two isolated mappers exist — do not merge them.
- Provider invocation sits strictly BELOW authorization checks in PlaybackGuard.

## Live-Verified Bunny Facts (Phase 7E — real-account evidence)
- **TUS requires a creation step**: `POST /tusupload` with presigned headers + `Upload-Length`(total) + strict `Upload-Metadata` (`filetype <b64>,title <b64>` — comma-separated, NO space between pairs) → `201` + **relative** `Location: /tusupload/<session>`. Resolve Location against the ENDPOINT origin (a naive relative XHR in the browser would hit our own domain). PATCH chunks to that session WITHOUT `Upload-Length` ("cannot be updated once set"). Web impl: `apps/web/src/lib/upload/tus-uploader.ts`.
- **Fetch import returns `{id,success}`, not `{guid}`** — reading only `.guid` silently breaks the Zoom auto-pipeline (fixed; both shapes accepted).
- Encode queue on the new library was ~40 min backlogged for a 1 MB file: uploads persist even while `encodeProgress=0`; poll patiently before declaring failure. REST status enum mapping (4→ready) confirmed against live data.
- Signed-URL 403 with correctly-formed tokens ⇒ `BUNNY_TOKEN_SIGNING_KEY` does not match the pull zone's Token Authentication Key (or zone has IP-locking). No-token requests correctly 403 when Token Auth is enforced.

## Common Failure Modes
| Trap | Consequence |
|---|---|
| Putting `prefs`/volatile state into the HLS init effect | hls.destroy() → MediaSource reset → buffer zeroed mid-playback (fixed in 7A; see skill mct-frontend-development) |
| Writing canonical status 'error' | CHECK violation → row stuck in processing (Phase 7B fix R3; DTO now validates processing/ready/failed only — 7E) |
| Signing Bunny URLs with query-string tokens for HLS | segments 403 — path-style is mandatory |
| Reusing Mux's 60 s expiry for Bunny tokens | mid-playback stalls on segment fetches |
| Proxying video bytes through the LMS API or handing the library key to the browser | cost/bandwidth blowup + secret exposure — uploads are browser→Bunny TUS with per-video presigned headers only |

## Verification
- Unit: `video-provider/*.spec.ts`, `playback-guard.service.spec.ts`, `recordings.service.spec.ts`.
- Live DB check: distribution via `SELECT provider, count(*) FROM recordings GROUP BY provider` (12 legacy mux rows as of Phase 7E; all NEW uploads must arrive as bunny).
- Full evidence + runbook: `docs/rccf-phase7c-bunny-verification-report.md`; launch policy + TUS web uploader: `docs/rccf-phase7e-bunny-production-enablement-report.md`.

## Do Not
- Do not delete MuxService/Mux columns/webhook/@mux deps (coexistence phase).
- Do not implement new Bunny behaviour without official docs evidence (no guessed endpoints/token math/signatures).
- Do not issue CDN URLs outside the provider classes.
