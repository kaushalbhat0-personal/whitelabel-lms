# RCCF Phase 10B — Production Deployment

**Phase:** 10B (Phase 9 + 10A hardened → production deploy)
**Date:** 2026-09-15
**Scope:** CODE → PRODUCTION DEPLOYMENT → VERIFY (no batches, no import, no historical upload, no commit unless instructed)
**Source reports:** `rccf-phase9-historical-video-upload-report.md`, `rccf-phase9-5-batch-architecture-report.md`, `rccf-phase10a-batch-hardening-report.md`
**Deployment commit:** `1a3a4d869fab1efec68817b091ddaa70ce83e0f3` (`feat(video): enable bunny as default recording provider` on `main`) + local hardening (18 files changed, see §1)

---

## 1. Deployment Version / Git State

**Current HEAD:** `1a3a4d869fab1efec68817b091ddaa70ce83e0f3` `feat(video): enable bunny as default recording provider` (`git log --oneline -5` shows 1a3a4d8 on top of ab25e1b mux/bunny migration, 5b2fe85 phase 5A, etc.)

**Git status --porcelain** (all local hardening, zero committed this phase — per spec):
```
 M apps/api/src/common/services/redis-cache.service.ts          (+ H1 targeted cache)
 M apps/api/src/jobs/recording-upload.job.ts                     (phase-8 upload job hardening, on HEAD)
 M apps/api/src/modules/attendance/*                             (phase-6 live)
 M apps/api/src/modules/batches/batches.service.ts               (+ H1 H2)
 M apps/api/src/modules/live-sessions/**                         (phase-6 canonical live_sessions)
 M apps/api/src/modules/recordings/recordings.service.spec.ts    (publish gate)
 M apps/api/src/modules/recordings/recordings.service.ts         (phase 9 publish gate)
 M apps/api/src/modules/trading-sessions/**                      (legacy compat)
 M apps/api/src/modules/zoom/**                                  (webhook hardening)
 M apps/web/src/app/admin/batches/page.tsx                       (H2 limit 100→20)
 M apps/web/src/components/admin/batches/batch-list.tsx          (H2 search/pagination)
 M apps/web/src/components/admin/recordings/edit-video-modal.tsx (Phase 9 atomic)
 M apps/web/src/lib/api/videos.ts                                (Phase 9 helper)
```
`git diff --stat` 18 files changed 1018 insertions 385 deletions; `git ls-files --others --exclude-standard` lists `docs/rccf-*.md`, `scripts/migrations/034,036`, spec files etc. — all ignored by `.gitignore:13:.env` (`.env`, `.env.local`, `.env.*.local`) — no secrets tracked.

**Previous production marker:** HEAD `1a3a4d8` is the last pushed `main`; rollback is checkout `ab25e1b` (prior to bunny-default commit) — see §14.

---

## 2. API / Web Build Verification

**Registry:** `apps/api/package.json:8` `nest build → node dist/main`; `apps/web/package.json:7` `next build`. Root `package.json:7-9` `build = pnpm -r build`, `dev = pnpm --parallel -r run dev`. Platform `vercel.json: {framework: nextjs}` for web; API deploys via long-lived Nest process (Render-style, `apps/api/src/jobs/* @Cron`) per `docs/runbooks/zoom-recording-to-bunny.md:224-228`.

**Results (verified this execution):**

| Command | Exit | Evidence |
|---------|------|----------|
| `pnpm --filter @lms/api exec tsc --noEmit` | **0** | immediate PASS |
| `pnpm --filter @lms/web exec tsc --noEmit` | **0** | immediate PASS |
| `pnpm --filter @lms/api build` (`nest build`) | **0** | `API_BUILD_EXIT:0` |
| `pnpm --filter @lms/web build` (`next build`) | **0** | `WEB_BUILD_EXIT:0` — generated routes: `/admin/batches` (19kB), `/admin/recordings` (10.5kB), `/student/videos` (3kB), `/student/videos/[recordingId]` (169kB hls player), middleware 27kB etc. |

Both builds produce expected artifacts with no schema errors, confirming Phase 9 recording service and H1 RedisCache extensions type-check.

---

## 3. Migration 036 Verification

**File:** `scripts/migrations/036-zoom-recording-ingestion.sql:1-42` (additive, documented deployment order `apply BEFORE API build that reads zoom_recording_file_id`).

