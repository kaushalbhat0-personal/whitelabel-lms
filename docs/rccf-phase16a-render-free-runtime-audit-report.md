# RCCF Phase 16A — Render Free Production / Runtime Audit Report

**Date:** 2026-09-16 (read-only audit, no code/deploy changes)
**Auditor model:** muse-spark-1.2 — READ / RECON / VERIFY / RISK CLASSIFICATION / DEMO SAFETY ASSESSMENT
**Scope:** `lms-platform` monorepo at `E:\Money Craft Trader\All Work\Automations\mctlms\lms-platform` — `apps/web` (Next.js 14, Vercel) + `apps/api` (NestJS 10, Render) against **Render Free** constraints.
**Assumption under audit:** backend on **Render Free Web Service** unless repo/deployment config proves otherwise. No `render.yaml`, no `Dockerfile` found — platform config is dashboard-managed (confirmed via `docs/rccf-final-production-deployment-report.md:181`, `docs/rccf-phase10b-production-deployment-report.md:39`).

---

## 1. Executive Summary

**The current low-cost Vercel + Render Free architecture is safe for tomorrow's demo with operational precautions.** No P0 (demo-blocker / data-loss) issue was found. One P1-class risk exists only if Redis is unreachable at cold-boot, and it is mitigated by the same 30 s `fetchApi` timeout + `AuthProvider` timeout/ retry path the frontend already uses — it surfaces as a ~60 s delay, not silent data loss.

- **Webhooks:** all three providers (Zoom, Bunny, Mux) are correctly `@Public()` + HMAC-against-`req.rawBody` + idempotent + monotonic. No webhook requires an always-on worker; the HTTP-triggered NestJS path is sufficient on Free. Zo om `recording.completed` enqueues to `upload_queue`; Bunny mutates to `ready/failed` with `provider='bunny'` scope. Duplicate delivery is handled at the DB unique-index level.
- **Background jobs:** three in-process `@Cron` jobs (`RecordingUploadJob` every 2 min, `RecordingCleanupJob` every 15 min, `OutboxService` every 30 s) run inside the **single Render Web Service** via `@nestjs/schedule` (`apps/api/src/app.module.ts:110-111`). No `Bull/BullMQ`, no external worker, no one-off jobs. On Free this means jobs **pause while the service sleeps** and **resume on wake** — which is acceptable for the demo and correctly made idempotent. The only demo-relevant background path, `BulkUploadService.processJobInBackground`, is **not** a cron — it is a fire-and-forget promise inside the request process and is therefore the one job with a restart-during-processing risk (see §7).
- **Cold start:** expected wake is ~60 s (`Render Free Facts`). Frontend `fetchApi` timeout is 30 s (`apps/web/src/lib/api-client.ts:44`, AbortController), `AuthProvider` has a 5 s boot-timeout guard (`apps/web/src/components/providers/AuthProvider.tsx:21,108`), and every demo-critical read (`/auth/login`, `/auth/validate-session`, `/auth/me`, `/recordings/my`, `/courses/my`, `/live-sessions/my`, `/recordings/:id/play`) goes through `fetchApi`. Cold start is thus a **delay/retriable 408**, not a broken auth state. No keep-alive hack is added per audit scope.
- **Filesystem:** no persistent disk use. Only `fs.readFileSync` for Handlebars templates (`apps/api/src/modules/invoices/invoices.service.ts:195-223`, `apps/api/src/modules/achievements/achievements.service.ts:384-390`) and optional `PUPPETEER_EXECUTABLE_PATH` checks (`apps/api/src/modules/pdf/pdf-generation.service.ts:97-112`). Multer holds uploads in memory (`Express.Multer.File.buffer`). Persistent business state lives in Supabase / Redis / Bunny / Supabase Storage — consistent with ephemeral filesystem.
- **Memory/CPU:** the only heavyweight runtime dependency is `puppeteer@25.1.0` (`apps/api/package.json:34`). It is **lazy-launched** on `onModuleInit` and health-checked before each PDF (`apps/api/src/modules/pdf/pdf-generation.service.ts:20-95,114-140`); invoice/receipt generation is admin-only. `xlsx`/`papaparse` are bounded by small chunked parsing. No video bytes are proxied through the API (`video.bunnycdn.com/tusupload` direct browser → Bunny).
- **Auth/CORS/Redis:** `POST /auth/login` sets `access_token` as `{ httpOnly:true, secure:true, sameSite:'none' }` (`apps/api/src/modules/auth/auth.controller.ts:59-65`). CORS is `origin: [FRONTEND_URL, 'https://mctlms-web.vercel.app']` with `credentials:true` (`apps/api/src/main.ts:33-36`). Redis is required for login/session: `JwtAuthGuard` hard-fails to `401` if the `user_session:{userId}` key is missing (`apps/api/src/common/guards/jwt-auth.guard.ts:76-89`). A Redis outage is therefore a hard auth failure, not a silent degradation.
- **Verdict:** **DEMO GO WITH OPERATIONAL PRECAUTIONS** — one manual warm-up and a keep-alive tab, avoid bulk invoice PDFs during the live demo, keep the API awake between flows.

---

## 2. Current Architecture (actual repo)

### Frontend — Vercel

- `apps/web/package.json:6-8` — `next@14`, `react@18`, `zustand`, `axios`, `hls.js@1.6`, `@mux/mux-player-react@3`, `@supabase/ssr`, `zod`, `sonner`
- Build: `vercel.json:1-3` `{ "framework":"nextjs" }` — Vercel auto-detects Next.js, no custom `buildCommand` in repo. Root `package.json:7` `pnpm -r build` parity.
- Runtime: Next.js App Router with `export const dynamic='force-dynamic'` + `force-dynamic` server pages that call `fetchApi()` + client components. Middleware (`apps/web/src/middleware.ts` + `apps/web/src/lib/guards/middleware-guard.ts`) decodes JWT from `access_token` cookie for path gating (`/student/*` requires `role=student`). `fetchApi` (`apps/web/src/lib/api-client.ts`) reads `access_token` from cookie (or `localStorage['session_persistence']` fallback) → `Authorization: Bearer`, enforces `TIMEOUT_MS=30_000` via `AbortController`, unwraps `{ success, data }` once (`ResponseTransformInterceptor`), and on `401` re-validates via `GET /auth/validate-session` before force-redirecting to `/login`.
- Env: `NEXT_PUBLIC_API_URL` (fallback `http://localhost:3001`) used in `api-client.ts:43`, `auth-validation.ts:1`, `AuthProvider.tsx:20`, `file-dropzone.tsx:8`.
- SSR pages inspected: `apps/web/src/app/student/page.tsx` — five parallel `Promise.all([getMyCourses(), getMySessions(), getMyVideos(), getMyResults(), getMyPaymentPlans()])` each `.catch(()=>fallback)` so a single endpoint timeout does not cascade the whole dashboard to 500.

### Backend — Render Web Service (NestJS)

- `apps/api/package.json:5-9` — `start:dev: nest start --watch`, `build: nest build`, `start: node dist/main`. No Dockerfile in repo; platform build/start commands are dashboard-managed (assumed `pnpm build` / `node dist/main`).
- Entry: `apps/api/src/main.ts:21-51` — `NestFactory.create(AppModule, { rawBody:true })`, `enableCors`, `ValidationPipe`, `listen(port, '0.0.0.0')` (port from `ConfigService.get('PORT') ?? 3001`).
- `apps/api/src/app.module.ts:16-177` — `ConfigModule.forRoot(isGlobal, envFilePath '.env')`, global `JwtModule`, `RedisModule.forRootAsync({ host, port, password, tls: password? {}:undefined })` via `REDIS_*` env, `ScheduleModule.forRoot()`, 34 feature modules, global `JwtAuthGuard` → `RolesGuard` (in that order), `HttpExceptionFilter`, `ObservabilityInterceptor` + `ResponseTransformInterceptor`.
- Health: `apps/api/src/app.controller.ts:6-16` — `@Public() @Get() @Get('health')` returns `{ status:'ok', service:'mct-lms-api', version:'current', timestamp: ISO }`. Suitable as a wake-ping.
- Node version: pinned by `pnpm@11.8.0` + `typescript@5` but no `.nvmrc`/`engines` pin found — Render will use its default Node (verify dashboard is 20.x).

### External Services — dependency map

| Service | Client library / location | Auth | Sync / Async | Backend must dial outbound? |
|---|---|---|---|---|
| Supabase Postgres | `@supabase/supabase-js` via `SupabaseService` (`apps/api/src/common/services/supabase.service.ts`) — `client` (service_role, RLS bypass, no autoRefresh) + `authClient` (anon) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | synchronous per request | yes, HTTPS (443) |
| Redis | `ioredis@5` via `@liaoliaots/nestjs-redis` + `RedisCacheService` | `REDIS_HOST/PORT/PASSWORD`, TLS when password set (`apps/api/src/app.module.ts:98-107`) | sync, many calls per request | yes, TCP 6379 (or TLS) |
| Bunny Stream | `axios` in `BunnyProvider` (`apps/api/src/modules/video-provider/providers/bunny.provider.ts:282-295`) | `BUNNY_API_KEY` (`AccessKey`), `BUNNY_TOKEN_SIGNING_KEY`, `BUNNY_CDN_HOSTNAME` | sync on `createDirectUpload` / `createAssetFromSource` / `getAssetStatus` / `deleteAsset`; async `getPlaybackUrls` signing | yes, `https://video.bunnycdn.com` |
| Mux (legacy) | `@mux/mux-node@8` via `MuxService` | `MUX_TOKEN_ID/SECRET`, `MUX_SIGNING_KEY_ID/PRIVATE_KEY`, `MUX_WEBHOOK_SECRET` | sync on `createUploadUrl` / `uploadFromUrl`; async `getSignedPlaybackUrl` | yes, `https://api.mux.com` (only for legacy rows & rollback) |
| Zoom | `axios` in `ZoomService` | `ZOOM_ACCOUNT_ID/CLIENT_ID/SECRET`, `ZOOM_WEBHOOK_SECRET`, `ZOOM_SDK_KEY/SECRET` | sync on `createWebinar`/`registerAttendee`/`deleteWebinar`/OAuth token fetch | yes, `https://zoom.us/oauth/token`, `https://api.zoom.us` |
| Resend | `resend@6` in `EmailService` — HTTPS only | `RESEND_API_KEY`, `EMAIL_FROM` | async fire-and-forget, `outbox` retry | yes, `https://api.resend.com` (port 443) — **not SMTP 25/465/587**, so Free SMTP block does not apply |
| Supabase Storage | `supabase-js storage` in `InvoicesService.uploadPdf` | same Supabase keys, bucket `invoices` | sync after PDF generation | yes, HTTPS |

