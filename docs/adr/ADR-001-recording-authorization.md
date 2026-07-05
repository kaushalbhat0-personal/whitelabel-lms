# ADR-001: Recording Authorization — Single Source of Truth

**Status:** Accepted  
**Date:** 2026-07-06  
**Deciders:** Architecture Team  

## Context

The LMS serves students enrolled in batches. Each recording should only be visible to students whose batch is authorized. There are two tables that could serve as the authorization source:

- `recording_batches` — a pure join table linking `recordings.id` to `batches.id`
- `batch_recording_curriculum` — the curriculum display table that also links recordings to batches but carries additional metadata (category, sort order, publish state)

The team needed a single, unambiguous source of truth for access control to avoid drift between tables and inconsistent authorization behavior.

## Decision

**`recording_batches` is the single source of truth for student recording access.**

- `validateAccess()` in `RecordingsService` queries ONLY `recording_batches` to determine if a student can view a recording.
- `batch_recording_curriculum` is NEVER consulted for authorization. It exists solely for curriculum display and progress tracking.
- Every mutation that affects a recording's batch visibility MUST write to `recording_batches`. The curriculum table is kept in sync as a secondary concern.

## Alternatives Considered

### 1. Use `batch_recording_curriculum` as the authorization source

Rejected because curriculum entries can be unpublished (`is_published = false`), soft-deleted, or reordered. Authorization should not depend on display-layer metadata. A student's right to view a recording should not change simply because an admin reorders the curriculum.

### 2. Use PostgreSQL Row-Level Security (RLS)

Rejected because the application layer already has a rich RBAC system with JWT-based roles (admin, teacher, student, support). Adding RLS policies would duplicate access logic in two places (application + database) and make debugging more difficult. RLS is used for tenant isolation (multi-org) but not for recording authorization.

### 3. Dual-source authorization (check both tables)

Rejected because it doubles query cost and introduces ambiguity: if the tables disagree, which one wins? The single-source approach makes the system's behavior deterministic and easy to reason about.

## Consequences

### Positive

- **Deterministic access control:** A student's access depends on exactly one table. There is no ambiguity.
- **Simple query path:** `batch_students → recording_batches → recordings` with no curriculum join for authorization.
- **Easy to audit:** A single query (`SELECT * FROM recording_batches WHERE recording_id = ?`) tells you who can access a recording.

### Negative

- **Sync obligation:** Every curriculum mutation that adds or removes a recording must also update `recording_batches`. This is enforced by `BatchCurriculumService` which upserts/deletes `recording_batches` rows in its `add()` and `remove()` methods. If this sync is missed, a recording can appear in the curriculum but be inaccessible to students.
- **Reconciliation needed:** A background job (`RecordingCurriculumReconciliationService`) detects and repairs drift between `recording_batches` and `batch_recording_curriculum`.
- **Extra join:** The authorization query requires a join from `batch_students` through `recording_batches` to `recordings`, which adds a query hop compared to directly checking `batch_recording_curriculum`.

### Future Work

- Consider adding a database-level assertion (trigger or NOT VALID constraint) that enforces `recording_batches` row existence before a `batch_recording_curriculum` row can reference a recording.
- Monitor reconciliation job frequency: if drift is rare, consider removing it.
