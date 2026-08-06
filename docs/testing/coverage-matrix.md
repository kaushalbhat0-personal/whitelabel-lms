# Coverage Matrix

## Feature × API × DB × UI

| # | Feature | Test File | Test Name | API | DB | UI | Notes |
|---|---------|-----------|-----------|-----|-----|-----|-------|
| 1 | Upload | `upload.spec.ts` | Admin uploads recording | ✓ | ✓ | ✗ | Verifies recording row, batch links, curriculum, upload URL |
| 2 | Assign (multi-batch) | `assignment.spec.ts` | Assign recording to both batches | ✓ | ✓ | ✗ | Batch links, curriculum, student visibility per batch |
| 3 | Cross-batch remove | `assignment.spec.ts` | Remove from one batch | ✓ | ✓ | ✗ | Visibility changes after removal |
| 4 | Curriculum customize | `curriculum.spec.ts` | Per-batch section/sort/visibility | ✓ | ✓ | ✗ | Also calls student grouped API endpoint |
| 5a | Playback URL | `playback.spec.ts` | Authorized student gets URL | ✓ | ✗ | ✗ | No DB assertion — Mux state is non-deterministic |
| 5b | Auth edge cases | `authorization.spec.ts` | 403/401/404 | ✓ | ✗ | ✗ | Status-code checks only, no DB side effects |
| 6 | Progress | `progress.spec.ts` | Watch → persist → refresh | ✓ | ✓ | ✗ | DB upsert verified |
| 7 | Remove+reassign | `assignment.spec.ts` | Full cycle remove | ✓ | ✓ | ✗ | Batch links + curriculum cleanup |
| 8 | Delete recording | `cleanup.spec.ts` | Delete → invisible | ✓ | ✓ | ✗ | DB row removal + API invisibility |
| 9 | Concurrent assign | `cleanup.spec.ts` | No duplicate rows | ✓ | ✓ | ✗ | Race condition detection |
| 10 | Regression cycle | `cleanup.spec.ts` | Full upload→delete cycle | ✓ | ✓ | ✗ | End-to-end pipeline |

## Score

| Layer | Tests Verified | Coverage |
|-------|----------------|----------|
| API | 11 / 11 | 100% |
| DB | 9 / 11 | 82% |
| UI | 0 / 11 | 0% |

## Missing Scenarios

### Critical Gaps

| Scenario | Why Missing | Priority |
|----------|-------------|----------|
| **Mux webhook simulation** | No test simulates `video.asset.ready` → recording stays `processing` | Medium |
| **Cleanup job execution** | `RecordingCleanupJob` cron is never triggered in tests | Medium |
| **UI browser tests** | No `page.goto()` interactions — student portal not covered | Low (separate project) |
| **Long-running progress** | Progress at 99% → 100% completion trigger not tested | Low |

### Low-Risk Gaps

| Scenario | Why Low Risk |
|----------|-------------|
| **Playback URL DB assertion** | Mux token generation is tested at unit level; E2E verifies API contract |
| **Auth 403/401/404 DB assertion** | No DB mutation occurs on auth failures — API status proves the guard |
| **Invalid batch ID on assign** | Covered by `validateCurriculumPayload` unit tests |
| **Empty payload validation** | Covered by `BadRequestException` unit tests |

---

# Assessments Module � Coverage Matrix

## Feature ? API ? DB ? UI

| # | Feature | Test File | API | DB | UI | Notes |
|---|---------|-----------|-----|-----|-----|-------|
| 1 | Attempt lifecycle | ttempt.spec.ts | ? | ? | ? | start?save?submit?grade?publish?result |
| 2 | Resume no-dup | ttempt.spec.ts | ? | ? | - | single in_progress attempt verified in DB |
| 3 | Max attempts | ttempt.spec.ts | ? | ? | - | 403 after max_attempts reached |
| 4 | Draft test blocked | ttempt.spec.ts | ? | - | - | 403 on start |
| 5 | Question CRUD | question-bank.spec.ts | ? | ? | - | create/update/archive/unarchive/delete + DB |
| 6 | Bulk import | question-bank.spec.ts | ? | ? | - | 3 questions + DB rows |
| 7 | Question validation | question-bank.spec.ts | ? | - | - | 400 on missing text |
| 8 | Question role guard | question-bank.spec.ts | ? | - | - | student 403 |
| 9 | Manual review | esults-review.spec.ts | ? | ? | - | pending?assign?review?publish + DB |
| 10 | Results list/detail | esults-review.spec.ts | ? | - | - | published data |
| 11 | Test analytics | esults-review.spec.ts | ? | ? | - | snapshot created + fetch |
| 12 | Rank ordering | esults-review.spec.ts | ? | - | - | higher marks ? rank 1 |
| 13 | Test create | 	est-management.spec.ts | ? | ? | - | draft + relations in DB |
| 14 | Test duplicate | 	est-management.spec.ts | ? | ? | - | (Copy) + same question links |
| 15 | Test status | 	est-management.spec.ts | ? | ? | - | draft?published?archived |
| 16 | Test delete | 	est-management.spec.ts | ? | ? | - | row removed |
| 17 | Batch visibility | 	est-management.spec.ts | ? | - | - | student sees own-batch tests only |
| 18 | Security (roles/ownership) | security.spec.ts | ? | - | - | 7 attack surfaces |
| 19 | No answer leak | security.spec.ts | ? | - | - | correct_answer absent |
| 20 | Browser attempt | rowser-ui.spec.ts | ? | - | ? | student completes in real browser |
| 21 | Review queue UI | rowser-ui.spec.ts | ? | - | ? | renders + expands, no crash |
| 22 | Mobile overflow | rowser-ui.spec.ts | - | - | ? | 390px no overflow |

## Score

| Layer | Tests Verified | Coverage |
|-------|----------------|----------|
| API | 22 / 22 | 100% |
| DB | 12 / 22 | 55% |
| UI | 3 / 22 | 14% (browser; API-backed asserts cover the rest) |

## Unit Coverage (service files)

| Service | Statements | Lines | Functions |
|---------|-----------|-------|-----------|
| AnalyticsService | 100% | 100% | 100% |
| AttemptsService | 90% | 98% | 100% |
| ResultsService | 88% | 92% | 84% |
| QuestionsService | 83% | 100% | 100% |
| EvaluationService | 80% | 85% | 82% |
| TestsService | 57% | 66% | 67% |

## Missing Scenarios (assessment)

| Scenario | Priority |
|----------|----------|
| shuffle_options runtime behavior (feature not implemented) | P2 |
| Timer-expiry server enforcement | P2 |
| Negative-marking end-to-end with published result | P3 |
| PATCH /tests/:id partial-relation data-loss guard | P3 |