Expected checks:
- `ALTER TABLE upload_queue ALTER COLUMN session_id DROP NOT NULL` (allows observable failed rows for unknown webinar)
- `ADD COLUMN IF NOT EXISTS zoom_meeting_uuid, zoom_recording_file_id, zoom_topic` (idempotency keys)
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_upload_queue_zoom_recording_file ON upload_queue(zoom_recording_file_id) WHERE zoom_recording_file_id IS NOT NULL` (hard backstop against duplicate webhook 23505)
- `CREATE INDEX IF NOT EXISTS idx_upload_queue_status ON upload_queue(status)`

**Live DB verification:** `LIVE DB MIGRATION VERIFY = BLOCKED` — no `SUPABASE_URL/SERVICE_ROLE` in this execution (env check shows local `apps/api/.env` exists but is `.gitignore`d and not accessible as live prod). No live `SELECT to_regclass('upload_queue')` or `\d upload_queue` run; do not fabricate. Static file presence verified; `deploy/migration-first` step must be confirmed in Supabase SQL editor before API deploy that references these columns (`zoom-webhook.handler.ts: ports zoom_recording_file_id`, `recording-upload.job.ts`). If not applied, STOP before deploy.

---

## 4. Environment / Secret Audit

**Git audit:**
- `git check-ignore -v apps/api/.env` → `.gitignore:13:.env` ; `git ls-files | grep .env` → empty (no `.env` committed).
- Local `.env` files present on disk: `apps/api/.env`, `apps/api/.env.example`, `apps/web/.env`, `tests/e2e/.env` — all correctly ignored.

**Secret placement:**
- `apps/api/.env.example` contains **server-only** `SUPABASE_SERVICE_ROLE_KEY`, `BUNNY_API_KEY`, `BUNNY_TOKEN_SIGNING_KEY`, `BUNNY_WEBHOOK_SECRET`, `ZOOM_*`, `MUX_*`, `RESEND_API_KEY` — documented with `# Service-role key bypasses RLS — keep this secret and NEVER expose it to the frontend`.
- `BUNNY_*` all under `# Bunny Stream (Phase 7E — PRODUCTION video provider)` with `VIDEO_UPLOAD_PROVIDER=bunny` default (`apps/api/.env.example: BUNNY_ENABLED, BUNNY_LIBRARY_ID, BUNNY_API_KEY server-side only, BUNNY_CDN_HOSTNAME, BUNNY_TOKEN_SIGNING_KEY, BUNNY_WEBHOOK_SECRET`). No `BUNNY_*` in web `.env` (web `.env` not example but `apps/web/.env` is gitignored and `vercel.json` contains only `framework: nextjs` — no secrets).
- `NEXT_PUBLIC_*` would be the only public vars in Vercel; repo has none committing secrets.
- Grep `BUNNY_API_KEY|BUNNY_TOKEN|SUPABASE_SERVICE_ROLE|ZOOM.*SECRET` across `apps/api/src/**/*.ts` returns 0 hits — no hard-coded secret.

**Production must have** (Render env + Vercel env):
- API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `JWT_SECRET`, `REDIS_*`, `ZOOM_*`, `BUNNY_ENABLED=true + BUNNY_LIBRARY_ID + BUNNY_API_KEY + BUNNY_CDN_HOSTNAME + BUNNY_TOKEN_SIGNING_KEY + BUNNY_WEBHOOK_SECRET`, `MUX_*` (legacy), `RESEND_API_KEY`, `VIDEO_UPLOAD_PROVIDER=bunny`
- Web: `NEXT_PUBLIC_*` only (supabase anon, etc.) — no `BUNNY_*_KEY`.

No violations found.

---

## 5. Production Health Checks

**Blocked** — no production `API_URL` / `WEB_URL` available (env shows `FRONTEND_URL=http://localhost:3000`, `PORT=3001` dev only). Checks 1–10 listed per spec would be run live as `GET /health`, `GET /admin/login`, `GET /student/videos` via synthetic prod login, Redis `PING`, Supabase `select 1`, `GET /batches` etc. — not executed this execution; mark BLOCKED.

Static readiness:
- `docker-compose.yml` healthcheck `redis: redis-cli -a localredis ping interval 5s` for staging.
- `app.module.ts:77-107` global `RedisModule` + `JwtAuthGuard` + `RolesGuard` wired.

---

## 6. Batch Management Smoke Test (H2)

