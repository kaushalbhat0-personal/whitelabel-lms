# RCCF Report — Phase 7B: Staged Mux → Bunny Video Infrastructure Migration

**Companion audit:** `docs/rccf-phase7b-preimplementation-audit.md` (ambiguities A-1..A-4, blockers B-1..B-3)

---

## 1. Executive Summary

Phase 7B delivered the **staged dual-provider scaffolding** for the Mux → Bunny migration with **zero change to current production behaviour**:

- A `provider` discriminator (`'mux' | 'bunny'`) was added to `recordings` via a purely additive migration (default `'mux'` — every existing recording remains Mux).
- All provider-specific logic was centralized behind a `VideoProvider` interface with a single `RecordingProviderResolver`. Uploads route by explicit batch configuration; playback/deletion route by each recording's stored `provider`.
- `MuxProvider` wraps the existing `MuxService` 1:1 — existing Mux behaviour is untouched.
- `BunnyProvider` ships as a **configuration-complete but deliberately non-operational** implementation: repository evidence establishes nothing about Bunny's API, so per constraints #14/#15 no API behaviour was invented and no success is faked. Every Bunny operation fails observably until the external verification spike lands.
- `POST /bunny/webhook` is live in observation mode (logs only, zero mutations) pending confirmation of Bunny's webhook signature scheme.
- The pre-existing `video.asset.errored → status='error'` CHECK-constraint bug was fixed (canonical mapping → `'failed'`).
- Student-facing contract `{url, thumbnail, sessionId}` and the HLS player are unchanged. No frontend files were modified.

**Verification gates:** `tsc --noEmit` (API ✓, Web ✓) · `pnpm --filter api test` → **19 suites / 186 tests passing** (includes new provider suites) · `next build` ✓.
**Not executable in this environment:** applying the migration to the live database (Supabase host unreachable — DNS), browser playback of real Bunny content (no credentials), and therefore Bunny activation. These are documented as gated follow-ups, not assumed.

## 2. Initial Architecture

See companion audit §1–§6: single chokepoint `MuxService`; mux-named identifier columns on `recordings`; authorization chain JWT→RolesGuard→`validateAccess`(recording_batches)→Redis playback token→Mux RS256 URLs; four Mux webhook events drive the lifecycle; two cron jobs (Zoom import, cleanup retry); provider-generic hls.js player.

## 3. Final Architecture

```
Recording (row.provider = 'mux' | 'bunny')
      │
      ▼
RecordingProviderResolver                      ← ONLY decision point
  ├─ resolveUploadProvider(batchIds)           NEW uploads (policy below)
  └─ providerFor(recording)                    playback / deletion / cleanup
        ├── MuxProvider    → existing MuxService (unchanged behaviour)
        └── BunnyProvider  → config-gated, non-operational until verified
PlaybackGuard.getSignedUrl(token, {playbackId, provider}, …)
  security envelope unchanged; provider minting strictly below authorization
```

Batch policy (centralized, config-driven — audit A-1/A-2/A-3):
`BUNNY_ENABLED=true` **AND** `VIDEO_BUNNY_BATCH_IDS` lists batch UUIDs **AND** every target batch of the upload is listed ⇒ `'bunny'`; any other case (mixed Batch1+2 selection, unknown batch, draft flow, disabled) ⇒ `'mux'`. Default state = 100% Mux.

## 4. Database Changes

**Migration:** `scripts/migrations/035-recording-provider.sql`
```sql
ALTER TABLE public.recordings ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'mux';
-- idempotent CHECK constraint recordings_provider_check IN ('mux','bunny')
CREATE INDEX IF NOT EXISTS idx_recordings_provider ON public.recordings(provider);
```

- Purely additive; PG metadata-only default backfills all existing rows to `'mux'`. Nothing dropped, no data rewritten.
- Identifier columns (`mux_asset_id`, `mux_playback_id`, `mux_upload_id`) remain the storage slots keyed by `provider` (documented in `schema.sql`); physical rename deferred to the retirement phase (audit A-4).
- **Rollback:** `ALTER TABLE public.recordings DROP COLUMN IF EXISTS provider;`
- ⚠️ **NOT YET APPLIED to production** — live Supabase unreachable from this environment (DNS resolution failed for the configured project host). Application + verification is an ops step (Supabase SQL editor), using the checklist below.

Ops verification SQL (run after applying):
```sql
SELECT column_name, column_default, is_nullable FROM information_schema.columns
 WHERE table_name='recordings' AND column_name='provider';
SELECT conname FROM pg_constraint WHERE conname='recordings_provider_check';
SELECT provider, count(*) FROM recordings GROUP BY provider;   -- expect: mux = full row count
```

## 5. Provider Abstraction

