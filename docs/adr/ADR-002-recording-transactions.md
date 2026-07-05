# ADR-002: Recording Transactions — Application-Level Atomicity

**Status:** Accepted  
**Date:** 2026-07-06  
**Deciders:** Architecture Team  

## Context

Most recording operations span multiple tables. For example:

- **Upload + assign:** Insert into `recordings`, upsert into `recording_batches`, upsert into `batch_recording_curriculum`
- **Assign to batches:** Upsert into `recording_batches`, upsert into `batch_recording_curriculum`
- **Delete recording:** Delete from `batch_recording_curriculum`, delete from `recording_batches`, update `recordings` (cleanup_pending), then delete Mux asset

Supabase (PostgREST) does not expose database-level transactions through its REST API. Each `.from(table).insert(...)` call is an independent HTTP request. The team needed a way to ensure atomicity across these multi-table operations.

## Decision

**Use a lightweight application-level `Transaction` utility that executes steps sequentially and rolls back completed steps on failure.**

The `Transaction` class (`src/common/utils/transaction.util.ts`) works as follows:

1. Accepts an ordered array of `{ name, execute, rollback }` steps
2. Executes each step's `execute` function in order
3. If a step fails, runs `rollback` on all previously completed steps in reverse order
4. Re-throws the original error (rollback errors are caught and logged but never propagated)

This is a **best-effort** atomicity model — it is NOT a true database transaction. There is no `COMMIT` or `ROLLBACK` at the database level.

## Alternatives Considered

### 1. Supabase RPC (stored procedures)

Rejected because it would move business logic into PostgreSQL stored procedures, splitting the application's domain logic across two languages (TypeScript + PL/pgSQL). This makes debugging, testing, and version control harder. The team prefers to keep domain logic in TypeScript.

### 2. True database transactions via `pg` driver directly

Rejected because it would bypass Supabase's PostgREST client entirely, requiring raw SQL queries for all multi-table operations. This loses the type safety, filtering, and select capabilities of the PostgREST ORM layer.

### 3. Eventual consistency with compensation

Rejected for operations where consistency is critical (e.g., creating a recording and assigning it to batches within the same request). A student could see a recording in their authorized list before curriculum entries exist. The team decided that atomicity was worth the complexity for recording operations.

### 4. Saga pattern with message queue

Rejected as over-engineered for the current scale. The team may revisit this if the system grows to need distributed transactions across service boundaries.

## Consequences

### Positive

- **Atomic multi-table writes:** The `Transaction` utility ensures that either all steps complete or all completed steps are rolled back. This prevents orphan rows and inconsistent state.
- **Testable:** Each step's execute and rollback are isolated functions that can be unit tested independently.
- **Self-documenting:** The list of steps makes the write path explicit and readable.
- **No infrastructure dependency:** Unlike sagas or distributed transactions, this requires no message broker or coordinator.

### Negative

- **Not a true database transaction:** There is a window between steps where a concurrent reader could see partial state. For current throughput levels (single-server, <100 concurrent users), this is acceptable.
- **Rollback is best-effort:** The `rollback` function is application code — it can fail. The Transaction catches rollback errors but cannot guarantee cleanup. Some operations (deletes) have inherently irreversible rollbacks (see ADR-003).
- **No isolation:** The Transaction does not provide snapshot isolation or row-level locking. Concurrent writes to the same recording could interleave.
- **Must be used consistently:** If a developer adds a new mutation method without Transaction, the atomicity guarantee is broken. This requires code review discipline.

### Design Constraints

1. Every mutation that writes to more than one table MUST use `Transaction`.
2. Every `Transaction` step MUST have both an `execute` and a `rollback` function.
3. Rollback should be safe to call even if the execute never fully completed (idempotent).
4. Steps should be granular (one DB operation per step) for finer rollback granularity.

### Known Gaps

At time of writing, the following mutations do NOT use `Transaction`:

- `removeBatchAccess()` — deletes from `batch_recording_curriculum` then `recording_batches` sequentially
- `recording-upload.job.ts` — processes Zoom recordings across 3 tables
- `recording-cleanup.job.ts` — multi-step retry logic
- `courses.service.duplicate()` — inserts curriculum entries during course duplication

These are tracked as technical debt (see Architecture Compliance Audit).