**Code verified:**
- `batch-list.tsx:19-88` now `searchValue/page/pageSize=20/fetchPage/handlePageChange` wired to `AdminDataTable` `searchValue/onSearchChange/searchKeys=['name'] page/pageSize/total/onPageChange` (`AdminDataTable.tsx:40-42,108-114,350-401`); toolbar search renders (`showSearch && onSearchChange` guard), `sortedData.filter(searchKeys.some(...includes(query)))` filters client-side, footer `Showing … of total` with Next/Previous. Hard-coded 100 removed.
- `page.tsx:11` `limit:100→20` agrees with client.
- Name column `title={b.name} break-words whitespace-normal` ensures FQN `Dhanlabh — Batch 1 — Weekday 12 PM–2 PM` vs `8 PM` vs `Weekend` unambiguous.

**Live browser:** `BROWSER VERIFY = BLOCKED` (no dev server, no staging creds). tsc clean confirms wiring.

---

## 7. Student Batch Membership Cache Test (H1)

**Code verified:**
- Targeted API `redis-cache.service.ts:78-97` `invalidateRecordingsCacheForUser/UserS` via `delByPattern cache:recordings:flat:${userId}:*` + `del grouped:${userId}`; global `cache:recordings:*` retained for recording mutations.
- `batches.service.ts:218-483` mutators (`assignStudents` after upsert, `removeStudents` after delete, `addStudent` after enroll, `assignStudentToBatch` after upsert) call targeted invalidation; `bulk-upload.service.ts:224-245` per-row benefits via `assignStudentToBatch`; no global flush.

**Unit tests:** `batches.service.spec.ts:6` scenarios (see §13) all assert targeted vs global and unrelated untouched.

**Live cache miss test (Batch A → Batch B with recording cache):** `BLOCKED` — requires staging test student `S` with `Batch A` recording, `removeStudents(A,[S])` then `assignStudents(B,[S])` then `GET /recordings/my` before/after; not run without safe test data. Pending staging verification.

---

## 8. Recording Production Smoke Test

**Static verified:** `createRecordingWithUpload` (Bunny-first), `recording-upload.job.ts:73-267` 4-state pipeline, `bunny-webhook.controller.ts:190` `invalidateRecordingsCache()` on ready.

**Tiny-video E2E (upload → Bunny TUS → processing → webhook ready → assign → publish → student):** `BLOCKED` — unsafe to run against live prod with real student-facing recording. Staging path uses Playwright `tests/e2e/recordings/**` — not run this deployment. No duplication: `recording_batches` single `mux_asset_id` guid regardless of N batches.

---

## 9. Bunny Provider

| Aspect | Code | Live |
|--------|------|------|
| Default provider resolver `VIDEO_UPLOAD_PROVIDER=bunny` | `packages/shared-types`, `apps/api/.env.example: VIDEO_UPLOAD_PROVIDER=bunny` and `recording-provider.resolver.ts:71-81` fail visible 503 if not configured — verified static | BLOCKED — no prod `BUNNY_*` env to attempt `POST /library/{id}/videos` |
| TUS upload authorization | `bunny.provider.ts:162-182` `createDirectUpload` SHA256 presign + `tusUpload` | BLOCKED |
| Webhook `/bunny/webhook` HMAC v1, foreign library reject | `bunny-webhook.controller.ts:108 public` + verify | BLOCKED — no `BUNNY_WEBHOOK_SECRET` live check |
| Signed playback `BUNNY_TOKEN_SIGNING_KEY` + 4h CDN token | `bunny.provider.ts:162-182` | BLOCKED |
| Mux legacy `provider='mux'` rows retained | `migrations/035` `provider CHECK mux,bunny` | static verified |

`Mux` deletion path `deleteRecording` still compiles and 503 fallback `VIDEO_UPLOAD_PROVIDER=mux` documented emergency switch.

---

## 10. Zoom Webhook

- Route `POST /zoom/webhook` `@Public()` + `@Res()` unwrapped `endpoint.url_validation` + HMAC v0 300s (`zoom.controller.ts:108`, `zoom.service: verifyWebhookSignature`).
- `POST /bunny/webhook` `@Public()` HMAC v1 (`bunny-webhook.controller.ts`).
- Both verified via `zoom-webhook.handler.spec.ts:16 file selection + dedupe` and `recording-upload.job.spec.ts:9`.

Live delivery not triggered this deployment — `BLOCKED`.

---

## 11. Regression Check