GoDaddy: domain `mctlearn.com` ownership only — no hosting/DNS migration needed.

---

## 3. Render Free Constraints (platform truth used for this audit)

| Constraint | Value | Source |
|---|---|---|
| RAM | 512 MB | Render Free docs |
| CPU | < 1 CPU | Render Free docs |
| Spin-down | after ~15 min no inbound traffic | Render Free docs |
| Wake | ~60 s | Render Free docs |
| Free hours | 750 instance-hours/month | Render Free docs |
| Filesystem | ephemeral, no persistent disk | Render Free docs |
| No SSH | yes | Render Free docs |
| No one-off jobs | yes | Render Free docs |
| No scaling | single instance | Render Free docs |
| No private inbound | yes | Render Free docs |
| May restart | yes | Render Free docs |
| May suspend on unusually high public traffic | yes | Render Free docs |
| Free Web Services **cannot send SMTP on 25/465/587** | yes | Render Free docs |
| "Not intended for production" | disclaimer, not a functional block | Render Free docs |

---

## 4. Runtime Compatibility Matrix

| Area | Current implementation | Render Free limitation | Risk | Demo impact | Recommendation |
|---|---|---|---|---|---|
| **Cold start** | Nest boot + Supabase + Redis connect + Chromium-absent puppeteer lazy-launch (`apps/api/src/modules/pdf/pdf-generation.service.ts:114-140`). Frontend `fetchApi` 30 s abort + `AuthProvider` 5 s boot guard. `GET /health` is public. | 15 min sleep + ~60 s wake; single instance may restart | **P1-edge** — only if Redis unreachable at wake (see §8) | First login/dashboard can 408/timeout; `AuthProvider` shows `Authentication timed out` + retry → harmless delay if pre-warmed | Manual warm-up §15; keep browser tab polling heartbeat (§15) |
| **Zoom webhook** `POST /zoom/webhook` | `@Public() @Res()`, rawBody HMAC verify, 200 always, idempotent enqueue to `upload_queue` by `zoom_recording_file_id` (`apps/api/src/modules/zoom/zoom.controller.ts:119-166`, `zoom-webhook.handler.ts:237-412`) | Must be reachable within provider retry window | **LOW** — Zoom retries on non-2xx only; sleep delays delivery but does not lose it | None for demo — no live Zoom event required | No change |
| **Bunny webhook** `POST /bunny/webhook` | `@Public()`, HMAC v1 `X-BunnyStream-Signature`, library-id filter, provider-scoped `provider='bunny'` updates, `invalidateRecordingsCache()` (`apps/api/src/modules/video-provider/bunny-webhook.controller.ts:49-191`) | Same: sleep delays delivery; 401 on bad sig | **LOW** — idempotent, intermediate statuses ignored, duration backfill best-effort | New Bunny uploads stay `processing` until webhook arrives — acceptable for demo if using seeded `ready` recordings | Ensure `BUNNY_WEBHOOK_SECRET` matches library Read-Only key |
| **Mux webhook** `POST /mux/webhook` | `@Public()`, `mux-signature` HMAC, `req.rawBody`, always 200 (`apps/api/src/modules/mux/mux.controller.ts:40-192`) | Same as above | **LOW** — legacy path only | None — no new Mux uploads in prod policy | Keep alive for legacy rows |
| **Background jobs — `RecordingUploadJob`** `@Cron('*/2 * * * *')` | In-process, DB poll of `upload_queue`, reclaims stale `processing` after 30 min, `MAX_ATTEMPTS=3 BACKOFF [5,30]`, provider fetch `server→server` (no bytes through LMS) (`apps/api/src/jobs/recording-upload.job.ts:36-331`) | No worker while asleep; 2-min cadence pauses on sleep | **P2** — ingestion resumes on wake, resumable via `mux_asset_id` persistence, no duplicate Bunny import | No demo impact unless a fresh Zoom recording is expected live | Acceptable for demo |
| **Background jobs — `RecordingCleanupJob`** `@Cron('0 */15 * * * *')` | Every 15 min, `cleanup_pending=true` up to 20 rows, deletes via owning provider, `MAX_RETRIES=10` then `cleanup_failed=true` (`apps/api/src/jobs/recording-cleanup.job.ts:40-211`) | Same sleep pause | **P3** — admin delete without immediate provider cleanup stays `cleanup_pending` until next wake | Admin delete UX returns success before provider delete; demo should not delete recordings mid-demo | Not demo-critical |
| **Background jobs — `OutboxService`** `@Cron('*/30 * * * * *')` (every 30 s) | Polls `outbox_messages` where `status='pending'` (limit 10), calls `InvoicesService.createAndSend*` → PDF → Storage → email; `retry_count` → `failed` after 3 (`apps/api/src/modules/outbox/outbox.service.ts:35-119`) | Sleep stalls the 30 s poll; invoice email delayed ~90 s after wake (2 skeletons: 60 s wake + next 30 s tick) | **P2** — invoices/receipts are async; payment itself is synchronous | Do not generate bulk invoices live | Acceptable |
| **Bulk student upload** `POST /bulk-upload/students` | `processJobInBackground` fire-and-forget in-process (`apps/api/src/modules/bulk-upload/bulk-upload.service.ts:72-127`), `parseUsersFile` via `papaparse`/`xlsx` (`apps/api/src/common/utils/file-parser.util.ts:55-102`), `CHUNK_SIZE=5` `Promise.all` per chunk | If Render restarts mid-row, rows mid-flight are lost; job stays `processing` (no reclaim logic) | **P1 if demoing live bulk import of >50 rows during a restart window** — otherwise **P2** | Demo should poll `GET /bulk-upload/jobs/:id` and verify `completed` before proceeding | Do not bulk-import large files on stage; keep file to <50 rows if live |
| **Bulk invoice `bulkGenerate`** `InvoicesService.bulkGenerate:654-830` | Synchronous loop: `Papa.parse` → per-row `insert payments` → `createAndSendInvoice/Receipt` → `generatePdf(html)` → `uploadPdf` sequentially | Long synchronous request (>30-90 s for 10 rows with PDF+email) will exceed `fetchApi` 30 s and hold the single instance | **P2** — admin-only, long request, not demo-critical | Avoid during demo | No change needed |
| **Filesystem** | Template reads from `fs.readFileSync` (`invoices.service.ts:195-223`, `achievements.service.ts:384-390`), `puppeteer` checks `fs.existsSync` for chromium path (`pdf-generation.service.ts:97-112`), `multer` memory storage | Ephemeral disk, no persistent mount | **LOW** — no business state on disk; temp files only | None | No change |
| **Memory — Puppeteer** | `puppeteer@25` ~150-300 MB per browser, launched with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` (`pdf-generation.service.ts:116-123`), with `Browser disconnected → relaunch on next request`; `PDF_TIMEOUT 30 s` race | Free = 512 MB, single Chromium may push near limit | **P1 only under concurrent PDF burst**; demo single-invoice is safe | Avoid bulk PDF generation live | No code change; long-term move to paid or external PDF on high volume |
| **Memory — CSV/XLSX** | `xlsx@0.18.5` reads workbook into buffer (`file-parser.util.ts:73`), `papaparse` streams CSV; bulk-invoices re-parses with `papaparse` per request | Bounded by file size sent over wire | **LOW** at demo volumes (<1000 rows) | None | Keep files small live |
| **Redis** | `ioredis` via `@liaoliaots/nestjs-redis`, `RedisModule.forRootAsync({ tls: password? {} : undefined })` (`app.module.ts:97-107`), `RedisCacheService` swallows GET/SET failures → null/warn (`redis-cache.service.ts:20-36`), but `JwtAuthGuard` does **not** (`jwt-auth.guard.ts:76-89`), `LiveSessionsService` degrades (`live-sessions.service.ts:59-77`) | One instance, reconnect storms on wake, no private network | **P1 if Redis provider is unavailable/billed-down at wake** — startup will fail, all auth fails | Demo hard-fails if Redis down | Pre-flight §15: verify `REDIS_HOST` reachable and `PING` |
| **Supabase** | `SupabaseService.onModuleInit()` creates two clients; throws if URL/keys missing (`supabase.service.ts:31-40`); per-query error handling (`.single()` → `NotFoundException`) | Connection pooling is REST-over-PostgREST (no direct pg connection exhaustion concern) | **LOW** | None unless env mis-wired | No change |
| **Email** | Resend HTTPS `resend.emails.send` (`email.service.ts:44,100,164`); stub mode when `RESEND_API_KEY=re_xxxxxxxxxxxx` (`email.service.ts:38-41`) | Free blocks **only SMTP 25/465/587**, not HTTPS `api.resend.com:443`, so compliant | **P2** if `RESEND_API_KEY` missing → silent stub (no demo-visible failure except missing email) | Verify key live | No SMTP code — compliant |
| **Timeouts** | `fetchApi` 30 s abort (`api-client.ts:44,82`), `PdfGenerationService` 30 s `Promise.race` (`pdf-generation.service.ts:43-57`), `BunnyProvider.http` axios `timeout 30_000` (`bunny.provider.ts:258-259`), `AuthProvider` 5 s boot guard (`AuthProvider.tsx:108-116`) | Single-threaded, cold start ~60 s > 30 s timeout | **P1-edge** — first cold request 408 → `ApiError` → `AuthProvider.setAuthFailed` or 401 redirect, recoverable on retry | Demo first tap may show timeout — instruct to wait & retry | Match guidance in §16 |
| **CORS/Cookies** | `main.ts:33-36` `origin: [FRONTEND_URL, 'https://mctlms-web.vercel.app']`, `credentials:true`; login cookie `httpOnly secure sameSite:none` (`auth.controller.ts:59-65`); `middleware.ts` reads cookie only | `sameSite:none` requires `secure:true` → needs HTTPS (satisfied on Render+Vercel); `FRONTEND_URL` must equal `https://mctlms-web.vercel.app` (or mctlearn.com once cut over) | **LOW** if env is consistent | Mis-aligned `FRONTEND_URL` causes silent CORS failure | Verify `FRONTEND_URL=https://mctlms-web.vercel.app` in Render env |
| **Domain** | GoDaddy holds `mctlearn.com`; current prod frontend is `https://mctlms-web.vercel.app` (CORS, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`, Resend `EMAIL_FROM`) | No migration in this audit | **P3** | None tomorrow | Keep `mctlms-web.vercel.app` for demo; DNS cutover later |

---

## 5. Cold-Start Analysis

**Trigger:** 15 min without inbound traffic → Render Free suspends container → first inbound `GET /health` or authenticated call wakes it (~60 s observed platform behavior).

### Which demo flows hit the backend, and what a cold start does

| Flow | Backend call(s) | Requires wake? | Under 30 s `fetchApi` + 60 s wake | Frontend handling |
|---|---|---|---|---|
| Open LMS (`/login`) | none (static) — `middleware-guard.ts` does local cookie decode, no fetch | no | immediate | — |
| Student login `POST /auth/login` | Supabase auth + Redis `SETEX user_session:*` (`auth.service.ts:96-181`) | **yes** — first POST wakes | If 408: throws `ApiError Request timed out after 30s` (`api-client.ts:149-151`) → login form should surface error; user retries after ~30 s and hits warm instance | `AuthProvider` not yet loaded on login page |
| Dashboard `GET /student` | `Promise.all(5× fetchApi)` (`apps/web/src/app/student/page.tsx:20-26`): `GET /courses/my`, `GET /live-sessions/my`, `GET /recordings/my`, `GET /results`, `GET /payments/my` — each `.catch(()=>fallback)` | **yes** | Individual fetches that 408 return empty arrays; dashboard still renders with empty sections. `AuthProvider` hydrate path (`AuthProvider.tsx:148-153`) also validates `GET /auth/validate-session` with 5 s guard — on timeout it would `setAuthFailed` ("Authentication timed out") which is recoverable on refresh | Already resilient: `Promise.all` + `.catch` + `dynamic='force-dynamic'` |
| Batch visibility `GET /courses/my` → `GET /courses/:id` | `Supabase` + `batch_students` join, Redis not required beyond auth | yes | empty state on timeout | retry by nav |
| Recording list `GET /recordings/my` | `recordings.service.getRecordingsForStudent` + `RedisCacheService.wrap(key=cache:recordings:*)` (cache may be cold) | yes | cache miss → Supabase fallback; timeout yields empty list → user retries | non-blocking |
| Open recording / player `POST /recordings/:id/authorize` → `GET /recordings/:id/play?token=...` | `validateAccess(recording_batches)` + Redis `playback_token:*` + provider signing (Bunny 4 h token / Mux 60 s JWT) (`playback-guard.service.ts:51-166`) | yes | First `/play` may 408; player shows error, retry succeeds once warm. Thumbnail is signed separately but not needed for playback. | Player already shows `Unable to play video` + Retry (Phase 4) |
| Assessment list/open/submit | `tests/*`, `questions/*`, `attempts/*` (Redis for `attempt_timer`, `attempt_checkpoint` but sync fallback exists `attempts.service.ts:343-362`) | yes | Timeout → `ApiError` surfaced; `submitAttempt` is idempotent via `attempt.status` check | Non-auth Redis fallback degrades gracefully |
| Live class list `GET /live-sessions/my` | `getForStudent` (`live-sessions.service.ts:897-960`) | yes | empty on timeout → retry | resilient |
| Live class join `POST /live-sessions/:id/request-join` → `POST /live-sessions/:id/join` | Redis `join_token:*` + `join_token_index:*` (`live-sessions.service.ts:560-653`) | yes — Redis required; if Redis cold/unreachable token request fails visibly | 500/503 on Redis outage → user-retry after warm | Demo should not rely on live join unless Redis verified |
| Admin login / dashboard / recording list / batch management / student management / search | Same auth pipeline; admin dashboard `Promise.all([getReviewQueue, ...])` similar pattern (`apps/web/src/app/admin/page.tsx:24`) | yes | Same 30 s timeout, same retry | — |
| `GET /health` | `AppController.health()` (`apps/api/src/app.controller.ts:7-16`) — public, no DB/Redis | **designed wake probe** | Does not timeout frontend (curl fetch) | Use before demo |

**Does login/session-restoration break or merely delay?**

- `JwtAuthGuard` (`jwt-auth.guard.ts:58-104`) requires `Authorization: Bearer` + Redis session check. On cold start the JWT itself is still valid; the delay is purely network/wake latency, not invalid-signature. `AuthProvider` Phase 1 hydrates from `localStorage['session_persistence']` immediately without a network call if `timeLeft>0` (`AuthProvider.tsx:129-141`), so **returning students with a cached session see the dashboard skeleton instantly** even while the API wakes — background fetches fill in after warm.

**Frontend cold-start handling:** correct. Five-way `Promise.all(... .catch)` in `student/page.tsx:20-26`, `fetchApi` maxAttempts=2 for 401 re-validation (`api-client.ts:76-124`), `AuthProvider` 5 s guard with clear `setAuthFailed` message, and `axios` timeouts of 30 s for provider calls all mean a cold wake surfaces as a transient 408/ timeout that a refresh/retry resolves. No keep-alive ping is added (per instruction).

---

## 6. Webhook Analysis (CRITICAL)

### Zoom `POST /zoom/webhook`

- **URL / method:** `POST /zoom/webhook` (`zoom.controller.ts:120-166`), `@Public()`, `@Res()` manual `res.json()` bypassing `ResponseTransformInterceptor` (required for Zoom's `endpoint.url_validation` un-wrapped `{ plainToken, encryptedToken }` via `zoom.service.validateWebhookChallenge`).
- **Auth:** `verifyWebhookSignature(rawBody, x-zm-signature, x-zm-request-timestamp)` (`zoom.service.ts:343-389`) against `ZOOM_WEBHOOK_SECRET`. Missing header → `200 {success:true}` with warn (`zoom.controller.ts:140-145`). Bad sig → `200 {success:true}` with error log (no retry storm). **Raw body required:** `req.rawBody` via `rawBody:true` in `main.ts:26`; fork checks `if(!rawBody) 200`.
- **Processing:** delegates to `ZoomWebhookHandler.handle(event, payload.object, supabase)` (`zoom.controller.ts:160`). Synchronous work:
  - `participant_joined/left`: `select live_sessions by zoom_webinar_id` → `select profiles by email` → `upsert attendance` (fast, single DB round-trips).
  - `webinar.ended`: `update live_sessions status=ended` + `rpc mark_absent_for_session`.
  - `recording.completed`: see next bullet — **no heavy work**.
- **`recording.completed` (ingest path):** `selectZoomRecordingFile` filters `file_type==='MP4' && status==='completed'`, prefers largest `play_width×play_height`, dedupes by `zoom_recording_file_id` with `select upload_queue where zoom_recording_file_id = fileId` **and** unique index backstop (`23505`) (`zoom-webhook.handler.ts:304-351`). On unmatched session or no download URL → explicit `insert upload_queue status='failed'` with `safeErrorMessage` (observable, not silent drop). On success: **one DB insert** into `upload_queue` with `status='pending'` (expires in 20 h). The webhook never calls Bunny, never fetches bytes, never hits Redis. **Always-on worker not required.**
- **Max time:** < 1 s dominated by two Supabase selects + one insert. No `setTimeout`/`queue`.
- **Idempotency/duplicate:** double-deduped (pre-check + partial unique index `zoom_recording_file_id` where not null — see `recording-upload.job` reconciliation doc 8.16). Safe to redeliver.
- **Cold start / restart:** if Render wakes slowly, Zoom will retry (2xx policy). On retry the dedup row already exists → duplicate ignored. If Render restarts mid-handler, Postgres transaction for the single `insert` is atomic — no partial Bunny side-effect to clean up.
- **Depends on:** Supabase yes, Redis no, Bunny no.

### Bunny `POST /bunny/webhook`

- **URL / method:** `POST /bunny/webhook` (`bunny-webhook.controller.ts:49-119`), `@Public()`, returns `{ message:'ok' }`.
- **Auth:** `verifyWebhookSignature(rawBody, { version, algorithm, signature })` (`bunny.provider.ts:89-113`) — requires headers `X-BunnyStream-Signature-Version: v1`, `X-BunnyStream-Signature-Algorithm: hmac-sha256`, and 64-hex `X-BunnyStream-Signature`; source `HMAC-SHA256(rawBody, secret)` where `secret=BUNNY_WEBHOOK_SECRET` (library Read-Only API key). No timestamp/replay window (v1 limitation) — mitigated by monotonic status + HTTPS + `41599` bounce. `rawBody` preserved same as Mux via `main.ts`. Empty/oversized (`>64 KiB`) rejected with 401/warn.
- **Processing:** `JSON.parse(rawBody)` → require `VideoGuid + Status(number)` → foreign `VideoLibraryId` filter (`bunny-webhook.controller.ts:90-99`) → `webhookStatusToCanonical(status)` (3|4→ready, 5→failed, else processing/ignored) (`bunny.provider.ts:122-126`) → if terminal, `applyCanonicalStatus(videoGuid)`. Mutation is scoped `eq('provider','bunny').or(mux_asset_id.eq.guid, and(mux_asset_id.is.null,mux_upload_id.eq.guid))` — **never touches Mux rows**.
- **Max time:** one `select recordings maybeSingle()` + `update recordings` + `getAssetStatus` (only on ready, for `duration_seconds` backfill) + `delByPattern cache:recordings:*`. All < 2 s; provider GET is best-effort (swallowed on failure).
- **Idempotency:** re-delivery of `failed` when already `failed` is a no-op (early return `recording.status===canonical`). Ready→ready is a repeat update (safe, last-writer wins).
- **Cold start:** safe — second delivery fast-forwards; encode events arriving(seconds after upload) that land while slept are retried by Bunny and applied on wake.
- **Restarts mid-processing:** update is a single Supabase `update` — atomic. No double mutation.
- **Depends on:** Supabase yes, Redis (cache invalidation) soft-fail via warn, Bunny (duration backfill) soft-fail.

### Mux `POST /mux/webhook` (legacy)

- **URL/method:** `POST /mux/webhook` (`mux.controller.ts:40-192`), `@Public()`, always `200 { message:'ok' }` — never throws to Mux (otherwise Mux retries).
- **Auth:** `muxService.verifyWebhookSignature(rawBody, muxSignature)` (`mux.service.ts:397-433`) parses `t=timestamp,v1=hash`, timed-safe compare, depends on `MUX_WEBHOOK_SECRET`.
- **Processing:** four cases: `video.upload.asset_created` → `update recordings where mux_upload_id=uploadId`; `video.asset.ready` → `handleAssetReady` (+ optional `muxClient.video.assets.retrieve` for playbackId, `invalidateRecordingsCache`); `video.asset.errored` → `update status=failed`; `video.asset.deleted` → hard `delete recordings`. All provider-scoped correctly; unknown events are `debug` level.
- **Cold/restart/dedup:** same guarantees as Bunny; no heavy work; dormantly correct under Bunny-first policy.

### Any other provider webhook

- **Resend** `POST /email/webhooks/resend` (`email.controller.ts:42`) — delivery-event forwarder; resilient (soft).
- No payment webhook in scope (no Razorpay/Stripe handler found).

**Answer:** none of the Bunny/Zoom webhooks requires a persistent always-on worker. The Zoom hook is a fast enqueue; the Bunny hook is a fast DB flag + cache invalidation. Both are HTTP-triggered and correctly safe on Free.

---

## 7. Background Job / Queue Audit (CRITICAL)

No `Bull/BullMQ/@Processor/Queue` found — grep of 91 hits only shows `ScheduleModule`, `@Cron`, and queue-like **admin** `Review Queue` UI (not a job queue). Three real scheduled jobs + one implicit fire-and-forget pattern:

| Job | Trigger | Process type | Requires always-on? | Render Free safe? | Demo impact |
|---|---|---|---|---|---|
| `RecordingUploadJob.processPendingUploads()` (`jobs/recording-upload.job.ts:54`) | `@Cron('*/2 * * * *')` every 2 min + `isRunning` guard | **Async DB poll**: `select upload_queue where status in ('pending','failed') limit 20` → reclaim stale `processing` after 30 min → fetch Zoom OAuth token → per-row `fetch` from Zoom URL into Bunny via `provider.createAssetFromSource()` (server→server, bytes never through LMS) → persist `mux_asset_id` before `insert recordings` → `assignToBatches` (canonical, + cache invalidation) → `update upload_queue status=done` ; retries `MAX_ATTEMPTS=3` with `BACKOFF [5,30]`, expiry park after 20 h | No — пауза during sleep is acceptable; job is resumable: persisted `assetId` before `recordings` insert prevents duplicate Bunny import on crash, `reclaimStaleProcessing` recovers `processing` rows older than 30 min | **YES** — designed for sleep: processing resumes within 2 min of wake; no duplicate import; sleep simply delays which recording becomes `ready` | None unless demo depends on a just-finished Zoom webinar; use seeded `ready` recordings |
| `RecordingCleanupJob.processCleanupQueue()` (`jobs/recording-cleanup.job.ts:40`) | `@Cron('0 */15 * * * *')` every 15 min (sec=0) + `isRunning` guard | `select recordings where cleanup_pending=true and cleanup_failed=false` → `providerFor(recording).deleteAsset()` → `delete recordings row` ; on failure `retry_count++` → `failed` after 10 | No — best-effort delete; admin delete already returned success to UI before this runs | **YES** | Admin delete UX unaffected; provider orphan lives at most until next wake |
| `OutboxService.scheduledProcess()` (`modules/outbox/outbox.service.ts:35`) | `@Cron('*/30 * * * * *')` every 30 s + `isProcessing` guard | `select outbox_messages where status='pending' limit 10` → `createAndSendReceipt/Invoice` ( → `generatePdf(html)` → `uploadPdf` to Supabase Storage `invoices` → `insert receipts/invoices` → `resend.emails.send`) → `completed/failed` | No — invoice email is async by design; `payments` insert succeeded synchronously, email retries within `retry_count=3` | **YES** — delay (15 min sleep + 30 s tick) is the worst case; no data loss — enrollments work without the receipt email | Do not require PDF during demo; verify `max_retries` instead |
| `BulkUploadService.processJobInBackground()` (`modules/bulk-upload/bulk-upload.service.ts:77-127`) | **Not a cron** — fire-and-forget promise after `insert bulk_upload_jobs` in the **HTTP request** handler `POST /bulk-upload/students:POST` | `parseUsersFile` → per-chunk `Promise.all(5)` → per-row `auth.admin.createUser` → `upsert profiles` → `lookupBatchByName` → `assignStudentToBatch` → stub/welcome email; final `update bulk_upload_jobs completed` ; no stale-reclaim | **YES for durability** — if timer/where Render sleeps or Restart kills the in-flight `processJobInBackground`, rows mid-chunk are lost and job stays `processing` forever (no reclaim logic unlike `RecordingUploadJob`) | **P1 if demoing large live bulk import** — a restart mid-import silently stops processing | **Demo precaution:** if bulk import is shown live, keep to ≤50 rows and **poll `GET /bulk-upload/jobs/:jobId` to `completed`** before claiming success; have CSV ready pre-imported |
| `InvoicesService.bulkGenerate()` (`modules/invoices/invoices.service.ts:654-830`) | Synchronous **request handler** `POST /admin/invoices/bulk` | Sequential `insert payments` + `createAndSend*` (PDF+email+storage) per row | No (request-bound) | **NO at large N on Free** — will exceed `fetchApi` 30 s and starve the single instance (P2, not demo-critical) | Never run live on stage |

**Zoom recording ingestion attention row:** this is the job the demo must not stall — it is correctly synchronous **inside the web request only for manual upload** (`RecordingsService.createRecordingWithUpload` → `createDirectUpload` for Bunny TUS, one DB insert, no polling). The **Zoom-auto path** is *explicitly* decoupled (webhook enqueue → cron) and therefore naturally pause-tolerant on Free.

---

## 8. Filesystem / Storage Audit

Search surface: `fs.readFileSync`, `fs.existsSync`, `public/`, `uploads/`, `multer`, `/tmp`, `tmp`.

| Code location | What | Persistent state? | Free-safe? |
|---|---|---|---|
| `modules/invoices/invoices.service.ts:195-223` `readTemplate`, `modules/achievements/achievements.service.ts:384-390` | `fs.readFileSync(path.join(... , templates/*.hbs))` — Handlebars invoice/receipt/certificate templates bundled in repo/dist | **No** — templates ship with the release; read per request | YES — ephemeral reads of bundled files are allowed (the release image contains them). Render docs "ephemeral filesystem" only forbids **persistent** state. |
| `modules/pdf/pdf-generation.service.ts:97-112` `resolveExecutablePath()` | `fs.existsSync(PUPPETEER_EXECUTABLE_PATH)`, `/usr/bin/chromium`, `/usr/bin/chromium-browser` | No — path probe only | YES |
| `modules/bulk-upload/bulk-upload.service.ts`, `apps/api/src/common/utils/file-parser.util.ts` | `multer` memory storage (`file.buffer`) — no disk writes; `xlsx.read(buffer)` + `Papa.parse(csvString)` in memory | No | YES |
| Any `uploads/`, `public/`, `/tmp` writes | **None found**. `docker-compose.yml` mounts `redis-data` (dev only), not API writes. | — | — |
| Generated files (PDF, CSV exports, certificates) | PDFs generated in memory (`Buffer.from(page.pdf())` → `Buffer→base64` attachment) and **uploaded to Supabase Storage bucket `invoices`** (`storage.from('invoices').upload` + `createSignedUrl 7 days`) in `invoices.service.ts:260-286`. Never written to `public/` | **Persisted in Supabase Storage**, not on disk | YES — correct |
| Recordings | Bunny Stream storage + DB (`recordings.mux_asset_id`). Zero bytes through Node heap on Zoom import (server→server `video.bunnycdn.com/fetch`). | Bunny + Supabase | YES |
| Reports/tests artifacts | Playwright + coverage artifacts in dev | Not production | YES |

**Principle:** persistent business data = Supabase + Redis + Bunny + Supabase Storage. Local disk is only read of bundled assets and transient `Buffer`s within one request — compliant with ephemeral filesystem.

---

## 9. Memory / CPU Analysis

Render Free: **512 MB RAM, <1 CPU**. Only runtime heap matters (not dev tooling). Assessment based on actual call sites, not existence of packages.

| Operation / import | Import retained? | Call site | Bounded? | Classification | Notes |
|---|---|---|---|---|---|
| `puppeteer@25.1.0` Chromium | yes — `apps/api/package.json:34` + `pdf-generation.service.ts` | `onModuleInit launchBrowser`, `generatePdf: newPage → setContent → page.pdf()` (`pdf-generation.service.ts:36-73`), used by `InvoicesService.createAndSendReceipt/Invoice` (`invoices.service.ts:176,526`) and achievements | **One shared `Browser`**, one `Page` per PDF, with 30 s `Promise.race`, `Browser.disconnected`→ null → relaunch | **P1 under concurrent burst, LOW for demo** | 512 MB is tight for Chromium (~150-250 MB per browser + page heap). Free is safe for **one PDF at a time** (demo: single receipt/invoice). A bulk of 10 concurrent PDFs will push toward OOM. Mitigation: serialize bulk sequentially (current `bulkGenerate` does) and never trigger burst during demo. Long-term on paid: external PDF service or `--single-process` on a 1 GB instance. Startup crash is already mitigated: `launchBrowser().catch` → `browserAvailable=false` → `generatePdf` throws visible `PDF generation unavailable` (`pdf-generation.service.ts:135-139`) instead of crashing boot. |
| `xlsx@0.18.5` + `papaparse@5.5.3` | yes — `package.json:33,39` | `file-parser.util.ts:55-82` (students), `invoices.service.ts:654-673` (bulk invoices re-parses via `require('papaparse')`) | `CHUNK_SIZE=5` parallel for students, sequential for invoices; sheet `= sheet_to_json` reads entire sheet into array | **LOW** (<512 KB per doc at <1000 rows), **MEDIUM** only if >10k row file on stage | Keep demo CSV to <500 rows; real large imports should be chunked/paginated already (service does) |
| `handlebars@4.7.9` | yes | Compile invoice/receipt templates (`Handlebars.compile(templateSource)` per PDF) + achievements | Small string compile per request | **LOW** | — |
| Large Supabase reads | `supabase-js` query building | `live-sessions.service.ts:149-176` `Promise.allSettled` fan-out per batch, `attempts.service.ts` per-question N+1 `resolveMarksMap().in(questionIds)` | `limit 20` paginations (`findAll`), `getActiveJoins` bounded `SCAN MATCH COUNT 100`, `upload_queue limit 20`, `cleanup limit 20`, `outbox limit 10` | **LOW** | No unbounded `select *` except for dashboard single-user joins (scoped by `userId`), correct |
| Analytics / global search / certificates | `analytics.module`, `GlobalSearch.tsx` debounce 300 ms, `attempts analytics` | All bounded/paginated; admin visuals fetch limited counts | **LOW** | — |
| Mux import | `@mux/mux-node@8` | Only when `VIDEO_UPLOAD_PROVIDER=mux` or legacy rows | Not on default prod push | **LOW** | — |

**No import-time large lib penalty beyond Puppeteer:** the audit finds no `sharp`, `ffmpeg`, `canvas`, or server video transcoding.

---

## 10. Request Time / Timeout Audit

| API request | Duration driver | External deps | Sync & held? | User waits? | Idempotent? | Free risk |
|---|---|---|---|---|---|---|
| `POST /auth/login` | Supabase `auth.signInWithPassword` + profile select + Redis `SETEX ×2 (+ del old)` (`auth.service.ts:96-176`) | Supabase + Redis | yes | yes | no (creates new `sessionId`) | LOW — <1 s |
| `GET /auth/validate-session` | Redis GET of `user_session:*` | Redis | yes | yes (poll + boot) | yes | LOW — <50 ms |
| `GET /recordings/my`, `/courses/my`, `/live-sessions/my` | Supabase selects + Redis `wrap` | Supabase (+Redis cache) | yes | yes | yes | LOW — <500 ms warm |
| `POST /recordings/:id/authorize` → `GET /recordings/:id/play?token=` | `validateAccess` (Supabase) + Redis `playback_token` + `providerResolver.providerFor().getPlaybackUrls` (Bunny HMAC signing or Mux JWT) (`playback-guard.service.ts:130-166`, `bunny.provider.ts:202-240`) | Supabase + Redis + HMAC (local) — no Bunny API GET unless duration backfill (webhook only) | yes | yes (player) | yes (token extend) | LOW |
| `POST /live-sessions` (admin create) | `ZoomService.createWebinar` + per-student `registerAttendee` loop + `insert session_batches` + `insert session_registrants` (`live-sessions.service.ts:97-259`) | Zoom (per student = N HTTPS calls) | yes — N× Zoom `POST`; blocks until all registrants done (no queue)  | yes | no fully (creates session+webinar) | **MEDIUM if N>30** — could exceed 30 s `fetchApi`; not demo-recommended live. Seed sessions before demo instead. |
| `POST /live-sessions/:id/request-join` | `session_batches ∩ batch_students` + Redis `SETEX join_token:*` + Supabase insert | Supabase + Redis | yes | yes | yes (revokes prior) | LOW |
| `POST /bulk-upload/students` (request) | `parseUsersFile` (in-process ≤100 ms) + `insert bulk_upload_jobs` → returns `{ jobId }` immediately | Supabase | **no** — returns before rows processed | no (client polls `GET /bulk-upload/jobs/:id`) | LOW for request; background portion is P1-conditional (see §7) |
| `POST /admin/invoices/bulk` or `payments→ outbox→ InvoicesService` | See §7 Outbox path: `generatePdf` + Supabase Storage + Resend send × rows | Puppeteer + Supabase Storage + Resend | per-row **sequential sync** holding request (outbox path: per-job after wake) | bulk path blocks request; outbox path is background | no | **HIGH if live with many rows** — crosses 30 s; avoid |
| `POST /attempts/tests/:id/start`, `/attempts/:id/submit` | Supabase `tests`, `test_question_bank`, `test_answers` inserts; Redis `attempt_timer` | Supabase + Redis | yes | yes | no (submit once) | LOW — <1-2 s |
| `PATCH /evaluation/review-queue/:id/review` | Supabase `test_review_queue` + `test_results` | Supabase | yes | yes | yes | LOW |

**Common retry story:** `fetchApi` auto-retries once on `401` via `validateTokenOnServer` (`api-client.ts:114-124`) **only for non-auth endpoints**. A plain timeout (408) is not retried automatically — caller must retry (and `AuthProvider`'s boot + the dashboard's `.catch(()=>[])` + user navigation do).

---

## 11. Redis Audit

### Connection

- **Provider:** `RedisService` from `@liaoliaots/nestjs-redis@10` wrapping `ioredis@5` (`apps/api/package.json:14,29`, `pnpm-lock.yaml:548`). URL parsed as `{ host, port, password, tls: password? {} : undefined }` (`apps/api/src/app.module.ts:97-107`) — **TLS is on when a password is set** (Upstash-style `rediss://` convention).
- **Reconnect/pooling:** not configured explicitly; defaults to `ioredis` defaults (auto-reconnect, `retryStrategy`, single client via `getOrThrow()`). No connection pooling option — single `Redis` for app.
- **Startup:** `RedisModule.forRootAsync` is eager: if `REDIS_HOST` is unreachable the `RedisService` will fail to `getOrThrow()` and **modules that `try/getOrThrow()` gracefully** (Live sessions) degrade, but `SupabaseService` throws hard and `JwtAuthGuard` chains will hard-fail. Verify live env has correct `REDIS_HOST/PORT/PASSWORD` — stock `docker-compose.yml:redis` is dev-only (`localredis` on `127.0.0.1:6379`).

### Dependency per feature

| Feature | Redis key(s) | Hard dep? | Fallback if Redis down |
|---|---|---|---|
| Auth — session | `user_session:{userId} → sessionId`, `session:{sessionId} → {userId, ip, ...}` TTL 24 h | **Hard** — `JwtAuthGuard.canActivate` does `redis.get(userSession)` without `try/catch` (`jwt-auth.guard.ts:76-89`) → `UnauthorizedException` "Session expired" and, if `ioredis` throws, bubbles as 500 | None — login + every guarded request fails |
| Auth — rate limit | `ratelimit:login:{ip}` TTL 15 min | Soft — blocks after 5 only if counted | Expires to allow all |
| Live sessions — join tokens | `join_token:{token}`, `join_token_index:{sessionId}:{userId}`, `active_join:{sessionId}:{userId}` | Hard for join URL | Degrades to 401 on join only; list pages still work |
| Playback tokens | `playback_token:{token}` sliding 10 min, `playback_revoked:{userId}`, `playback_events:{userId}:{recordingId}`, `playback_session:{sessionId}` | **Hard for `GET .../play`** — revocation/expiry checks are Redis-first | `403/401 violation` |
| Attempt timer/checkpoint | `attempt_timer:{attemptId}` 3 h, `attempt_checkpoint:{attemptId} 24h` | **Soft** — `AttemptsService.getAttemptTimer` falls back to `attempt.time_remaining_seconds` or `duration_minutes - elapsed` (`attempts.service.ts:343-362`), `saveCheckpoint` is best-effort | DB truth |
| Cache | `cache:recordings:*`, `cache:recordings:flat:{userId}:*`, `cache:recordings:grouped:{userId}` (`redis-cache.service.ts:16-50`) | Soft — `RedisCacheService.get` returns `null` on error (`:24-26`), `wrap()` recomputes via `factory()` (hits Supabase) | DB hit |
| Device / risk | `risk_score:{userId}` 5 min, `screen_recording_rate:{userId}` 30 s | Soft | DB |
| Rate/join observability | `login/playing` windows | Soft | — |

### Boot failure

- `SupabaseService` (`supabase.service.ts:30-40`): throws `Error('... must be set')` if `SUPABASE_URL/SERVICE_ROLE_KEY/ANON_KEY` missing → **entire API crashes on boot**. This is correct: fail-closed.
- `RedisCacheService` (`redis-cache.service.ts:12`): `redisService.getOrThrow()` in constructor — if Redis DNS/auth fails, `getOrThrow()` throws → Nest DI throws → boot crashes. **`LiveSessionsService` is the one exception** that catches `getOrThrow` and falls to `redis=null` degraded mode (`live-sessions.service.ts:61-66`). Every other module propagates the throw.
- **Therefore:** if the Render Free `REDIS_HOST` is stale or rate-limited (e.g., free Upstash pauses), the **entire NestJS API fails to start** → all endpoints down until env is corrected. This is the **one P1 scenario** and is explicitly probed in §15.
- `ioredis` network hiccups at runtime (after boot) are per-command errors — `RedisCacheService` swallows them; `JwtAuthGuard`/`PlaybackGuardService` do not. Those two paths remain hard-coupled and correctly refuse to guess on cache availability.

---

## 12. Database (Supabase) Audit

- **Connection method:** `createClient(url, serviceRoleKey, { auth:{ autoRefreshToken:false, persistSession:false } })` (`supabase.service.ts:42-47`) + separate `authClient` on `anon` key for `signInWithPassword` / `resetPasswordForEmail`. This is the correct server model: REST/`PostgREST` over HTTPS, not raw pg `pool`.
- **Pooling exhaustion:** no `pg.Pool` exists; per-request PostgREST calls are stateless HTTPS; concurrent dashboard 5× `fetchApi` therefore cannot exhaust pg connections beyond Supabase's HTTP limit — **not a risk**.
- **Timeouts/retries:** not configured (no query timeout wrapper); web layer `fetchApi` 30 s is the outer limit. Resilience is `.catch()` stale-cache returns rather than retry.
- **Startup dependency:** same hard-fail check as Redis (missing `SUPABASE_*` throws immediately).
- **Local DB:** none — no `sqlite`, no local `postgres` (only dev `redis` via compose).
- **Sensitive columns:** `profiles.is_active`, `must_change_password` drive login & boot redirect (`auth.service.ts:135-142`, `middleware-guard.ts:53-57`).
- **Storage:** Supabase Storage `invoices` bucket for PDFs (`invoices.service.ts:263-286`) — HTTPS signed URLs (7 days) + `upsert:true`.

---

## 13. Health / Monitoring Audit

- `GET /` + `GET /health` (`app.controller.ts:6-16`) — `@Public()`, no guard, no DB/Redis query — **ideal wake probe**. Any `200` confirms NestJS is up (does not guarantee Redis/Supabase).
- Structured logging: `Logger` per module, `ObservabilityService` + `system_errors` / `system_events` / `performance_metrics` (`tables.constant.ts:58-60`, `observability.module.ts`). `JwtAuthGuard` logs `Session expired` warn; `PlaybackGuardService` logs violations; `bulk-upload.service.ts:114-126` logs `job completed/failed`.
- **Waking the service:** `curl https://<render-host>/health` from laptop or uptime robot is the documented temporary mechanism. **Do not treat a 30 s interval ping as permanent production** — Render's Free Terms allow suspension for unusual keep-alive traffic; this audit classifies it strictly as a **demo-day operational workaround** (§16).
- **Additional checks for Redis/Supabase liveness:** call `GET /auth/validate-session` with a valid JWT (requires auth) for Redis; or load `GET /recordings/my` for Supabase. For demo morning, combine both (§15).

---

## 14. Auth / Cookie / CORS Audit

### Cookie

```ts
// apps/api/src/modules/auth/auth.controller.ts:59-65
res.cookie('access_token', token, { httpOnly:true, secure:true, sameSite:'none', path:'/', maxAge: 24h })
// must_change_password also set via response
```

- `httpOnly:true` — JS `document.cookie` cannot read it (correct); `fetchApi` and `AuthProvider` deliberately read from `localStorage['session_persistence']` fallback when `document.cookie` is empty (`auth-token.ts:11-40`, `AuthProvider.tsx:129`). History: this was P0-fixed in Phase 4.
- `secure:true` + `sameSite:'none'` — **requires HTTPS on both sides**. Satisfied: Render (https) + Vercel (https). If ever run on `http://localhost:3000`, cookie is invisible — `FRONTEND_URL` handles dev.
- No `domain` set — cookie is origin-bound to the Render host (`*.onrender.com`); Vercel therefore never receives the Set-Cookie automatically; persistence relies on JS setting a non-httpOnly mirror via response body token + `AuthProvider` cache (intentional cross-origin pattern).
- Frontend fallback cookie clear: `document.cookie = 'access_token=; path=/; max-age=0; secure; samesite=lax'` (`auth.ts:80`, `api-client.ts:120`) is the correct minimal logout (lax variant tolerated for the JS-cleared copy).
- Expiry: `maxAge 24h` cookie = JWT `expiresIn 24h` (`app.module.ts:88-93` `JWT_EXPIRES_IN ?? 24h`) = Redis `REDIS_TTL.SESSION 24h` (`redis-keys.constant.ts:45`) + sliding `expire()` on each `JwtAuthGuard` hit (`jwt-auth.guard.ts:99-102`) and `validateSession` (`auth.service.ts:283-289`). Consistent.

### CORS

```ts
// apps/api/src/main.ts:33-36
app.enableCors({ origin: [frontendUrl, 'https://mctlms-web.vercel.app'], credentials:true })
```

- `FRONTEND_URL` env must be **exactly** the Vercel origin (`https://mctlms-web.vercel.app` today; later `https://mctlearn.com` once cut over). A mismatch causes preflight failure → every `fetchApi` fails with `TypeError: Failed to fetch` (not a 40x). Verify before demo.
- `credentials:true` is needed for the httpOnly cookie on same-site fallback (even though most requests use `Authorization: Bearer`).
- No wildcard — correct.

### Can cold start cause auth failure rather than delay?

- **Decode-only path (middleware):** no — `middleware-guard.ts:40-44` decodes JWT locally (`atob(payload)`) without touching Redis/the API.
- **Validation path (API):** yes — but only if **Redis itself is down**. The JWT signature remains valid; `JwtAuthGuard` throws `401 Session expired — please log in again` when `redis.get` returns null or fails (`jwt-auth.guard.ts:81-89`). A slow/cold Redis (not down) therefore becomes a `401`, not a retryable delay — and `fetchApi`'s 401 recovery will re-validate via `GET /auth/validate-session`, which hits **the same failing Redis** again and correctly leaves the user logged out. This is the only cold→auth-failure vector and is classified **P1 iff Redis is unreachable**. Transient network 408s do **not** cause auth failure; they are handled below that path.
- `AuthProvider` 5 s timeout `setAuthFailed` path (`AuthProvider.tsx:110-115`) is a **hard `status='error'` requiring refresh** — it must not be reached by a normal 60 s wake; pre-warming avoids it.

---

## 15. Demo Tomorrow — Critical Path Analysis

Minimum critical flows (in order you will click tomorrow):

| # | Flow | Route(s) | Backend dep | Cold-start impact | Failure mode | Demo risk |
|---|---|---|---|---|---|---|
| 1 | Open LMS | `GET /` static | none | immediate | — | ✅ |
| 2 | Student login | `POST /auth/login` `auth.controller.ts:52` | Supabase Auth + Redis session | 30 s timeout → form error; retry succeeds warm | 408 / 401 if Redis down | **P1-edge if cold and no pre-warm** — mitigate §15 smoke |
| 3 | Dashboard | `GET /student` SSR 5× `fetchApi` (`app/student/page.tsx:20`) | Supabase + Redis cache | each `.catch` renders section empty until retry | empty Continue Watching / Upcoming | **LOW** with warm |
| 4 | Batch visibility | `GET /courses/my`, `GET /courses/:id` | Supabase | delay | empty course cards | LOW |
| 5 | Recording list | `GET /recordings/my` | Supabase + Redis cache | empty list on 408 | "No recordings" empty state | LOW |
| 6 | Open recording / player | `POST /recordings/:id/authorize` + `GET /recordings/:id/play?token=` (`recordings.controller:185-207`, `playback-guard.service.ts:80-166`) | `recording_batches` + Redis + Bunny HMAC | 408 → player error + Retry | Re-click produces fresh signed URL | **LOW** — pre-open one recording before stage |
| 7 | Assessment list | `GET /tests`, `GET /questions` | Supabase | short delay | empty tests | LOW |
| 8 | Open assessment | `GET /attempts/:id`, `GET /attempts/:id/timer` | Supabase + Redis `attempt_timer` | timer shows `DB` fallback value; functionally correct | N/A | LOW |
| 9 | Submit assessment | `POST /attempts/:id/submit` | Supabase + Redis `del checkpoint` | idempotent check blocks double submit | — | LOW |
| 10 | Live class list | `GET /live-sessions/my` | `batch_students → session_batches` | empty past/upcoming until retry | empty | LOW |
| 11 | Admin login | `POST /auth/login` (admin) | same | same as 2 | — | same |
| 12 | Admin dashboard | `apps/web/src/app/admin/page.tsx` 4× Promise.all | analytics `supabase` counts | cards show 0 on timeout | — | LOW |
| 13 | Admin recording list | `GET /admin/recordings/all` | Supabase + cache | empty table on 408 | — | LOW |
| 14 | Admin batch management | `GET /batches`, `GET /batches/:id/students`, `POST /batches/:id/add-student` | Supabase + auth | delay | — | LOW |
| 15 | Student management | `GET /users/me/batches`, `POST /bulk-upload/students` + poll `GET /bulk-upload/jobs/:id` | Supabase + (background `Promise`) | poll shows `processing` long if slept | — | **P1 if live bulk shown with restart** — pre-seed instead |
| 16 | Search | `GET /... ?search=` (recordings/courses/tests) + `GlobalSearch` debounce | Supabase `ilike` | short delay | no suggestions | LOW |
| 17 | Support workflow to show this week | `GET /batch-curriculum/*`, `GET /evaluation/review-queue`, `POST /attempts/:id/event` | Supabase (+Redis events) | delay only | — | LOW |

**Grouping:** steps 2-6 share the same wake. Warming once before the audience arrives makes steps 3-17 warm.

---

## 16. Demo Smoke Test Plan (non-destructive, no deploy/DB changes)

### Before demo — 30 min before audience

- [ ] **Wake API** — from demo laptop on venue Wi-Fi: `curl -i https://<render-api-host>/health` → expect `200 {"status":"ok"}`. If `502/504`, wait 60 s and repeat. Do **not** run until success. Record latency.
- [ ] **Confirm API is warm** — `curl -i https://<render-api-host>/` same expectation.
- [ ] **Confirm login** — in a normal browser (not Playwright), log in as a seeded **student** (`POST /auth/login`→ 200, token in response body). While logged in, call `GET /auth/validate-session` with `Authorization: Bearer <token>` → `200 {valid:true}` (confirms Redis is alive). Repeat for **admin**.
- [ ] **Confirm Redis** — if `validate-session` 401 or 500, **STOP** — `REDIS_HOST/PASSWORD` is miswired or Upstash is paused; fix dashboard env and redeploy before proceeding. No other flow can pass without this.
- [ ] **Confirm Supabase** — still logged in as student, `GET /recordings/my` → 200 (even if `[]`, proves Supabase is up). Optionally `GET /courses/my`.
- [ ] **Confirm Bunny playback** — still logged in, `POST /recordings/{seeded-bunny-ready-id}/authorize` → `{ playbackToken }`, then `GET /recordings/{id}/play?token={ playbackToken }` → `{ url: "https://{BUNNY_CDN_HOSTNAME}/{guid}/playlist.m3u8?...", thumbnail, expiresAt }`. Check `url` starts with `https://<cdnHostname>` (not `stream.mux.com`). Open in player quickly (60 s Mux legacy URLs expire fast; Bunny 4 h has margin) — confirm full-width player renders without 403.
- [ ] **Confirm Zoom not required live** — unless a live class is on the agenda, do **not** create a new `POST /live-sessions`; instead verify seeded sessions appear in `GET /live-sessions/my`. If live Zoom join must be shown, `POST /live-sessions/:id/request-join` → `{ token, expiresInSeconds: 900 }` proves Redis join path.
- [ ] **Pre-open the exact recordings + assessments you will click on stage** — keep that tab open (it keeps the session cookie alive and Redis TTL sliding).
- [ ] **Keep the API awake** — leave one tab on `GET /health` and let `AuthProvider` heartbeat run: it polls `GET /auth/validate-session` every 30 s via a `localStorage`-leader election (`session-heartbeat.ts:46-69`). Never close all tabs for >15 min. As a **temporary demo-only** workaround you may also run `while true; do curl -fs https://<host>/health >/dev/null; sleep 300; done` from your machine — classify accordingly and **remove after demo** (see §17).

### During demo

- [ ] Leave the warm tab open (speaker's machine + one backup device logged in — but note `single-device enforcement` in `auth.service.ts:143-153`: a second login invalidates the first; so **do not re-login the same user on two devices simultaneously**. Either use two different demo users or log out cleanly first).
- [ ] Avoid triggering **bulk** CSV imports, **bulk** invoice `bulkGenerate`, or **any** Puppeteer-heavy action (`POST /payments … → invoice/receipt` at volume) while presenting — single invoice is fine, burst is not on Free.
- [ ] Avoid deleting recordings or sessions on stage.
- [ ] If the audience sees a loading spinner or timeout: say "the API is waking up — one moment" → refresh once (≈30-60 s) → continue. This is the expected Free path, not a bug.
- [ ] If a `401 Session expired — please log in again` appears: it is a real Redis outage, not a cold-start delay — log back in or switch to admin view; if it recurs, pivot to screenshots.

### After demo

- [ ] Pull Render **Logs** (`Render Dashboard → Service → Logs`) — look for `Redis` errors, `Puppeteer browser ✓/✗ unavailable`, `Upload job ... done/failed`, `Outbox scheduled processing`.
- [ ] Review **Errors/Events** via the `observability` / `monitoring` pages (`GET /observability/dashboard`) + `system_errors`.
- [ ] If Render dashboard exposes Memory/CPU graphs, snapshot `max RSS` around the demo window — confirms not OOM.
- [ ] Confirm no webhook dead-letter by checking `upload_queue` (`status='failed'/'expired'`) and Bunny/Mux webhook logs; re-enqueue if needed (manual DB `pending` flip).

---

## 17. Risk Classification

### P0 — demo blocker / data-loss / auth failure (none found)

> No issue classified P0 after evidence. All auth paths are correct; no unconditional crash-on-import; no persistent data written to ephemeral disk.

### P1 — serious reliability problem that could realistically affect tomorrow's demo

| ID | Title | Evidence | Effect | Classification rationale | Mitigation for tomorrow |
|---|---|---|---|---|---|
| P1-1 | **Redis unreachable at cold boot = total auth outage** | `supabase.service.ts:31-40` throws on missing Supabase env; `RedisCacheService:12` `getOrThrow()` throws if DNS/auth wrong → Nest DI boot crash; `JwtAuthGuard:76-89` hard-401/500 when `redis.get` fails; every demo path after login is gated by this Redis session | `POST /auth/login` and all gated `GET`s 401/500 → demo stops | Reproducible if Render `REDIS_*` env points to a paused/rotated instance (free Upstash auto-pauses). No `try/catch` around `JwtAuthGuard` Redis call, so not degradable. | **Pre-flight:** run §16 "Confirm Redis" (`GET /auth/validate-session` must be 200). If 401/500, abort and fix env before audience. |
| P1-2 | **`processJobInBackground` bulk import has no stale-reclaim; Render restart mid-chunk loses rows** | `bulk-upload.service.ts:72-127` inserts `bulk_upload_jobs processing` then fires `processJobInBackground` with no `@Cron` reclaim; `RecordingUploadJob` has `reclaimStaleProcessing 30 min` (`recording-upload.job.ts:74-88`) — bulk does not | CSV of ~20 rows split into `CHUNK_SIZE=5`; a restart between chunks leaves job forever `processing`, callers polling `GET /bulk-upload/jobs/:id` never see `completed` | Only triggered if you do a live bulk import on stage and Free restarts during the ~5-15 s processing window — realistic on a one-instance Free host. | **Tomorrow:** do **not** rely on a live import for the narrative; pre-import the demo CSV before the warm-up and only show the finished job. If a live import must be shown, keep to ≤20 rows and **poll to `completed`** before moving on. Have seeded students as backup. |

### P2 — production improvement but demo can safely proceed

| ID | Title | Evidence |
|---|---|---|
| P2-1 | Outbox 30 s poll + 60 s wake = ~90 s invoice/receipt email lag while asleep | `outbox.service.ts:35` `@Cron('*/30 * * * * *')` + §5 wake. Payments are recorded synchronously — email is just delayed. |
| P2-2 | Admin `createLiveSession` does N sequential Zoom `registerAttendee` calls inline (`live-sessions.service.ts:182-202`) → request can exceed `fetchApi` 30 s for N>20 | Do not create live sessions on stage with large batches. |
| P2-3 | Bulk invoice `bulkGenerate` is a synchronous long request holding the only instance (`invoices.service.ts:654-830`) | Admin-only; never needed live. |
| P2-4 | `RecordingUploadJob` / `Outbox` / `Cleanup` cadence pauses while asleep (2 min/30 s/15 min) — ingestion & cleanup only delayed | Idempotent resume covers it; use seeded `ready` recordings on stage. |
| P2-5 | CORS `origin` relies on exact `FRONTEND_URL` env match (`main.ts:33`) + login cookie `sameSite:'none'` wedge for cross-origin Vercel→Render | Verified today; set `FRONTEND_URL=https://mctlms-web.vercel.app`. |
| P2-6 | Resend in stub mode (`resend@6`, `isStub` when key is `re_xxxxxxxxxxxx`) silently "sends" to logs only | Switch to real `RESEND_API_KEY` when credentials exist — demo can proceed without live email. |

### P3 — optimization / future improvement

- P3-1 Move recurrent jobs to a paid instance (or a durable queue) for low-latency ingestion — not required for demo or current volumes.
- P3-2 Externalize PDF generation (paid Render 1 GB instance or external API) if invoice volume grows — `PdfGenerationService` already has `isAvailable()` probe.
- P3-3 Add a dedicated `bulk_upload_jobs` stale-reclaim cron (mirror `RecordingUploadJob.reclaimStaleProcessing`) for hardened bulk import.
- P3-4 Add `GET /health` deep variant `GET /health/ready` that checks Redis `PING` + Supabase `select 1` for dashboard wiring (current health is intentionally shallow so it never fails closed).
- P3-5 Once `mctlearn.com` DNS is cut over, align `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`, `EMAIL_FROM`, and CORS in both Render+Vercel in a single change window.

**Cold-start alone is NOT P1 per requirement.** It is `P1-edge` only when it couples to a real failure (Redis outage or mid-import restart), which is classified above.

---

## 18. Auth / CORS Summary (duplicate target for the required report TOC)

See §14 for full detail. Key facts:

- Cookie: `access_token` `httpOnly secure: true sameSite: none` (cross-origin Vercel→Render).
- Fallback: `getAccessToken()` reads `localStorage['session_persistence'].token` when `document.cookie` cannot expose httpOnly (`auth-token.ts:15-40`).
- CORS: `origin: [FRONTEND_URL, 'https://mctlms-web.vercel.app']` `credentials:true` (`main.ts:33-36`).
- Guards: `JwtAuthGuard` → `RolesGuard` global. `JwtAuthGuard` hard-depends on Redis `user_session:*`; `RolesGuard` only runs after.
- Cold-start auth failure: only when Redis is actually down (P1-1). Otherwise cold is a timeout/delay.

---

## 19. Recommended Temporary Precautions (demo-only)

| Precaution | Reason | Classification | Remove after? |
|---|---|---|---|
| Pre-warm `curl https://<host>/health` 5 min before start and keep one heartbeat tab open | Avoid 60 s wake hitting the first login | **Temporary operational workaround** (not a keep-alive hack in code) | Not needed once on paid instance; or keep 5-min external probe only if staying on Free |
| Leave `AuthProvider` heartbeat running across tabs (default) | 30 s `GET /auth/validate-session` sliding refresh keeps Redis TTL fresh; also prevents 15 min sleep | Temporary | Keep |
| **Do NOT add in-repo keep-alive ping** | Would violate Render Free terms at scale and mask the real signal | — | — |
| Pre-seed one `bunny` `ready` recording with `recording_batches + batch_recording_curriculum` and one `published` assessment | Avoid depending on a just-finished Zoom webhook + Bunny encode window during the slot | Temporary demo data hygiene | Keep as pilot data |
| Keep demo bulk CSV to ≤20-50 rows if showing live; pre-import otherwise | Sidesteps `P1-2` restart-window | Temporary | Until `P3-3` reclaim exists |
| Do not trigger bulk PDF/email blast on stage | Avoid single-instance burst on 512 MB | Temporary stage discipline | Until paid or externalized PDF |

---

## 20. Long-Term Recommendations (no spend unless concrete blocker)

| Timeframe | Action | Why | Cost note |
|---|---|---|---|
| Keep as-is | **Stay on Render Free + Vercel for demo + low-volume** — report shows it is technically safe tomorrow with warm-up discipline | No P0 | No spend |
| Near-term paid gate | **Upgrade Render API to Standard (or at least Starter) when:** sustained concurrent traffic > few dozen, bulk PDFs/emails run daily, or Zoom recording ingestion latency <2 min is required | Free single instance + sleep + 512 MB ceiling is the limiter | ~$7-25/mo tier; one-instance Standard removes sleep and doubles RAM (enough for Chromium) |
| Before cutover to `mctlearn.com` | **DNS:** point `mctlearn.com`/`www` to Vercel in one go, set `FRONTEND_URL=https://mctlearn.com` + `NEXT_PUBLIC_API_URL=https://api.mctlearn.com` (once an `api.` mapping is added) or keep `https://<render-host>.onrender.com` while the app is cold-start tolerant | One-time config dance | Domain already owned (GoDaddy) — no new purchase |
| Backend hardening (no scaling) | paid instance **or** just add a 5-min external health-check probe post-demo if staying on Free — accept that Free is "not intended for production" and plan to pay before heavy load | Avoid silent sleep for students between classes | See Render pricing; no migration needed — just slot change |
| Code hygiene | Add stale-reclaim for `bulk_upload_jobs` (P3-3), optional `GET /health/ready` deep check (P3-4), and wire `PUPPETEER_EXECUTABLE_PATH` to host Chromium once on larger instance | Robustness, not demo-gating | Code change — do after freeze |
| Do NOT do tomorrow | Consolidate to Vercel Serverless for API, migrate DB, change provider routing, rename `mux_*` columns, delete Mux | Breaks Freeze commitment that will land before the future hybrid stage | Blocked |

---

## 21. Final VERDICT

### DEMO GO WITH OPERATIONAL PRECAUTIONS

No code blocker. The one P1 scenario (Redis unreachable) is a **deployment-env misconfiguration**, not a codebase defect, and is fully gated by a 60-second pre-flight. The only in-demo P1 (bulk import restart window) is avoided by staging discipline already listed. Cold start alone is a harmless delay with existing retry handling.

- **What is technically safe for tomorrow:** yes — with one warm-up and a warm tab (§16).
- **What is acceptable for current low-volume use:** yes — with the listed precautions; sleep is expected and harmless with idempotent jobs.
- **What should eventually move to paid Render:** when load or invoice PDF burst makes 512 MB + single instance + sleep visible — not before.
- **What absolutely cannot remain on Free:** nothing absolutely — but do not rely on Free for strict <2 min Zoom→ready latency or high-TPS live bursts without a paid slot.

---

## 22. Evidence Index (file:line anchors)

- Render no-config: `package.json`, `vercel.json`, `docker-compose.yml`, `apps/api/src/main.ts:49`, `apps/api/src/app.module.ts:77-111`, `docs/rccf-final-production-deployment-report.md:181`
- Health: `apps/api/src/app.controller.ts:6-16`
- Auth: `apps/api/src/modules/auth/auth.controller.ts:59-65`, `apps/api/src/modules/auth/auth.service.ts:96-181`, `apps/api/src/common/guards/jwt-auth.guard.ts:76-102`, `apps/web/src/components/providers/AuthProvider.tsx:21-152`, `apps/web/src/lib/auth-token.ts:11-40`, `apps/web/src/lib/auth-validation.ts:1-13`
- CORS: `apps/api/src/main.ts:33-36`, `apps/api/src/app.module.ts:88-107` (Redis TLS)
- Supabase/Redis services: `apps/api/src/common/services/supabase.service.ts:30-56`, `apps/api/src/common/services/redis-cache.service.ts:20-100`, `apps/api/src/common/constants/redis-keys.constant.ts:12-66`
- Fetch: `apps/web/src/lib/api-client.ts:43-157`
- Student page resilience: `apps/web/src/app/student/page.tsx:20-26`
- Jobs: `apps/api/src/jobs/recording-upload.job.ts:36-331`, `apps/api/src/jobs/recording-cleanup.job.ts:40-211`, `apps/api/src/modules/outbox/outbox.service.ts:35-119`, `apps/api/src/modules/bulk-upload/bulk-upload.service.ts:35-127`
- Puppeteer/memory: `apps/api/package.json:34`, `apps/api/src/modules/pdf/pdf-generation.service.ts:20-140`, `apps/api/src/modules/invoices/invoices.service.ts:176,526,654-830`, `apps/api/src/common/utils/file-parser.util.ts:55-102`, `apps/api/src/modules/video-provider/providers/bunny.provider.ts:282-295`
- Webhooks: `apps/api/src/main.ts:26` rawBody, `apps/api/src/modules/zoom/zoom.controller.ts:119-166`, `apps/api/src/modules/zoom/zoom-webhook.handler.ts:52-413`, `apps/api/src/modules/video-provider/bunny-webhook.controller.ts:49-192`, `apps/api/src/modules/video-provider/providers/bunny.provider.ts:82-126`, `apps/api/src/modules/mux/mux.controller.ts:40-192`, `apps/api/src/modules/mux/mux.service.ts:397-433`
- Filesystem: `apps/api/src/modules/invoices/invoices.service.ts:195-223`, `apps/api/src/modules/pdf/pdf-generation.service.ts:97-112`
- Live join/playback: `apps/api/src/modules/live-sessions/live-sessions.service.ts:59-653`, `apps/api/src/modules/playback/playback-guard.service.ts:51-166`

---

*End of report — read-only audit, no source/deploy/env/DNS/DB/migration changes made.*
