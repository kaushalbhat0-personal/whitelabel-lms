---
name: mct-performance
description: Known performance bottlenecks and budgets in this repo (N+1 patterns, Supabase query shapes, pagination, Redis caching, HLS buffering, Zoom token caching, CDN egress cost). Use when optimizing or reviewing hot paths.
---

# Skill: MCT LMS — Performance

## Purpose
Avoid re-introducing measured bottlenecks; know where the costs are.

## Known bottlenecks & fixes (from RCCF reports)
| Area | Bottleneck | Fix/pattern |
|---|---|---|
| Recordings list | N+1 batch names per row | one `.in('recording_id', ids)` fetch + in-memory Map |
| Analytics | full-scan aggregates per request | precomputed `test_analytics_snapshots` (order by calculated_at desc) |
| Attempts listing | joins via `!inner` on batch_students — correct but heavy | keep indexes from migration 029 (`idx_recordings_*`, etc.) |
| Zoom API | OAuth token per call | Server-to-Server token cached until expiry in ZoomService |
| Playback URL issuance | provider minting latency | local-only crypto (JWT/HMAC); no extra I/O added by provider resolver (7B verified) |
| Web video | duplicate fetches from double mounts | single-mount architecture + throttled progress events |
| HLS playback | effect-churn teardown → buffer resets | prefs outside init effect deps (skill mct-frontend-development) |
| Redis | cache invalidation discipline | `invalidateRecordingsCache()` after recording mutations |

## Query rules
- Paginate everything user-facing (`{page,limit,total}`); count with `Prefer: count=exact`.
- Filter/search/sort in SQL, not JS. Use existing indexes before adding new ones.
- Batch child fetches with `.in()`; never loop-await per row.
- Select explicit columns for wide tables.

## Cost dimension (video)
CDN egress is the dominant variable cost: Mux ≈ ₹12,000/mo today; Bunny published Asia rate $0.030/GB (Standard tier), storage $0.01/GB, standard encoding free. Batch 1=Mux / Batch 2+=Bunny staged migration exists precisely to measure this — do not move batches without reading `docs/rccf-phase7c-bunny-verification-report.md` §Cost Model.

## Verification
Performance E2E exists (`recordings/performance-stress.spec.ts`, docs/testing/performance-report.md). After optimization: measure before/after (query counts, p95 timing, network tab request count), record numbers in the phase report.

## Do Not
- Do not add caching layers (new Redis caches, SWR) without an invalidation story.
- Do not micro-optimize cold paths at the cost of readability.