`modules/video-provider/video-provider.types.ts`: `VideoProvider` with exactly the six operations the codebase needs — `createDirectUpload`, `createAssetFromSource`, `getAssetStatus`, `getPlaybackUrls`, `deleteAsset`, plus canonical `toCanonicalStatus()` (processing|ready|failed). No speculative methods (listing, DRM, captions, analytics).

## 6. Mux Compatibility

- `MuxProvider` delegates 1:1 to the unmodified `MuxService` (only additive change anywhere in `mux.service.ts`: a new read-only `getAssetStatus()` accessor used for webhook-parity/reconciliation parity).
- `MuxService.createUploadUrl` (create-with-upload flow) was superseded by `createDirectUploadUrl` semantics inside `MuxProvider` for BOTH upload entry points — functionally identical signed-policy direct uploads; the unused `topicId:''` passthrough argument disappears behind the interface.
- Mux webhook endpoint untouched except the mandated canonical-status fix (`'error'` → `'failed'`).
- All existing Mux env vars, credentials, webhook registration, assets, and playback IDs unchanged.

## 7. Bunny Integration

`BunnyProvider` implements the interface as an explicitly gated stub:
- `enabled` requires `BUNNY_ENABLED=true`; `isConfigured` additionally requires `BUNNY_LIBRARY_ID` + `BUNNY_API_KEY` + `BUNNY_CDN_HOSTNAME`.
- Every operation: throws `ServiceUnavailableException` when unconfigured; even when configured it refuses with "not yet confirmed from repository evidence" until the external spike verifies upload shapes, token enforcement model, and webhook signatures (blockers B-1/B-2).
- No token math, URL construction, or signature scheme was guessed. Failure is always observable — never a silent Mux fallback (constraint #16).
- `.env.example` documents the new keys as INACTIVE with pointer to the audit blockers.

## 8. Batch Routing

Centralized in `RecordingProviderResolver.resolveUploadProvider(batchIds)` — covered by unit matrix: disabled ⇒ mux; enabled+unlisted-set ⇒ mux; all-listed ⇒ bunny; mixed legacy+bunny selection ⇒ mux (single shared asset rule, A-2); empty/draft set ⇒ mux (A-3); whitespace tolerated. Recording-level routing (`providerFor`) maps NULL/'mux'→MuxProvider, 'bunny'→BunnyProvider (even if globally disabled — observable failure preferred over silent substitution).

Call sites routed: `RecordingsService.createRecordingWithUpload` / `requestUploadUrl`, `RecordingUploadJob` (session batches resolved BEFORE asset creation so Zoom imports route identically), `RecordingsService.deleteRecording`, `RecordingCleanupJob`.

## 9. Playback Authorization

Untouched semantics, verified by tests:
- `validateAccess()` still requires `status==='ready'` AND `batch_students ∩ recording_batches ≠ ∅` — re-run before both authorize and URL issuance.
- Redis opaque tokens: same TTL (600s slid), same bindings (userId/recordingId/deviceId/ip), same revocation marker check, same rate windows (8 URLs/min violation logging).
- Provider invocation moved strictly BELOW these checks in `PlaybackGuard.getSignedUrl`; access-log/view/violation writes unchanged.
- New spec proves cross-user/cross-recording rejection and that provider failure propagates instead of falling back.

## 10. Token Security

- Mux path byte-identical to Phase 7A findings (RS256, kid header, aud v/t, exp 60s/300s, session_uuid audit claim).
- **Bunny token design intentionally NOT implemented** (blocker B-2). Design requirement recorded: LMS-layer tightness (already enforced) must compensate while CDN tokens outlive a normal viewing session; exact expiry value is a product decision to be made after confirming Bunny's enforcement model. Reusing Mux's 60s CDN expiry on Bunny would stall segment fetches mid-playback.

## 11. Webhooks

| Provider | Endpoint | Status |
|---|---|---|
| Mux | `POST /mux/webhook` | unchanged behaviour; `video.asset.errored` now writes canonical `'failed'` (fixes stuck-in-processing bug R3) |
| Bunny | `POST /bunny/webhook` | observation mode: size-capped parse, log-only, zero mutations, always 200; signature verification deliberately absent until scheme confirmed (B-3) |

An event can only mutate rows of its own provider because each handler resolves records via its own identifiers (Mux handlers key on `mux_asset_id`/`mux_upload_id` of mux rows; Bunny mutation logic arrives with B-3 activation inside `video-provider/` only).

## 12. Testing

**New suites (4):**
- `recording-provider.resolver.spec.ts` — full routing matrix incl. safe-failure cases (§8 list) + recording-level routing/never-fall-back assertions.
- `providers/mux.provider.spec.ts` — delegation, combined playback/thumbnail minting, status mapping incl. `errored→failed`.
- `providers/bunny.provider.spec.ts` — config gating truth table + observable refusal (never fake success).
- `playback-guard.service.spec.ts` — mux/bunny routing, missing-provider default, observable bunny failure, security envelope (expired token 401, cross-user/cross-recording 403, provider never called on rejection), access-log writes.

**Updated suites (2):** `recordings.service.spec.ts` (resolver-mocked DI; delete/upload/routing assertions preserved & extended), `recording-cleanup.job.spec.ts` (provider-routed deletion incl. new bunny-row case).

**Results:** 19/19 suites, 186/186 tests green. E2E additions for live provider flows require a reachable environment (see §13).

## 13. Browser Verification

**Status: NOT EXECUTABLE in this phase's environment** — live Supabase unreachable (DNS) and no Bunny credentials exist. Per instruction §24 no Bunny playback claim is made. Required once environments are available: Batch-1 Mux playback regression (desktop+mobile, seek/pause/resume/reload, buffer-grows-monotonically regression guard from Phase 7A §16, no console errors, no 403s) and the same script against a pilot Bunny recording after activation.

## 14. Performance

No premature optimization. Measured-by-design notes: playback URL issuance performs exactly one extra in-memory resolver dispatch (zero added I/O vs previous implementation); `RecordingUploadJob` now reads `session_batches` once *before* asset creation (same single query, relocated for routing input — no N+1 introduced). P2 candidates for later: reconciliation sweeper for stuck `processing` rows; Bunny API latency profiling post-activation.

## 15. Cost Considerations

Unchanged known figure: Mux ≈ ₹12,000/month (user-provided). Repo analytics still provide no storage/egress metrics; Bunny pricing remains externally unverified. **No savings claim is made.** Required inputs list stands as documented in `rccf-phase7a-mux-bunny-audit.md` §Cost Model.

## 16. Rollback Procedure

1. **Per recording (instant):** `UPDATE recordings SET provider='mux' WHERE id=…;` — student routes/player unchanged; works only while the Mux asset exists (Phase 7B never deletes Mux assets outside the explicit admin-delete flow).
2. **Global upload routing:** set `BUNNY_ENABLED=false` (or clear `VIDEO_BUNNY_BATCH_IDS`) → all new uploads return to Mux. Restart API.
3. **Schema:** `DROP COLUMN IF EXISTS provider` (safe, nothing depends on it).
4. Existing Mux recordings were never modified; their rollback surface is identical to pre-7B.

## 17. Remaining Risks

| ID | Severity | Risk | Mitigation |
|----|----------|------|------------|
| RR-1 | **P0** | Bunny API/token/webhook reality unverified — activation blocked | Gated provider + observation-mode webhook; external spike required before Stage-3 enablement |
| RR-2 | P1 | Migration 035 not yet applied to production (env had no DB reach) | Ops runbook + verification SQL in §4; app code tolerates missing column? NO — deploy order MUST be: apply migration → deploy API |
| RR-3 | P1 | Missed-provider-webhook tolerance still zero (no sweeper) | P2 follow-up: reconciliation sweep via `getAssetStatus` |
| RR-4 | P2 | Draft uploads (`requestUploadUrl`) always route mux (no batch context, A-3) | Accepted conservative limitation; document for admins |
| RR-5 | P2 | Slot columns keep mux-prefixed names for bunny rows | Rename coordinated at retirement phase |
| RR-6 | P3 | Dead code (`modules/videos/*`, `@mux/mux-player-react`) retained deliberately | Retirement-phase cleanup |

## 18. Production Readiness Score

**78/100** — Scaffolding, routing, tests, typecheck, build: solid. Deductions: Bunny unverifiable here (-12), migration not yet applied to live DB (-6), browser verification pending (-4).

## 19. GO / CONDITIONAL GO / NO-GO

**CONDITIONAL GO** — for merging the dual-provider scaffolding and applying migration 035.

Hard conditions before flipping anything to Bunny:
1. Apply + verify migration 035 on production (§4 SQL), THEN deploy this API release (deploy-order dependency, RR-2).
2. External Bunny verification spike resolving blockers B-1 (upload/API shapes), B-2 (token enforcement model → session-safe expiry), B-3 (webhook signatures/catalogue).
3. Implement `BunnyProvider` operations against confirmed specs; flip `BUNNY_ENABLED=true` only with credentials present.
4. Browser-verified Bunny playback (mobile + desktop) before declaring the Batch-2+ routing live to students.

NO-GO triggers honored: no Mux assets touched · no auto-migration of existing recordings · existing access control byte-for-byte intact · no big-bang cutover possible by design (per-row `provider`).

---

*Phase 7B complete within environment limits. Bunny activation is a deliberate, gated follow-up — not an assumed capability.*
