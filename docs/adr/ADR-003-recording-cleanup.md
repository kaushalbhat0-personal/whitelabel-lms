# ADR-003: Recording Cleanup — Two-Phase Delete with Reconciliation

**Status:** Accepted  
**Date:** 2026-07-06  
**Deciders:** Architecture Team  

## Context

Deleting a recording requires two distinct operations:

1. **Database cleanup:** Remove rows from `batch_recording_curriculum`, `recording_batches`, and `recordings`
2. **Mux asset deletion:** Delete the video asset from Mux's CDN (an async external API call)

These operations have fundamentally different reliability characteristics:
- Database operations are fast (~10ms) and reliable
- Mux API calls are slow (~500ms–5s) and can fail due to network issues, rate limits, or Mux service degradation

The team needed a strategy that handles partial failures without blocking the admin or leaving untracked orphan state.

## Decision

**Two-phase delete with `cleanup_pending` flag and reconciliation retry.**

### Phase 1: Database cleanup (Transaction — synchronous)

1. Delete from `batch_recording_curriculum` (irreversible — no rollback)
2. Delete from `recording_batches` (irreversible — no rollback)
3. Update `recordings` SET `cleanup_pending = true` (rollback: revert flag)

Steps 1-2 have no-op rollbacks (the data is already deleted). Step 3 has a proper rollback that reverts the flag. This is a deliberate trade-off: we accept that if Mux deletion subsequently fails, the database references are permanently gone, but the recording row remains marked as `cleanup_pending`.

### Phase 2: Mux asset deletion (outside Transaction — async)

After the Transaction succeeds, the service attempts to delete the Mux asset. If this fails:

- The `recordings` row remains with `cleanup_pending = true`
- A reconciliation job (`RecordingCleanupJob`) periodically scans for `cleanup_pending` recordings and retries Mux deletion
- After a configurable retry limit, the recording is marked `cleanup_failed` for manual intervention

## Alternatives Considered

### 1. Delete Mux asset first, then DB

Rejected because if Mux deletion succeeds but DB deletion fails, the Mux asset is permanently lost but the DB thinks the recording still exists. This is unrecoverable without manual Mux intervention.

### 2. Soft-delete everything

Rejected because recording data is large (Mux playback IDs, asset IDs, metadata) and keeping soft-deleted rows indefinitely would bloat the database. Also, Mux billing continues for undeleted assets.

### 3. Queue-based deletion with guaranteed delivery

Rejected as over-engineered for current scale. The reconciliation job provides a simple retry mechanism without a message queue dependency.

### 4. Synchronous Mux deletion before DB cleanup

Rejected because a slow or failing Mux API call would block the admin's HTTP request for an unbounded time. The admin experience should not depend on Mux responsiveness.

## Consequences

### Positive

- **Fast admin experience:** The database cleanup completes in milliseconds, and the admin gets an immediate response. Mux cleanup happens asynchronously.
- **No orphan Mux assets:** Every recording deletion tracks its intent via `cleanup_pending`. The reconciliation job ensures Mux assets are eventually deleted.
- **Simple failure model:** Recording is either fully deleted, or it's marked for retry. There's no ambiguous intermediate state.

### Negative

- **Irreversible DB deletes:** If the reconciliation job fails permanently (e.g., Mux API key revoked), the DB references are already gone. Manual intervention is required.
- **Stale `cleanup_pending` rows:** If the reconciliation job is not running or fails to process a row, it stays in the database indefinitely as dead data.
- **Two-phase complexity:** The split between Transaction (DB cleanup) and non-Transaction (Mux deletion) means the cleanup logic spans two coordination models.

### Future Work

- Add a manual admin endpoint to force-retry `cleanup_failed` recordings.
- Consider adding a TTL: recordings stuck in `cleanup_pending` for >30 days should trigger an alert.
- If the system grows to need stronger guarantees, migrate to a queue-based deletion model with exactly-once delivery.
