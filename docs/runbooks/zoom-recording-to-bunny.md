# Runbook — Zoom Recording → Bunny Pipeline

**Scope:** Operating guide for the automatic Zoom cloud-recording ingestion into the
LMS, and the manual upload fallback. Applies to the Phase 8 production pipeline.

**No secrets live here.** Credentials are referenced by environment-variable name
only. Keep real secrets in the deployment secret store, never in this file or in
logs/DB error messages.

---

## 1. Zoom setup required

- A Zoom account with **Cloud Recording** enabled (webinar/meeting auto-record to cloud).
- API credentials for a Server-to-Server (S2S) OAuth app:
  - `ZOOM_ACCOUNT_ID`
  - `ZOOM_CLIENT_ID`
  - `ZOOM_CLIENT_SECRET`
- The S2S app needs the `recording:read:admin` scope so the download URL's
  `access_token` can fetch the recorded file.
- The webinar must be created **by the LMS** (`LiveSessionsService` →
  `ZoomService.createWebinar` with `auto_recording: 'cloud'`). The stored
  `live_sessions.zoom_webinar_id` is how an incoming `recording.completed` event is
  matched to a session.

## 2. Webhook URL

Configure the Zoom webhook in the Zoom Marketplace app to POST to:

```
https://<api-host>/zoom/webhook
```

This endpoint is `@Public()` (Zoom cannot send JWTs) and is signature-verified
server-side. It must be reachable from the internet (no auth wall in front of it).

## 3. Zoom webhook secret