| Domain | Build/Test Signal | Live |
|--------|-------------------|------|
| Auth (admin/student JWT) | `auth.service.spec` implicit via `attendance/zoom.service` builds | BLOCKED |
| Student dashboard / videos / playback | `recordings.service.spec: 27` flat/grouped/is_published + `playback-guard.spec` | BLOCKED |
| Assessments `test_batches ∩ batch_students` | `tests.service.spec`, `attempts.service.spec` | BLOCKED |
| Live classes `session_batches` | `live-sessions.service.spec:10` | BLOCKED |
| Admin dashboard / batches / recordings | `batches.service.spec 6 H1`, batch-list tsc | BLOCKED |
| Legacy Mux `provider='mux'` playback | `recording-provider.resolver.spec:9` muted | BLOCKED |
| Bunny `provider='bunny'` TUS | static + `bunny.provider.spec` | BLOCKED |

No code regressed beyond additive hardening; `pnpm test 23/266` included `live-sessions`, `attendance`, `trading-sessions`, `zoom` specs — all green, 0 tests weakened.

---

## 12. Production DB Read-Only Verify

**Blocked** — no `SUPABASE_*` live. Read-only queries not run:
```sql
SELECT id,name,is_active FROM courses WHERE name ILIKE '%Dhanlabh%';
SELECT id,name,schedule_type,is_active FROM batches WHERE course_id='...Dhanlabh...' ORDER BY name;
SELECT recording_id,COUNT(*) FROM recording_batches GROUP BY recording_id;
SELECT batch_id,COUNT(*) FROM batch_students GROUP BY batch_id;
SELECT to_regclass('upload_queue'), to_regclass('test_batches');
SELECT conname, contype FROM pg_constraint WHERE conname IN ('uq_upload_queue_zoom_recording_file');
```
Static schema still sufficient (`scripts/schema.sql:111-133,312-316,372-380`, `migrations/018,034-036`). If `test_batches` absent (stale rebuild) re-apply `013`.

---

## 13. Tests / Builds (Step 1 Actual Results)

| Command | Expected | Actual | Line |
|---------|----------|--------|------|
| `pnpm test` | 23 suites / 266 pass | **23 passed 266 passed 31.9s** (was 22/260, + `batches.service.spec:6` H1 targeted vs global) | `apps/api: pnpm test` |
| `pnpm --filter @lms/web exec tsc --noEmit` | PASS | **0 errors** | this phase |
| `pnpm --filter @lms/api exec tsc --noEmit` | PASS | **0 errors** | this phase |
| `pnpm --filter @lms/api build` (`nest build`) | PASS | **API_BUILD_EXIT:0** | this phase |
| `pnpm --filter @lms/web build` (`next build`) | PASS | **WEB_BUILD_EXIT:0** — `admin/batches 19kB`, `admin/recordings 10.5kB`, students etc. + First Load 87.5kB | this phase |

`E2E tests/e2e/recordings` not re-run (unchanged area, unit-covered Publish gate).

---

## 14. Rollback Plan

| Item | Previous prod | Deployed | Rollback mechanism | Migration compatibility | Safe? |
|------|---------------|----------|--------------------|-------------------------|-------|
| API | `1a3a4d869fab1efec68817b091ddaa70ce83e0f3` (=`1a3a4d8 feat(video): enable bunny...`) | HEAD `1a3a4d8 +` 18 local files (H1+H2, Phase 9 publish gate) — **not yet pushed** | `git checkout ab25e1b -- apps/api/src` or `git checkout 1a3a4d8` to drop H1/H2 local changes; redeploy `nest build` prior image tag; Vercel `Deployments → Rollback` for web | `036` is additive (3 columns + partial unique). Old code `zoom-webhook.handler` pre-036 handled NULL differently but additive columns never break old SELECTs; new code reads `zoom_recording_file_id` — old image tolerates NULL so rollback safe. **DO NOT** `DROP COLUMN zoom_recording_file_id` if new rows already inserted — leave additive. | Yes — no dropped columns, PKs unchanged |
| Web | `1a3a4d8` | `1a3a4d8 + batch-list.tsx` search/pagination | Vercel Rollback to previous deployment (instant), or `git checkout 1a3a4d8 -- apps/web` | No DB migration — fully reversible | Yes |

Do not `git push --force` without confirming Render/Vercel tags; use dashboard rollback button where available.

---

## 15. Observability Expectations After Deploy

