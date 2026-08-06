# Performance Report — Assessments Module

Measured 2026-08-07 against the local environment (Windows, localhost, Redis+Supabase remote).

## API Latency (single attempt lifecycle, 5 questions)

| Operation | Latency | Notes |
|-----------|---------|-------|
| Create test | ~150ms | includes 3 relation inserts |
| Publish test | ~90ms | |
| Start attempt (5 q) | **871ms** | inserts attempt + 5 answer rows + Redis timer |
| Save 5 answers | **901ms** | N+1: one upsert per answer |
| Submit | **873ms** | N+1 answer upserts + status update |
| Auto-grade (5 q) | **2184ms** | N+1 per-answer updates + rank scan + analytics |
| Get result | 386ms | |
| Calculate analytics | 487ms | batch_students + full answers fetch |
| List tests | 140ms | |

## Bottlenecks

1. **Auto-grade N+1 (2184ms for 5 q)** — `autoGradeAttempt` performs one UPDATE per answer in a loop, then `publishResults` re-fetches answers and calls `calculateRank` (full-table attempt+answer scan) + `calculateAnalytics`. For a 100-question test this scales linearly.
2. **saveAllAnswers / submitAttempt N+1** — per-answer upsert loop (901ms/5 answers).
3. **calculateRank unbounded scan** — fetches all attempts + all answers for the test on every publish.
4. **calculateAnalytics unbounded** — fetches all answers for the test.

## Recommendations

| Item | Effort | Impact |
|------|--------|--------|
| Batch `saveAllAnswers`/`submitAttempt` answer upserts (single `.upsert(rows)`) | S | 5× faster save/submit |
| Batch `autoGradeAttempt` answer updates (array update) | S | 5× faster grading |
| Limit `calculateRank` to scored results / add index on `test_results(test_id, obtained_marks)` | S | Faster rank |
| Paginate/stream `calculateAnalytics` answers | M | Bounded memory |
| Add composite index `test_answers(attempt_id)` (already present) | - | OK |

These are **not blockers** for the current scale (dozens of students, <10-question tests in practice); flag for growth.

## Bundle / Rendering

- Assessment admin pages are client-rendered tables/modals; no heavy bundles.
- Student attempt page is a single-page interactive flow (timer + palette); no virtualized lists needed at current question counts.
- Browser verification showed 0 console errors, 0 overflow on 390/768/1440px.