- Set `ZOOM_WEBHOOK_SECRET` (from the Zoom app's "Verification Token"/Secret).
- Every non-challenge event is verified as `v0=HMAC-SHA256(secret, v0:{ts}:{rawBody})`
  with a 300 s replay window (`ZoomService.verifyWebhookSignature`).
- Events missing the `x-zm-signature` / `x-zm-request-timestamp` headers, or with a
  bad signature, are **logged and ignored** (HTTP 200, no processing, no retry).

## 4. Bunny credentials

Set the following (production must keep `VIDEO_UPLOAD_PROVIDER=bunny`):

| Env var | Purpose |
|---|---|
| `VIDEO_UPLOAD_PROVIDER` | `bunny` (default) — all NEW recordings route to Bunny |
| `BUNNY_ENABLED` | `true` |
| `BUNNY_LIBRARY_ID` | Bunny Stream library id |
| `BUNNY_API_KEY` | Bunny **write** API key (used for fetch + status) |
| `BUNNY_CDN_HOSTNAME` | e.g. `vz-xxxx.b-cdn.net` |
| `BUNNY_TOKEN_SIGNING_KEY` | For playback/token-auth signing |
| `BUNNY_WEBHOOK_SECRET` | Bunny webhook signing secret |

> **IMPORTANT:** If `VIDEO_UPLOAD_PROVIDER=bunny` but Bunny is not enabled/configured,
> the resolver **fails visibly with 503** — it never silently falls back to Mux.
> The dormant `VIDEO_UPLOAD_PROVIDER=mux` switch exists only as an emergency
> rollback for NEW uploads; it does not touch existing recordings.

## 5. Bunny library configuration

- The library must have **Pull Zones** and/or the CDN hostname configured so the
  `fetch` endpoint can download the source and so playback URLs resolve.
- Enable **Token Authentication** for playback (see §6).
- Enable the **webhook** in the library pointing at the API (see §7).

## 6. Bunny Token Authentication

- Playback URLs are signed by `BunnyProvider` using `BUNNY_TOKEN_SIGNING_KEY`
  (path-based directory token, default TTL 4 h). This is **provider-side** delivery
  protection on top of the LMS authorization layer.
- Token auth must be enabled in the Bunny library's "Token Authentication" setting
  with the same signing key.

## 7. Bunny webhook

Configure the library webhook to POST to:

```
https://<api-host>/bunny/webhook
```

`@Public()`, HMAC-SHA256 (`v1`) verified against `BUNNY_WEBHOOK_SECRET`, foreign
libraries rejected, and mutations are scoped to `provider='bunny'` rows only.
The webhook flips a recording to `ready` **only** on a real Bunny encode-success
event; `failed` on an encode-error. Intermediate statuses are ignored.

## 8. How automatic recordings work

```
Zoom cloud recording completes
   → POST /zoom/webhook  (recording.completed, signature-verified)
   → ZoomWebhookHandler:
       · select best file: MP4 + status=completed, largest pixels, latest start
       · resolve live_session by zoom_webinar_id
       · idempotency: skip if this zoom_recording_file_id already queued
         (pre-check + partial unique index uq_upload_queue_zoom_recording_file)
       · insert ONE upload_queue row (status=pending, session_id, topic,
         zoom_download_url, zoom_url_expires_at ~20h)
   → RecordingUploadJob (cron, every 2 min):
       · reclaim stale 'processing' rows (>30 min) back to 'pending'
       · claim pending/failed jobs within backoff (MAX_ATTEMPTS=3,
         BACKOFF_MINUTES=[5,30])
       · fresh Zoom S2S OAuth token; append ?access_token= to download URL
       · Bunny fetch/pull (POST /library/{id}/videos/fetch) — Bunny downloads
         server-side, the LMS never proxies video bytes
       · persist Bunny asset id on the queue row BEFORE creating the recording
         (crash-safe: no duplicate Bunny import on restart)
       · create/reuse recordings row (provider='bunny', status='processing',
         title = Zoom topic, session_id linked)
       · inherit batches: session_batches → RecordingsService.assignToBatches()
         (canonical recording_batches + curriculum sync + cache invalidation)
       · queue row → 'done'
   → Bunny webhook (encode success) → recordings.status='ready', playback backfill
   → Students in the recording's batches can watch (recording_batches auth)
```

The recording is **only** visible to students whose batch is in `recording_batches`
and whose status is `ready`. It is never globally public by default.

## 9. How to manually upload (fallback)

1. Admin → Recordings → Upload.
2. Select video file, select batches, set curriculum/category, publish.
3. Server presigns a Bunny TUS upload; the browser streams it directly to Bunny
   (no video bytes through the API request path).
4. Bunny webhook flips status `processing → ready`.
5. Batch assignment preserved (recording_batches + curriculum), publish preserved.

This route is fully independent of Zoom and remains the fallback if automation fails.

## 10. How to retry failed recordings

- A failed `upload_queue` row (`status='failed'`) is re-claimed automatically once
  its backoff elapses (`BACKOFF_MINUTES`), up to `MAX_ATTEMPTS` (3).
- To force a retry of a job that hit the attempt cap or is terminal:
  ```sql
  UPDATE upload_queue
     SET status='pending', attempts=0, error_message=NULL, updated_at=now()
   WHERE id = '<job-id>';
  ```
  The cron will pick it up on the next tick.
- If the **Bunny** side failed (recording `status='failed'` via webhook), the
  original source is not re-fetched automatically. Re-run the manual upload for that
  content, or re-enqueue the Zoom file by re-delivering the webhook (delete the old
  `upload_queue` row for that `zoom_recording_file_id` first).

## 11. How to diagnose stuck processing

A job stuck in `processing` for > 30 min is auto-reclaimed to `pending`. If it
remains stuck:

1. Check `upload_queue` state:
   ```sql
   SELECT id, status, attempts, error_message, zoom_recording_file_id, updated_at
     FROM upload_queue
    ORDER BY updated_at DESC;
   ```
2. Check the recording row status:
   ```sql
   SELECT id, title, provider, status, mux_asset_id FROM recordings WHERE session_id IS NOT NULL ORDER BY created_at DESC;
   ```
3. Confirm Bunny processing via the Bunny dashboard (video status) or the
   `GET /library/{id}/videos/{guid}` status API.
4. If the queue row is `done` but the recording is not `ready`, Bunny's encode likely
   failed → see §10.

## 12. How to verify Bunny readiness

- Recording row has `status='ready'` and `mux_playback_id` backfilled.
- Verify in Bunny dashboard that the video is `Active`/encoding complete.
- Optionally re-run a playback request and confirm a signed playback URL is issued.

## 13. How to verify student access

- Confirm the student's batch is in `recording_batches` for the recording:
  ```sql
  SELECT rb.recording_id, rb.batch_id
    FROM recording_batches rb
    JOIN batch_students bs ON bs.batch_id = rb.batch_id
   WHERE bs.user_id = '<student-uuid>'
     AND rb.recording_id = '<recording-uuid>';
  ```
- The student must be in a batch present in `recording_batches`, and the recording
  must be `status='ready'`. Otherwise the student gets 403/404 (as designed).
- Verify the live session is visible to the student the same way via `session_batches`.

## 14. How to safely delete test recordings

Delete child/mapping rows **before** the parent (FK safety):

1. Delete curriculum entries:
   ```sql
   DELETE FROM batch_recording_curriculum
    WHERE content_id = '<recording-uuid>' AND content_type='recording';
   ```
2. Delete batch links:
   ```sql
   DELETE FROM recording_batches WHERE recording_id = '<recording-uuid>';
   ```
3. Delete the provider asset **only if you intend to** (Bunny dashboard or
   `DELETE /library/{id}/videos/{guid}`). This is destructive and irreversible.
4. Delete the recording row:
   ```sql
   DELETE FROM recordings WHERE id = '<recording-uuid>';
   ```
5. If cleaning test `upload_queue` rows:
   ```sql
   DELETE FROM upload_queue WHERE id = '<job-id>';
   ```

## 15. Rollback procedure

- **Provider:** set `VIDEO_UPLOAD_PROVIDER=mux` in the API environment and redeploy.
  New uploads route to Mux again; existing Bunny recordings keep `provider='bunny'`
  and stay playable. This does not delete any Bunny assets.
- **Schema (migration 036):** additive — rollback drops the added columns/index and
  restores `session_id NOT NULL` once no NULL rows exist (see the migration header).
- **Code:** the handler/job changes are self-contained; revert the two files to
  restore prior behavior. No player/auth/curriculum architecture is affected.
- **Feature kill-switch:** if auto-ingestion must stop, disable the Zoom webhook
  event subscription or set `ZOOM_WEBHOOK_SECRET` to an invalid value so events are
  rejected (they are ignored, not processed).
