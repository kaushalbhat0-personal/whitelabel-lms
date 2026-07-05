# ADR-005: Caching Strategy — Cache-Aside with Invalidation on Write

**Status:** Accepted  
**Date:** 2026-07-06  
**Deciders:** Architecture Team  

## Context

The student recording dashboard (`GET /recordings/my`) is the most frequently accessed read path in the system. Every call requires:

1. Look up the student's batch IDs (`batch_students`)
2. Look up recording IDs from batch links (`recording_batches`)
3. Fetch full recording details (`recordings`)
4. Enrich with playback URLs and progress data

This query path joins 3-4 tables and runs on every page load for every student. As the platform grows to hundreds of concurrent students, the database load from this single endpoint becomes significant.

## Decision

**Use a cache-aside pattern with Redis, keyed by `userId`, invalidated on any recording mutation.**

### Read Path
1. Check Redis for key `recordings:student:{userId}`
2. On cache hit: return cached data immediately
3. On cache miss: query Supabase, store result in Redis (TTL: none), return data

### Write Path (Invalidation)
Any mutation that changes a recording's visibility triggers cache invalidation:

- `createRecordingWithUpload()` — invalidates after creation
- `assignToBatches()` — invalidates after batch link upsert
- `removeBatchAccess()` — invalidates after batch link deletion
- `updateBatchCurriculum()` — invalidates after curriculum change
- `deleteRecording()` — invalidates after deletion
- `updateRecording()` — invalidates after metadata change

Invalidation deletes the cache key for ALL students (not just affected batches). This is aggressive but simple: the system does not track which students belong to which batches at the cache layer, so it cannot do targeted invalidation.

## Alternatives Considered

### 1. No caching

Rejected because the student dashboard query hits 3-4 tables and runs on every page load. Without caching, database load scales linearly with concurrent students. At 100+ concurrent students, the dashboard queries would dominate database throughput.

### 2. Cache-aside with TTL only (no invalidation)

Rejected because stale data could persist for the TTL window. A student could see a recording for minutes after it was removed from their batch, or miss a recording for minutes after it was added. The team decided that stale data was unacceptable for access control.

### 3. Targeted invalidation (invalidate only affected students)

Rejected because it requires the cache layer to know the batch-to-student mapping. This would either duplicate the `batch_students` data in Redis (expensive) or require a join query on every invalidation (slow). The simplicity of blind global invalidation outweighed the precision of targeted invalidation.

### 4. Database-level caching (materialized views)

Rejected because materialized views require manual refresh and do not auto-invalidate on row changes. They also consume database storage and add complexity to schema migrations.

## Consequences

### Positive

- **Dramatically reduced database load:** Most student dashboard requests hit Redis instead of Supabase. The query complexity (3-4 joins) is paid once per mutation, not once per read.
- **Simple invalidation logic:** A single method `invalidateRecordingsCache()` clears all recording cache keys. No need to track which students are affected.
- **Fast reads:** Redis reads are sub-millisecond, compared to 10-50ms for a multi-join Supabase query.
- **No TTL management:** Cache entries live until explicitly invalidated. No stale data window.

### Negative

- **Cache stampede on write:** When ANY recording mutation occurs, ALL students' caches are invalidated. The next request from every student will miss cache and query Supabase. This creates a burst of database load after every admin action.
- **No partial invalidation:** Adding a recording to one batch invalidates caches for students in all batches, even those completely unaffected.
- **Redis dependency:** The student dashboard is unavailable if Redis is down (cache miss → Supabase query still works, but performance degrades).
- **Memory usage:** Each student's cached data includes their full recording list with progress. For 1000 students with 500 recordings each, this could be significant memory.

### Cache Stampede Mitigation

The current system does NOT implement stampede protection. The team accepts the risk because:

- Admin mutations are infrequent (tens per day, not per second)
- The burst of Supabase queries after invalidation is within database capacity
- If stampede becomes a problem, the fix is to add targeted invalidation or a short revalidation period

### Future Work

- Add targeted invalidation using batch-to-student mapping stored in a Redis set.
- Consider a write-through or write-behind pattern if cache stampede becomes a bottleneck.
- Add a cache health metric (hit rate, invalidation frequency) to monitoring dashboards.
- If Redis memory becomes a concern, add TTL-based eviction as a fallback (e.g., 1-hour TTL, with invalidation still used for immediate consistency).
