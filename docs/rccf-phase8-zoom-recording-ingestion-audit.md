# RCCF Phase 8A — Zoom Recording Ingestion Audit

**Scope:** Audit only — NO code changes. Trace the existing LIVE CLASS → ZOOM → RECORDING → BUNNY path end-to-end against real source code and the live Supabase DB, determine trimming feasibility, and recommend the safest ingestion architecture for implementation (Phase 8C) after approval.

**Evidence sources:** repository source + tests, migrations `004–035`, live DB introspection (PostgREST OpenAPI definitions — column names, types, PK/FK, NOT NULL; row counts), skills knowledge base, Phase 6/6B/7A–7E reports. Items that cannot be verified without a live Zoom/Bunny event are **explicitly flagged** rather than guessed.

---

## 1. Current Architecture (as found)

```
ADMIN /admin/sessions (TradingSessionsController — unchanged contract)
   ↓ compat layer
LiveSessionsService.create()                      [live-sessions.service.ts]
   ├→ live_sessions row (status 'scheduled')
   ├→ session_batches rows                        ← batch isolation for sessions
   ├→ session_registrants (+ per-student Zoom registration)
   └→ ZoomService.createWebinar()
        POST /users/me/webinars { type:5, auto_recording:'cloud',
                                  timezone:'Asia/Kolkata', … }
        ⇒ zoom_webinar_id = data.id.toString()    (NUMERIC webinar number, stored string)

ZOOM CLOUD RECORDING
   ↓ webhook  POST /zoom/webhook (@Public, rawBody preserved main.ts:26)
ZoomController.handleZoomWebhook                  [zoom.controller.ts:108]
   ├─ endpoint.url_validation → HMAC challenge (unwrapped via @Res)
   ├─ missing signature headers → 200 + ignore
   ├─ verifyWebhookSignature()                    [zoom.service.ts:354]
   │     v0=HMAC-SHA256(v0:{ts}:{rawBody}) constant-time + 300 s replay window
   └─ ZoomWebhookHandler.handle(event, payload, supabase)
        case recording.completed                  [zoom-webhook.handler.ts:175]
          ├─ recording_files.find(f => f.file_type === 'MP4')   ← FIRST match only
          ├─ lookup live_session WHERE zoom_webinar_id = object.id.toString()
          └─ INSERT upload_queue { session_id, zoom_download_url,
                 zoom_url_expires_at = now+20h, status:'pending' }

RecordingUploadJob  @Cron('*/2 * * * *')          [jobs/recording-upload.job.ts]
   ├─ SELECT * FROM upload_queue WHERE status='pending'
   │    AND zoom_url_expires_at > now ORDER BY created_at LIMIT 3
   ├─ fresh Zoom S2S OAuth token (per tick)
   └─ per job:
        ├─ queue row → 'processing'
        ├─ downloadUrl = zoom_download_url + '?access_token=' + oauthToken
        ├─ batchIds = session_batches WHERE session_id = job.session_id
        ├─ providerName = resolver.resolveUploadProvider(batchIds)   ← bunny-first policy (7E)
        ├─ provider.createAssetFromSource({ sourceUrl })             ← BUNNY FETCH/PULL
        ├─ INSERT recordings { session_id, title:'Recording', provider,
        │       mux_asset_id = bunnyGuid, status:'processing' }
        ├─ INSERT recording_batches (one row per session batch)      ← AUTO-PUBLISH PATH
        └─ queue row → 'done', mux_asset_id = guid
        on error: queue row → 'failed', error_message              ← TERMINAL, no retry

BUNNY ENCODE
   ↓ signed webhook POST /bunny/webhook (@Public)
BunnyWebhookController                            [bunny-webhook.controller.ts]
   ├─ rawBody size cap + HMAC-SHA256 v1 verify (401 on failure, zero mutations)
   ├─ foreign-library rejection; intermediate statuses ignored (debug)
   └─ applyCanonicalStatus(): scoped provider='bunny' AND
        mux_asset_id=guid OR (mux_asset_id IS NULL AND mux_upload_id=guid)
        → status ready|failed, backfill mux_playback_id (= guid) +
        duration_seconds (REST getAssetStatus), invalidateRecordingsCache()

STUDENT PLAYBACK (UNCHANGED, provider-generic)
recordings.service.getPlaybackUrl → validateAccess(recording_batches ∩ batch_students,
status='ready') → PlaybackGuard Redis token (600 s sliding, device-bound, 8/min)
→ resolver.providerFor(provider) → Bunny path-based directory CDN token (4 h)
→ frontend contract { url, thumbnail, sessionId, expiresAt }  [videos.ts:58]
```

