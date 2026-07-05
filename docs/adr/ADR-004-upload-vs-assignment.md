# ADR-004: Upload vs. Assignment — Two Distinct Operations

**Status:** Accepted  
**Date:** 2026-07-06  
**Deciders:** Architecture Team  

## Context

The admin workflow for publishing a recording involves two conceptually distinct operations:

1. **Upload:** Upload a video file to Mux and create a recording row in the database
2. **Assignment:** Link the recording to one or more batches so students can see it

These operations have different:
- **User intent:** Upload is a technical action (get the file ready). Assignment is a content action (decide who sees it).
- **Atomicity requirements:** Assignment must be atomic (recording + batch links + curriculum all succeed or fail together). Upload is a single-table insert.
- **Failure modes:** Upload failures are Mux-side (network, encoding). Assignment failures are DB-side (FK violations, constraints).

Initially, the system had a single endpoint that always performed both operations. The team observed two problems:

1. The frontend used the wrong endpoint for manual uploads (`ManualUploadModal` called the upload-only endpoint, expecting batch assignment to happen automatically)
2. The upload-only endpoint was polluted with batch assignment logic, violating single-responsibility

## Decision

**Split upload and assignment into two distinct operations with separate endpoints.**

### Upload Only (Draft)

```
POST /admin/upload-url → requestUploadUrl(dto: { title })
```

- Creates a recording row and a Mux direct upload URL
- Accepts ONLY a title — no batch IDs, no curriculum metadata
- Returns `{ uploadUrl, recording }`
- The recording starts in `processing` status with no batch links and no curriculum
- Responsibility: Single — video ingestion

### Upload + Assign (Full)

```
POST /admin/recordings → createRecordingWithUpload(dto: { title, batchIds, ... })
```

- Creates a recording row and a Mux direct upload URL
- Requires `batchIds` (validated with `@ArrayMinSize(1)`)
- Atomically creates recording + batch links + curriculum entries via Transaction
- Returns `{ uploadUrl, recording }`
- The recording is immediately visible to students in the target batches
- Responsibility: Video ingestion + content publishing

### Assignment Only (Post-hoc)

```
POST /admin/recordings/:id/batches → assignToBatches(id, batchIds)
DELETE /admin/recordings/:id/batches → removeBatchAccess(id, batchIds)
PATCH /admin/recordings/:id/batch-curriculum → updateBatchCurriculum(id, dto)
```

- Operate on an existing recording
- Modify batch links and curriculum metadata independently
- Use Transaction for atomicity
- Responsibility: Content management after ingestion

## Alternatives Considered

### 1. Single endpoint: always upload + assign (batchIds required)

Rejected because the frontend needs a draft upload flow (upload first, assign later). The `ManualUploadModal` lets admins upload a file quickly without deciding which batches to assign. Forcing immediate batch selection would slow down the upload workflow.

### 2. Single endpoint: always upload, never assign (batch assignment via separate call only)

Rejected because the admin's most common workflow is "upload and immediately publish." Making them always take two steps would add friction to the primary use case.

### 3. Accept batchIds as optional on upload endpoint

Tried and rejected. The `requestUploadUrl()` method was modified to accept optional batchIds, creating a mixed-responsibility endpoint. This violated the single-responsibility principle: a draft upload endpoint shouldn't decide who can see the content. The change was reverted.

## Consequences

### Positive

- **Clear separation of concerns:** Each endpoint does exactly one thing. The upload endpoint doesn't know about batches. The assignment endpoint doesn't know about Mux.
- **Flexible frontend workflows:** The `ManualUploadModal` can use the draft upload endpoint for quick uploads, while the `UploadRecordingModal` uses the full endpoint for one-click publish.
- **Simpler error handling:** Upload failures don't need to worry about batch link cleanup. Assignment failures don't need to worry about Mux upload cleanup.
- **Testable in isolation:** Upload and assignment can be tested independently.

### Negative

- **Extra endpoint complexity:** Three endpoint families instead of one.
- **Inconsistent recording state:** Draft uploads create recordings with no batch links, which are invisible to all students. Admin must remember to assign them.
- **Frontend must choose correctly:** If the frontend uses the upload endpoint when it should use the full endpoint (or vice versa), the recording ends up in the wrong state. This was the root cause of the original production bug.

### Future Work

- Add a dashboard view showing "unassigned recordings" (recordings with no `recording_batches` rows) so admins can easily find draft uploads that need batch assignment.
- Consider adding an optional "assign later" flow in the full upload endpoint that allows batchIds to be empty but warns the admin.
- The `ManualUploadModal` should consider switching to the full endpoint as the primary path, with a "draft" checkbox for the upload-only flow.
