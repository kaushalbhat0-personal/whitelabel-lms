---
name: mct-admin-portal
description: Admin/superadmin portal structure and conventions (routes, data tables, modals, pagination, search, batch assignment, review queue, finance). Use when building or modifying admin pages.
---

# Skill: MCT LMS — Admin Portal

## Purpose
Consistent admin UX + avoid regressions from Phases 2/3.

## Architecture
Routes under `apps/web/src/app/admin/*`: analytics, announcements, audit-logs, batches/[id], bulk-upload, business-config, courses/[id], dashboard (root), email-logs, finance, monitoring, payments, performance, playback-analytics, questions, recordings, review-queue, sessions, students/[id], tests/{new,[id],[id]/edit}, violations.
Components in `components/ui/` (Button, Card, Badge, Modal, DataTable, ConfirmDialog) and `components/admin/**`.

## Rules
- All admin API calls hit endpoints guarded by `@Roles('admin')`; the page must still handle 403 gracefully (session may be stale).
- Data tables: server-side pagination (`page`, `limit`), search and filtering are API-side (Phase 3 added recording pagination/search/filters). Never client-filter large lists.
- Recording upload modal flow: `createRecording()` → `{ uploadUrl, upload }` → branch on `upload.kind`: `'tus'` runs the resumable TUS uploader (`lib/upload/tus-uploader.ts`, per-video presigned headers, progress + cancel supported); otherwise plain XHR PUT (legacy). Phase 7E made Bunny the default production provider — every new recording arrives as a TUS handle.
- Batch assignment happens post-upload via `assignToBatches`; curriculum entries auto-sync (batch_recording_curriculum) — deleting links requires the destruction-pipeline order: child rows → mappings → parent row.
- Review queue / violations / monitoring pages read security tables (playback_violations etc.) — treat as sensitive PII.

## Common Failure Modes (from RCCF history)
| Failure | Prevention |
|---|---|
| Unpaginated listing freezing tab | always wire `page/limit` + total count from API |
| Search firing per keystroke | debounce or search-on-submit |
| Deleting parent before children | FK errors — follow destruction pipeline |
| Double modals submitting twice | disable submit while pending; single-flight guard |

## Verification
Admin route sweep exists in E2E (`tests/e2e/recordings/assignment.spec.ts` etc.). After adding an admin page: typecheck web (`npx tsc --noEmit`) + exercise create/edit/delete against dev DB.

## Do Not
- Do not render raw provider identifiers as if they were URLs.
- Do not add client-side role logic — rely on API 403 + middleware gating.