**Manual upload route (verified intact):**
`/admin/recordings` → UploadRecordingModal → `createRecordingWithUpload()` (resolver bunny-first, TUS presign server-side) → browser TUS → Bunny → signed webhook → ready → admin assigns batches via `assignToBatches()` (which ALSO upserts curriculum entries) → student sees after assignment. Fully independent of Zoom.

---

## 2. Answers to Phase 8B Questions (from actual code, not guesses)

| # | Question | Answer |
|---|----------|--------|
| 1 | When Zoom sends `recording.completed`, what happens? | Signature-verified dispatch to `ZoomWebhookHandler`; first MP4 file found; session looked up by `zoom_webinar_id == object.id`; row inserted into `upload_queue` (`pending`). Processed by a 2-min cron, max 3 jobs/tick. |
| 2 | Does the system download the Zoom recording? | **No.** `provider.createAssetFromSource()` calls Bunny's **fetch/pull** endpoint (`POST /library/{id}/videos/fetch`) — Bunny's servers download from the credential-in-query Zoom URL. The LMS never proxies bytes. Comment in `bunny.provider.ts:169` explicitly supports this. |
| 3 | Where is Zoom recording metadata stored? | Only inside `upload_queue`: `zoom_download_url`, `zoom_url_expires_at`, `mux_asset_id` (after success). There is **no** storage of Zoom meeting UUID, recording UUID, or per-file ID anywhere. `payload.object.topic` is discarded (title hardcoded `'Recording'`). |
| 4 | Is the Zoom recording URL temporary? | Treated as such: handler stamps `zoom_url_expires_at = now + 20h` ("Zoom links expire in 24h" comment). Exact TTL of `download_url` **not verifiable from repo — flag for live verification** (8E). |
| 5 | Does Zoom provide an authenticated download URL? | `download_url` requires auth; the job appends the S2S OAuth token as `?access_token=` query param (Zoom's documented pattern; Bunny fetch accepts credential-in-query URLs). Required OAuth scope (`recording:read:admin`) **cannot be verified from repo — flag for 8E**. If `download_url` ever contains query params, naive `'?'` concat would break it (robustness nit). |
| 6 | Is there already a background job/queue? | Yes — DB table `upload_queue` + `@nestjs/schedule` cron `RecordingUploadJob` (every 2 min, ≤3 jobs, `isRunning` re-entrancy guard), registered in `AppModule` + `ScheduleModule.forRoot()`. It is NOT Redis-backed; it is a DB poll loop. |
| 7 | Does `upload_queue` participate today? | Yes — it IS the existing pipeline's spine (webhook inserts, cron consumes). But its DDL exists in **no migration** (only in stale `schema.sql` §2.13); table was created out-of-band. |
| 8 | Can a Zoom recording already be associated with a live_session? | Yes — `upload_queue.session_id` FK → `live_sessions.id` and `recordings.session_id` FK → `live_sessions.id`. Both are populated when the webinar-ID lookup succeeds. |
| 9 | How is the session's batch determined? | `session_batches WHERE session_id = job.session_id` at job time (not at webhook time). |
| 10 | How can a recording inherit correct batches automatically? | Already does — cron copies `session_batches` into `recording_batches`. **But see finding F7: this auto-publishes and skips curriculum sync.** |
| 11 | Can multiple recording files arrive for one Zoom session? | Yes. `recording_files[]` may include MP4 variants (combined/speaker/screen when separate views are on), `M4A` audio_only, `TRANSCRIPT`/`CC` VTT, timeline files. Handler picks the first MP4 and ignores everything else (no persistence of secondary files). |
| 12 | How are audio/video/transcript distinguished? | By `file_type` only ('MP4' vs others). The code ignores each file's `status` field (files can be non-`completed`) and ignores view-type disambiguation among multiple MP4s. |
| 13 | Which file should become the LMS video? | The completed combined MP4 (largest duration/resolution MP4 with `status === 'completed'`). Current first-match heuristic usually works because webinars produce one combined MP4 by default, but it is not robust. |
| 14 | What if the webhook fires twice? | **Duplicate rows.** No idempotency key, no unique constraint, no dedupe on any Zoom identifier → two queue jobs → two Bunny fetches → two recordings (both auto-linked to batches). |
| 15 | Bunny upload succeeds but DB update fails? | Cron marks queue 'done' only after recording insert succeeds; if the recordings insert fails the queue row goes 'failed'. If the FINAL queue update fails, queue row stays 'processing' forever while a valid recording exists (orphan-ish state, observable only in logs). Bunny-side: webhook DB-update failure is logged and Bunny gets 200 (reconciliation possible via REST status). |
| 16 | Bunny processing fails? | Signed webhook status=5/6 → recordings.status='failed' (scoped to bunny rows). Queue row remains 'done'. No retry of the source; admin would have to re-trigger manually (no UI for that today). |
| 17 | Zoom recording download fails? | Bunny fetch fails asynchronously AFTER returning a guid — meaning the fetch request itself usually succeeds (202-style) and failure surfaces later as Bunny status Error. Current code treats "fetch accepted" as success; a failed pull yields recordings.status='failed' via webhook. Retry = none. |
| 18 | Can the operation safely retry? | Structurally no today: failed queue rows are terminal (`attempts` column exists but is never incremented/read; cron selects only 'pending'). A safe retry needs idempotency (see §9). |

### Additional traced behaviors worth recording

- **Webinar-vs-meeting semantics:** the system creates WEBINARS only (`type 5`). Handler matches `object.id` against the stored numeric `zoom_webinar_id`. Per Zoom's documented webhook payloads `object.id` is the meeting/webinar NUMBER for recording events, but this exact equivalence must be captured once with a real signed event in 8E before trusting the pipeline (any regular-meeting cloud recording on the same account will fail the lookup and hit F1 below).
- **Provider policy compatibility:** cron still calls `resolveUploadProvider(batchIds)` — signature retained for compatibility; under the 7E policy batch numbers are ignored and result is `bunny` or visible 503 (never silent Mux). Mux rollback switch (`VIDEO_UPLOAD_PROVIDER=mux`) flows through this same call site and works unchanged.
- **Student visibility rule (verified):** `fetchRecordingsForStudent()` authorizes strictly via `recording_batches ∩ batch_students` with `status='ready'` (recordings.service.ts:1005–1053). Therefore the moment the cron links batches, the recording WILL appear to students as soon as Bunny flips it to ready — there is **no review gate** on the automatic path today.

---

## 3. Existing Queue/Job Architecture Summary

| Aspect | State |
|---|---|
| Transport | Supabase table `upload_queue`, polled by cron every 120 s, batch 3 |
| States written by code | `pending`, `processing`, `done`, `failed` |
| States allowed by intended CHECK (stale schema.sql; live constraint NOT verifiable via REST) | `pending`, `processing`, `done`, `failed`, `expired` |
| Attempts/backoff | Column exists; unused. Failed = terminal. Expired URLs are skipped silently (stay pending forever). |
| Idempotency | None |
| Observability | Logger lines only; no system_events/system_errors writes; no admin-facing queue view |
| Index | `idx_upload_queue(status)` defined in stale schema.sql only — live existence unverified |
| Tests | **Zero** for `recording-upload.job.ts` (only `recording-cleanup.job.spec.ts` exists) |

---

## 4. Trimming Feasibility (Phase 8C investigation)

### Option A — Zoom-side trimming
Admin trims in Zoom's cloud-recording UI; LMS ingests whatever Zoom then serves.
- **Repo evidence:** nothing in the integration references trimmed/revised recordings; the handler reads `download_url` straight from the webhook.
- **Technical reality:** Zoom's trim feature historically produces a revised *playback* version, and whether the webhook `download_url` serves trimmed media depends on Zoom account/UI behavior that has changed over time. **This cannot be proven from the repository or docs available here — it requires one live experiment (trim a recording, fire a fresh webhook/fetch, compare durations).**
- Verdict: **DO NOT implement Option A until that live proof exists.** Faking it would silently publish untrimmed content.

### Option B — LMS-side FFmpeg
Download original → transcode/copy-trim → upload to Bunny.
- Repo has **no ffmpeg dependency**; API is a long-lived Node process (Render-style deployment assumptions in skills). Multi-hundred-MB…GB downloads through the API process add RAM/disk/timeout risk, plus temp-file security/cleanup concerns, plus a second upload hop (LMS egress cost).
- Feasible later as an isolated worker step ONLY if product demands physical trimming; not required for the core pipeline.

### Option C — Bunny-side processing
Verified Bunny surface in this repo (create/fetch/status/delete/signing) exposes **no trim/transcode-range API**, and official Stream docs expose no trim endpoint either. Verdict: **cannot do exact trimming in Bunny today. Do not assume otherwise.**

### Option D — Metadata trim (trim_start/trim_end at playback)
Technically compatible with HLS only as a client-side clamp (player redesign risk, violates "don't touch player" unless minimal) and provides **zero content protection** — full media remains on the CDN and reachable by any authorized viewer who bypasses the clamp. For private-disclosure protection this is presentation, not trimming.

### Recommendation (to validate in design gate)
Ship Phase 8 **without trimming** (pipeline reliability first): `Zoom → queue → Bunny → ready → admin review → assign/publish`. Record the trim decision as a follow-up gated on the Option-A live experiment; if physical trimming becomes mandatory, revisit Option B as an isolated external step. This matches the user's stated safest target.

---

## 5. Database Relationships (live-verified via PostgREST OpenAPI introspection)

```
live_sessions (0 rows)                session_batches PK(session_id,batch_id)   (0 rows)
  pk id                                 fk → live_sessions.id, batches.id
  fk teacher_id → profiles.id
        │ 1:N                                     │ N:1
        ▼                                         ▼
upload_queue (0 rows)                                   recording_batches PK(recording_id,batch_id)
  pk id                                                   fk → recordings.id, batches.id
  fk session_id → live_sessions.id  【NOT NULL】            assigned_at NOT NULL
  zoom_download_url NOT NULL                                    │
  zoom_url_expires_at NOT NULL                                  ▼
  status NOT NULL (text)                              recordings (12 rows — all legacy mux:ready)
  mux_asset_id nullable                                 pk id
  error_message nullable                                fk session_id → live_sessions.id (nullable)
  attempts NOT NULL (int)                               fk topic_id → topics.id
  created_at/updated_at NOT NULL                        title,status NOT NULL; provider NOT NULL
                                                        mux_asset_id/mux_playback_id/mux_upload_id slots
batch_recording_curriculum (2 rows)                     cleanup_pending/retry_count/cleanup_failed
  pk id; fk batch_id→batches.id                          NOT NULL defaults; sort_order NOT NULL
  fk recording_id→recordings.id
  UNIQUE-ish conflict target used by code: (batch_id,content_id,content_type)
```

Key hard facts:

1. **`upload_queue.session_id` is NOT NULL in the live DB** (present in OpenAPI `required`). The handler inserts `session_id: sessionId` where `sessionId` may be `null` (unknown webinar) → **insert always fails 23502 for unmatched events**, swallowed by the outer catch. Unmatched recordings are silently lost with one log line.
2. `recordings.provider` NOT NULL DEFAULT 'mux' (migration 035 semantics confirmed present).
3. `recordings.session_id` is nullable — manual uploads legitimately have NULL session.
4. No column anywhere stores Zoom meeting UUID / recording UUID / file id → **idempotency currently impossible without additive migration.**
5. `upload_queue` DDL is absent from migration history 004–035 → drift hazard exactly of the class the schema-drift skill warns about. Any Phase 8 schema change must come as a new migration that also documents/normalizes this table.
6. CHECK constraints and indexes cannot be introspected via REST — same ops caveat as Phase 7E's `recordings_provider_check`. Must be confirmed in Supabase SQL editor before writing new status values.

---

## 6. Failure Modes (current system)

| # | Scenario | Current outcome | Severity |
|---|----------|-----------------|----------|
| F1 | Webhook for unknown/unmatched webinar (or object.id ≠ numeric ID) | insert violates NOT NULL → outer catch logs → **event lost, no record** | P0 |
| F2 | Duplicate `recording.completed` (Zoom at-least-once, or stop/start produces multiple instances) | duplicate jobs → duplicate Bunny assets → duplicate recordings, all batch-linked | P0 |
| F3 | Transient failure (Zoom token, Bunny 5xx, network) | queue row terminal 'failed'; `attempts` unused; **no retry** | P0 |
| F4 | Bunny fetch accepted but pull later fails | recordings → 'failed' via webhook; queue says 'done'; no retry/source-retention | P1 |
| F5 | Final queue-status update fails after recording creation | stuck 'processing' queue row; recording actually fine (log-only) | P2 |
| F6 | First-MP4 heuristic picks wrong/partial file (separate views on; file status ≠ completed) | wrong media ingested | P1 |
| F7 | Auto-link of ALL session batches + no curriculum entries + **no cache invalidation** + title hardcoded 'Recording' | violates curriculum-sync invariant; invisible/odd in curriculum views; stale Redis list caches; poor titles; **auto-publishes to students with no review** | P0 (design) |
| F8 | Zoom URL expiry (20 h guess) elapses before cron tick | job skipped silently, stays 'pending' forever | P2 |

---

## 7. Security Review

| Check | Status |
|---|---|
| Zoom webhook signature (v0 HMAC, rawBody, replay window) before ANY processing | ✅ wired (controller → service), challenge path exempt by design |
| Unauthenticated ingestion impossible | ✅ unsigned events get 200-and-ignore (never processed) |
| Zoom credentials server-side only | ✅ env-only; OAuth token appended server-side, never sent to browser |
| Zoom download URL + access_token persisted at rest in `upload_queue.zoom_download_url` | ⚠️ acceptable short-term (URL dies ~24h) but is credential-bearing data in DB/logs — avoid logging full URL; consider post-success scrubbing in Phase 8C |
| Bunny webhook HMAC v1 + foreign-library rejection + provider-scoped mutations | ✅ (7C/7E verified, unchanged) |
| Bunny keys/TUS presigning/playback signing server-side | ✅ unchanged |
| Playback authorization unchanged (validateAccess → recording_batches; Redis tokens) | ✅ untouched by this phase's surface |
| Cross-batch leakage via auto-pipeline | ⚠️ inverse risk: it UNDER-shares by default only if review-gate added; today it OVER-shares (F7 auto-publish). recording_batches stays source of truth either way |
| Student-facing IDs | no new student routes proposed; ingestion is admin/system-only |

---

## 8. Test Coverage Gap Analysis

| Area | Today | Required by Phase 8 |
|---|---|---|
| `ZoomWebhookHandler` | 4 tests (join/left/ended/queue happy path; no-MP4 ignore) | invalid signature path (controller-level), duplicate event, unknown session, multi-file selection, file-status filter, topic capture |
| `RecordingUploadJob` | **none** | job creation, idempotency, retry/attempts, curriculum sync, cache invalidation, failed-download & failed-Bunny paths |
| Batch propagation | covered only for manual `assignToBatches` (e2e assignment.spec) | 1 batch / multi-batch / zero-batch propagation from `session_batches` |
| Provider switch | resolver spec covers bunny-first + dormant mux | keep green; assert cron inherits policy |
| E2E | no zoom/upload_queue specs | live-class→recording→batch; duplicate-webhook dedupe; manual-upload regression; cross-batch isolation; failure→retry |

---

## 9. Recommended Architecture (for Phase 8C approval)

**Principle: connect existing systems; no parallel subsystems; no player change; Mux untouched; manual upload untouched.**

```
Zoom webhook (verified)
   ↓
ZoomWebhookHandler.recording.completed  (hardened)
   - select best file: file_type='MP4' AND status='completed' (prefer combined/largest)
   - resolve session: zoom_webinar_id = object.id  (fallback matching strategy TBD in 8E capture)
   - IDEMPOTENT upsert into upload_queue keyed on
     (zoom_meeting_uuid, zoom_recording_file_id)   ← NEW additive columns + partial unique index
     duplicate delivery ⇒ no-op (same job row returned/kept)
   - unmatched session ⇒ queue row still recorded with explicit
     status 'failed'/'skipped' + error_message (needs session_id NULLABLE migration)
   - capture object.topic as proposed title
   ↓ (unchanged trigger)
RecordingUploadJob cron (hardened)
   - claim pending jobs (attempts < MAX, exponential backoff via updated_at)
   - increments attempts; transient vs permanent error classification
   - provider resolution UNCHANGED (bunny-first, visible 503, mux rollback switch)
   - Bunny fetch/pull UNCHANGED (server-side pull, no LMS bytes)
   - recordings row: real topic title, session_id link, provider slot (unchanged shape)
   - batch inheritance: DO NOT auto-write recording_batches.
     Persist session-derived batchIds on the queue/recording context instead;
     recording stays visible to admins as "Imported from Zoom · ready · unassigned".
   - reuse service-layer assignment for publication:
     admin clicks Assign/Publish → existing assignToBatches()
     (which already syncs batch_recording_curriculum) + cache invalidation
   - mark done; scrub credential-bearing URL field (optional hardening)
   ↓
Bunny webhook (unchanged) → status ready|failed (scoped, idempotent, duration backfill)
   ↓
ADMIN REVIEW (new minimal UI affordance on existing /admin/recordings)
   - badge "Imported from Zoom", edit title/category/batches, publish
   ↓
STUDENTS see it only after assignment (recording_batches — single source of truth, unchanged)
```

Rationale highlights:
- **Idempotency key:** `(meeting uuid, recording file id)` is the stable pair Zoom guarantees per file; webhook redelivery replays identical values. Meeting-number alone is insufficient (multiple recordings/instances share it).
- **Review gate WITHOUT touching authorization:** simply deferring `recording_batches` insertion to an explicit admin action preserves `recording_batches` as the sole authorization source — no new state machine on `recordings`, no CHECK-constraint changes, no student-visible draft concept.
- **Trimming:** excluded from scope pending the Option-A live proof (§4). Pipeline remains valid with or without a future trim stage inserted between "download/pull" and "Bunny".
- **Failure observability:** reuse existing `upload_queue` columns (`attempts`, `error_message`, `updated_at`) — no exotic states; respect the live status CHECK (values TBD-confirmed against SQL editor before coding).

Schema changes required (all additive, single migration `036-zoom-ingestion-hardening.sql`, rollback commented):
1. `ALTER TABLE upload_queue ALTER COLUMN session_id DROP NOT NULL;`
2. `ADD COLUMN zoom_meeting_uuid text`, `ADD COLUMN zoom_recording_file_id text`, `ADD COLUMN zoom_topic text`, `ADD COLUMN batch_ids jsonb` (session-derived, pre-computed at webhook time)
3. Partial unique index `ON upload_queue(zoom_recording_file_id) WHERE zoom_recording_file_id IS NOT NULL`
4. Confirm/normalize `status` CHECK + `idx_upload_queue_status` (documented out-of-band DDL brought into migration history)

---

## 10. Implementation Plan (post-approval, Phase 8C–8F)

| Order | Task | Gate |
|---|---|---|
| 1 | Ops check: live CHECK constraints/indexes on `upload_queue` (SQL editor screenshot/evidence into report) | schema-drift rule |
| 2 | Migration 036 (additive; deploy BEFORE API deploy) | migration-first rule |
| 3 | Harden `ZoomWebhookHandler` (file selection, idempotent upsert, unmatched-session row, topic capture) | unit specs |
| 4 | Harden `RecordingUploadJob` (retry/backoff/attempts, curriculum-synced publication path via existing service methods, cache invalidation, real titles) | unit specs |
| 5 | Admin affordance: "Imported from Zoom" indicator + assign/publish using EXISTING endpoints/components (no new subsystem) | browser verify |
| 6 | E2E: 5 scenarios listed in §8 | playwright |
| 7 | Live verification with real configured Zoom/Bunny where safe (signed webhook capture → confirm object.id semantics + download-URL TTL + scope) | 8E |
| 8 | Report `rccf-phase8-zoom-recording-ingestion-report.md` | RCCF step 10 |

Estimated effort: 3–5 days including tests and live verification.

## 11. Tests Required (summary)

Unit: handler matrix (valid/invalid-signature-at-controller/duplicate/unknown-session/no-MP4/multi-file/status-filter/topic) · job matrix (claim/idempotency/retry/curriculum/cache/failures) · batch propagation (1/N/0) · provider switch regression.
E2E (DB-backed, stateful, self-cleaning): T1 live class → recording → correct batches pending assignment · T2 duplicate webhook → ONE job/recording · T3 manual upload regression (upload→ready→assign→authorized) · T4 cross-batch isolation (A yes / B no) · T5 failure → retry → success.
Browser: manual modal (progress/processing/ready/publish) + Zoom-imported card (badge/edit/assign/publish) + student visibility only post-publish; 1440/768/390 px, console clean.

## 12. Rollback Plan

- Code: revert is self-contained (handler/job/admin badge); no player/auth/curriculum architecture touched.
- Schema: migration 036 is additive (`DROP NOT NULL`, added nullable columns, partial index) — rollback script drops columns/index and restores NOT NULL once no null rows exist (documented in migration header).
- Provider: `VIDEO_UPLOAD_PROVIDER=mux` emergency switch untouched and exercised by existing E2E.
- Feature kill-switch option: pause ingestion by suspending the cron registration behind an env flag introduced in step 4 (default-on preserves current behavior).

## 13. Audit Verdict

The Zoom→recording skeleton ALREADY EXISTS end-to-end (webhook → queue → cron → Bunny fetch → webhook → playback) but is **pre-production**: silent loss on unmatched sessions (NOT NULL collision), zero idempotency, zero retry, curriculum-sync violation, auto-publish without review, hardcoded titles, no tests for the worker, and the pipeline's own table missing from migration history. Trimming is NOT safely achievable through Zoom (unproven), Bunny (unsupported), or metadata clamps (non-protective) today — ship the reliable pipeline first, defer trim behind the Option-A live experiment.

**Recommendation: proceed to Phase 8C implementation per §9/§10 after approval. CONDITIONAL GO for the design; NO-GO for trimming in this phase.**

---

_Audit only — no application code modified. Live-DB facts above were gathered via read-only PostgREST introspection._
