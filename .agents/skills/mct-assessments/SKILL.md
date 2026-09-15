---
name: mct-assessments
description: Assessment engine lifecycle and DB contracts (question bank, tests, sections, attempts, answers, grading, review queue, results, analytics). Use when touching tests, attempts, questions, evaluation, results, or analytics.
---

# Skill: MCT LMS — Assessments

## Purpose
Prevent re-breaking the attempt/grading lifecycle that Phases 5/5A stabilized.

## Architecture
```
Question Bank (question_bank)
  → Test (tests: draft|published|scheduled|active|closed|archived)
    → Sections (test_sections) + mappings
        test_questions (inline mcq|short_answer|long_answer)
        test_question_bank (bank refs; marks, sort_order, section_id, UNIQUE(test_id,question_bank_id))
  → Assignment: test_batches UNIQUE(test_id,batch_id)      ← authorization source of truth
  → Attempt (test_attempts: in_progress|submitted|evaluated|partially_evaluated|published;
             attempt_number, started_at/submitted_at/last_saved_at, updated_at)
  → Answers (test_answers UNIQUE(attempt_id, question_id); is_manual_review, evaluated_by)
  → Submit → auto-grade (mcq) → manual review queue (test_review_queue:
             pending|in_review|reviewed, UNIQUE(attempt_id, question_id))
  → Publish → test_results (UNIQUE per attempt; percentage, rank, passed)
  → Analytics snapshots (test_analytics_snapshots; calculated_at ordering matters — Phase 5A fix)
```

## Database Contracts (drift incidents ALREADY FIXED — never reintroduce)
| Incident | Fact |
|---|---|
| `test_answers.sort_order` | **Column does NOT exist** in live DB. Code was fixed to stop inserting it (P0 500 on attempt start). |
| `test_attempts.updated_at` | Added by migration 033 after grade/publish/review all 500'd with PGRST204. Updates in evaluation.service rely on it. |
| `test_attempts.status` CHECK | only the five states above; 'published' gates result visibility. |
| `test_analytics_snapshots.created_at`/`calculated_at` | analytics ordering bug fixed in 5A — order by calculated_at desc, take first. |
| Answer leakage | correct answers/options flags must NEVER be returned to students during attempts (fixed in Phase 5). |
| Visibility (!inner) | student "visible tests" joins `test_batches` + `batch_students` with inner joins — tests without batches are admin-only. |

## Rules
- Timer/server-side state: Redis `attempt_checkpoint:<id>` (24 h autosave), `attempt_timer:<id>` (3 h cap). Client time is never authoritative.
- Grading flow: autoGrade → partially_evaluated when manual answers exist → review → published. Publishing computes results atomically per attempt.
- Manual review updates must write both `test_answers` (marks, evaluated_by) and the queue row status.
- Rank/percentage computed at publish; do not recompute ad hoc.

## Common Failure Modes
- Assuming DTO shape = DB shape (see skill mct-schema-drift).
- Returning full question rows (with correct answers) to students.
- Writing status values outside the CHECK constraints.
- Skipping `updated_at` on attempt updates (PGRST204).

## Verification
- Unit: specs under modules/{tests,attempts,questions,evaluation,results,analytics}.
- E2E: `tests/e2e/assessments/*` (attempt, security, review, results, browser-ui).
- Docs: `docs/testing/assessments-tests.md`, `assessments-performance-report.md`, `production-freeze-assessments.md`.

## Do Not
- Do not add columns to persistence code without a migration + live verification.
- Do not let students hit evaluation/results endpoints for unpublished attempts (403 expected).