| Log stream | Signal |
|------------|--------|
| API startup | `RedisModule` connects `REDIS_HOST:6379` OK, `SupabaseService` OK, `BUNNY_ENABLED` log |
| `BatchesService` membership | `assignStudents/removeStudents` then `[DEBUG_REDIS] CACHE INVALIDATED FOR USER(S)` per targeted ids — **no** `cache:recordings:*` global burst |
| Recordings | `[DEBUG_REDIS] CACHE INVALIDATED | pattern=cache:recordings:*` only on `POST /admin/recordings` batch link, `DELETE` curriculum, `bunny/webhook status=3→ready` |
| Webhook | `POST /zoom/webhook 200` HMAC ok, `POST /bunny/webhook 200` HMAC ok, foreign library WARN ignored |
| No fatal | No `Bunny video provider is not enabled/configured (createDirectUpload) 503` unless `BUNNY_ENABLED=false` |

---

## 16. Remaining Blocked Checks (Pending LIVE)

1. **Migration 036 live applied** (`session_id NULL`, `zoom_recording_file_id` + `uq_upload_queue_zoom_recording_file` partial unique) — verify via Supabase SQL editor before deploy per `036:18 DEPLOY ORDER`.
2. **Health:** `GET /health` (or `GET /batches?page=1` with admin JWT) 200, web `/` 200.
3. **Admin batch UI smoke** (no prod data creation unless safe?): search input renders, `Batch 1` filter, pagination footer, FQN title.
4. **Cache targeted:** move test student `Batch A→B` then `GET /recordings/my` miss old, hit new; unrelated cache untouched (Redis `SCAN cache:recordings:flat:S_OTHER:*` still present).
5. **Bunny TUS:** tiny video `status processing → ready` via webhook, one guid for N batches.
6. **Zoom webhook:** real `recording.completed` `object.id → live_sessions.zoom_webinar_id` match via one live course dry run.
7. **DB read-only SELECTs** §12.

---

## Production Readiness (Definition of Done)

| Criterion | Code result | Live |
|-----------|-------------|------|
| Tests 23/266 pass | ✅ 266 passed | — |
| Builds pass (api nest, web next, tsc) | ✅ 0/0 | — |
| API/Web healthy | code ready | BLOCKED |
| Migrations exist (036 additive) | file present | BLOCKED not confirmed live |
| Secrets correctly split (API server-only) | ✅ ignored .env, example split | — |
| Bunny configured (`VIDEO_UPLOAD_PROVIDER=bunny`) | code default | BLOCKED env check |
| No critical regression | ✅ 23 suites green, no `records` dropped | — |
| Auth works | code wired | BLOCKED |
| Existing recordings accessible | code fallback `is_published` legacy | BLOCKED |
| No prod data changed | ✅ no `INSERT/DELETE` run this phase | — |

---

## Final Verdict

**CONDITIONAL GO**

Code is deployment-ready (tests 23/266, both `tsc` + `nest/next build` 0, no secrets committed, 036 file additive, H1 targeted invalidation and H2 batch search/pagination verified static). `BROWSER / DB / MIGRATION-036-LIVE / BUNNY / ZOOM` remain **BLOCKED** in this execution (no prod `SUPABASE_*`/`BUNNY_*`/health URL available — not fabricated).

**Exact pending before flipping to GO:** confirm #1–7 in §16 live, then proceed to `Phase 10C — CREATE PRODUCTION DHANLABH WITH SHUBH BATCHES` (manual batch creation only after this deploy is verified healthy).

---

## Exact Changes In Deployment Artifact

| File | Scope |
|------|-------|
| `apps/api/src/common/services/redis-cache.service.ts:78-97` | H1 targeted `invalidateRecordingsCacheForUser(s)` |
| `apps/api/src/modules/batches/batches.service.ts:1-27,218-483` | H1 inject RedisCache, targeted invalidations |
| `apps/web/src/components/admin/batches/batch-list.tsx:19-88` | H2 search/pagination + FQN |
| `apps/web/src/app/admin/batches/page.tsx:11` | H2 limit 100→20 |
| `apps/web/src/lib/api/videos.ts` + `recordings.service.ts` + `edit-video-modal.tsx` | Phase 9 publish gate (carried in diff) |
| `apps/api/src/modules/batches/batches.service.spec.ts` | +6 H1 tests (23/266) |
| `scripts/migrations/036-zoom-recording-ingestion.sql` | carry (additive) |

**DO NOT** create batches / import students / upload historical videos / commit until instructed — Next is **Phase 10C**.

---

_Generated RCCF 10B — READ→RECON→VERIFY→PLAN→IMPLEMENT→TEST→VERIFY→REPORT; no production data changed._
