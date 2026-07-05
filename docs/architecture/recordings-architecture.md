# Recordings Module — Architecture Reference

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CONTROLLERS                                 │
│  recordings.controller.ts   mux.controller.ts   batch-curriculum   │
│                           (webhook)             controller.ts      │
└──────┬──────────────────────────┬──────────────────────┬───────────┘
       │                          │                      │
       ▼                          ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          SERVICES                                    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │               RecordingsService                               │    │
│  │  create()        requestUploadUrl()    createRecordingWith   │    │
│  │  assignToBatches() removeBatchAccess()  Upload()             │    │
│  │  updateBatchCurriculum() deleteRecording()                    │    │
│  │  validateAccess() fetchRecordingsForStudent()                │    │
│  │  updateProgress()                                              │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────────────────────────────┐                      │
│  │       BatchCurriculumService               │                      │
│  │  add()  update()  remove()  reorder()      │                      │
│  │  findAll()  findPublished()                │                      │
│  └────────────────────────────────────────────┘                      │
│                                                                      │
│  ┌─────────────────────────────────────────────────────┐             │
│  │  RecordingCurriculumReconciliationService            │             │
│  │  run()  detectDrift()  insertMissing()  deleteOrphan│             │
│  └─────────────────────────────────────────────────────┘             │
│                                                                      │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐       │
│  │     MuxService          │  │    PlaybackGuardService      │       │
│  │  handleAssetReady()     │  │  validateAccess()            │       │
│  │  createUploadUrl()      │  │  generatePlaybackUrl()       │       │
│  └─────────────────────────┘  └──────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────┘
       │                          │                      │
       ▼                          ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       INFRASTRUCTURE                                │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ Supabase │  │  Mux     │  │  Redis   │  │  Transaction      │   │
│  │ (DB)     │  │ (Video)  │  │ (Cache)  │  │  (Atomic Steps)   │   │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────────┘   │
│                                                                      │
│  JOBS:  recording-upload.job.ts  recording-cleanup.job.ts            │
└──────────────────────────────────────────────────────────────────────┘
```

## Core Data Model

```
recordings                    recording_batches            batches
┌───────────────┐             ┌─────────────────┐        ┌──────────┐
│ id            │──┐         │ recording_id    │──┐    │ id       │
│ title         │  │        │ batch_id        │  └─────│ name     │
│ description   │  └────────│ (PK composite)   │         │ ...     │
│ mux_asset_id  │            └─────────────────┘         └──────────┘
│ mux_playback_ │                                          ▲
│   id          │            batch_recording_curriculum    │
│ status        │            ┌──────────────────────┐      │
│ ...           │──┐        │ id                   │──┐   │
└───────────────┘  │        │ batch_id             │  │   │
                   │        │ content_id (=rec_id) │  └───│
                   └────────│ content_type         │      │
                            │ category_name        │      │
                            │ module_name          │      │
                            │ sort_order           │      │
                            │ is_published         │      │
                            │ title_override       │      │
                            │ pdf_url / pdf_title  │      │
                            └──────────────────────┘      │
                                                    ┌─────┘
                                                    │
                                            batch_students
                                            ┌──────────────┐
                                            │ user_id       │
                                            │ batch_id      │
                                            └──────────────┘
```

## Known Invariants

1. **`recording_batches` is the single source of truth for student access.** The `validateAccess()` method gates ALL student-facing recording access. `batch_recording_curriculum` is for display/progress only — never for authorization. (File: `recordings.service.ts:495`)

2. **Every curriculum mutation must also mutate `recording_batches`.** Adding a recording curriculum entry must upsert a row in `recording_batches`. Removing a recording curriculum entry must delete the corresponding `recording_batches` row. (File: `batch-curriculum.service.ts`, `recordings.service.ts`)

3. **The `requestUploadUrl()` endpoint (draft upload) does NOT create batch links or curriculum.** It is a single-responsibility endpoint — upload only. Batch assignment requires a separate call to `assignToBatches()` or use of `createRecordingWithUpload()`. (File: `recordings.service.ts:319`)

4. **`createRecordingWithUpload()` is the only upload path that atomically creates recording + batch links + curriculum.** It wraps everything in a Transaction with full rollback. (File: `recordings.service.ts:240`)

5. **All webhook handlers (`mux.controller.ts`) must be `@Public()`** because Mux cannot send JWTs. They must always return 200 (never throw to Mux or it retries). Signature verification is done against `req.rawBody`.

6. **Mux webhooks update recordings directly (outside services).** This is a known architectural debt — see Violation #2 in the compliance report.

7. **The `deleteRecording()` Transaction has 2 irreversible steps.** Steps 1 (delete curriculum) and 2 (delete batch links) have no-op rollbacks because the data is already deleted. This is an acknowledged design tradeoff: if Mux deletion subsequently fails, the recording is marked `cleanup_pending` for a reconciliation job to retry. (File: `recordings.service.ts:744-791`)

8. **`create()` (the admin direct-create method) writes to 3 tables without a Transaction.** This is the most critical Transaction gap in the module. (File: `recordings.service.ts:125-155`)

9. **`removeBatchAccess()` deletes from 2 tables sequentially without a Transaction.** If the second delete fails, curriculum entries are already removed but batch links remain. (File: `recordings.service.ts:441-482`)

10. **Curriculum progress is tracked in `batch_curriculum_item_progress`**, keyed to `batch_recording_curriculum.id`. This is separate from `video_progress` which tracks playback position.

## Upload Flow

```
Frontend                    Controller                 Service                  Supabase           Mux
   │                           │                        │                        │                 │
   │  POST /admin/upload-url   │                        │                        │                 │
   │─────────────────────────>│                        │                        │                 │
   │  { title: "..." }        │                        │                        │                 │
   │                           │──requestUploadUrl()──>│                        │                 │
   │                           │                        │──createDirectUpload───│────────────────>│
   │                           │                        │<──────{uploadUrl}──────│<────────────────│
   │                           │                        │                        │                 │
   │                           │                        │──INSERT recording──────│                 │
   │                           │                        │<──────{id,status}──────│                 │
   │                           │                        │                        │                 │
   │  <──{uploadUrl, recording}│                        │                        │                 │
   │                           │                        │                        │                 │
   │  PUT file to uploadUrl    │                        │                        │                 │
   │────────────────────────────────────────────────────────────────────────────────────────────>│
   │                           │                        │                        │                 │
   │  (browser uploads video)  │                        │                        │                 │
```

## Upload & Assign Flow (createRecordingWithUpload)

```
Frontend                    Controller                 Service                  Supabase
   │                           │                        │                        │
   │  POST /admin/recordings   │                        │                        │
   │  { batchIds: [...],       │                        │                        │
   │    title, category, ... } │                        │                        │
   │─────────────────────────>│                        │                        │
   │                           │──createRecordingWith──│                        │
   │                           │  Upload()             │                        │
   │                           │                        │                        │
   │                           │                        │──INSERT recording──────│
   │                           │                        │<──────{id,status}──────│
   │                           │                        │                        │
   │                           │     Transaction        │                        │
   │                           │     ┌─────────┐        │                        │
   │                           │     │ Step 1: │        │                        │
   │                           │     │ upsert  │        │──UPSERT recording_─────│
   │                           │     │batch    │        │  batches               │
   │                           │     │links +  │        │                        │
   │                           │     │curric.  │        │──UPSERT batch_recording│
   │                           │     └─────────┘        │  _curriculum           │
   │                           │     (or rollback)      │                        │
   │                           │                        │                        │
   │                           │──invalidateRedisCache──│──────────────────────>│
   │                           │                        │                        │
   │  <──{recording, uploadUrl}│                        │                        │
```

## Assignment Flow (assignToBatches)

```
Controller                 Service                     Supabase
   │                        │                             │
   │──assignToBatches()───>│                             │
   │                        │                             │
   │                        │  Transaction                │
   │                        │  ┌──────────────────┐       │
   │                        │  │ Step 1: UPSERT   │       │
   │                        │  │ recording_batches│──────>│
   │                        │  │ (batch links)    │       │
   │                        │  ├──────────────────┤       │
   │                        │  │ Step 2: UPSERT   │       │
   │                        │  │ batch_recording_ │──────>│
   │                        │  │ curriculum       │       │
   │                        │  └──────────────────┘       │
   │                        │  (rollback if either fails) │
   │                        │                             │
   │                        │──invalidateRedisCache──────>│
   │                        │                             │
   │<──{assignedCount}      │                             │
```

## Authorization Flow (validateAccess)

```
Student Request          RecordingsService         Supabase
   │                        │                        │
   │──fetchRecordings──────>│                        │
   │  ForStudent()          │                        │
   │                        │                        │
   │                        │  Step 1: Get student   │
   │                        │  batches              │
   │                        │──SELECT batch_students>│
   │                        │<──{batchIds}──────────│
   │                        │                        │
   │                        │  Step 2: Filter        │
   │                        │  recordings by batches │
   │                        │──SELECT recording_─────>│
   │                        │  batches WHERE batch   │
   │                        │  IN (student_batches)  │
   │                        │<──{recordingIds}──────│
   │                        │                        │
   │                        │  If 0 results:         │
   │                        │  RETURN [] (EARLY)     │
   │                        │                        │
   │                        │  Step 3: Fetch full    │
   │                        │  recording details     │
   │                        │──SELECT recordings────>│
   │                        │<──{recordings}────────│
   │                        │                        │
   │                        │  Step 4: Enrich with   │
   │                        │  progress + playback   │
   │                        │                        │
   │<──{recordings}         │                        │
```

## Webhook Flow (Mux)

```
Mux                        MuxController             MuxService          Supabase
 │                            │                        │                   │
 │ POST /mux/webhook          │                        │                   │
 │ video.upload.asset_created │                        │                   │
 │──────────────────────────>│                        │                   │
 │                            │──verify signature────>│                   │
 │                            │                        │                   │
 │                            │──UPDATE recordings────│──────────────────>│
 │                            │  SET mux_asset_id,    │                   │
 │                            │  mux_playback_id      │                   │
 │                            │                        │                   │
 │ POST /mux/webhook          │                        │                   │
 │ video.asset.ready          │                        │                   │
 │──────────────────────────>│                        │                   │
 │                            │──handleAssetReady()──>│                   │
 │                            │                        │──UPDATE recordings│
 │                            │                        │  SET status=ready │
 │                            │                        │  + durations etc  │
 │                            │                        │──────────────────>│
 │                            │                        │                   │
 │                            │──200 OK──────────────>│                   │
 │<──────────────────────────│                        │                   │
 │                            │                        │                   │
 │ (always returns 200)       │                        │                   │
```

## Cleanup Flow (deleteRecording)

```
Controller                 RecordingsService         Supabase              Mux
   │                        │                          │                    │
   │──deleteRecording(id)──>│                          │                    │
   │                        │                          │                    │
   │                        │  Transaction             │                    │
   │                        │  ┌───────────────────┐   │                    │
   │                        │  │ Step 1: DELETE     │   │                    │
   │                        │  │ batch_recording_   │──>│                    │
   │                        │  │ curriculum         │   │                    │
   │                        │  ├───────────────────┤   │                    │
   │                        │  │ Step 2: DELETE     │   │                    │
   │                        │  │ recording_batches  │──>│                    │
   │                        │  ├───────────────────┤   │                    │
   │                        │  │ Step 3: UPDATE     │   │                    │
   │                        │  │ recordings SET     │──>│                    │
   │                        │  │ cleanup_pending    │   │                    │
   │                        │  └───────────────────┘   │                    │
   │                        │  (steps 1-2 = no-op      │                    │
   │                        │   rollback, step 3       │                    │
   │                        │   rolls back cleanup)   │                    │
   │                        │                          │                    │
   │                        │──deleteAsset(muxId)─────│───────────────────>│
   │                        │                          │                    │
   │                        │  (if Mux fails,          │                    │
   │                        │   recording stays with   │                    │
   │                        │   cleanup_pending=true;  │                    │
   │                        │   reconciliation job     │                    │
   │                        │   retries later)         │                    │
```

## Caching Flow

```
Controller               RecordingsService           Redis
   │                        │                          │
   │──GET /recordings/my───>│                          │
   │                        │──fetchRecordingsFor─────>│
   │                        │  Student()               │
   │                        │                          │
   │                        │  Check cache:            │
   │                        │──GET recordings:student─>│
   │                        │  :{userId}               │
   │                        │<──(cache hit/miss)───────│
   │                        │                          │
   │                        │  (on cache miss:         │
   │                        │   query Supabase,        │
   │                        │   store result)          │
   │                        │                          │
   │                        │  (on mutation:           │
   │                        │   invalidate cache)      │
   │                        │──DEL recordings:student─>│
   │                        │  :{userId}               │
   │                        │                          │
```

## Transaction Flow

```
Transaction.run(steps[])
   │
   ├── Step 0: execute()
   │   └── on success: mark completed
   │   └── on failure: run rollback() → throw
   │
   ├── Step 1: execute()
   │   └── on success: mark completed
   │   └── on failure:
   │       ├── rollback step 1 (if completed)
   │       ├── rollback step 0 (if completed)
   │       └── throw original error
   │
   ├── Step N: execute()
   │   └── on success: done
   │   └── on failure:
   │       ├── rollback step N-1
   │       ├── ...
   │       ├── rollback step 0
   │       └── throw original error
   │
   └── Rollback errors are caught and logged (never propagated)
```

## Transaction Coverage Across the Module

| Method | Tables Written | Transaction | Rollback | Tested |
|--------|---------------|-------------|----------|--------|
| `createRecordingWithUpload()` | recordings, recording_batches, curriculum | ✅ | ✅ delete + delete | ❌ No tests |
| `create()` | recordings, recording_batches, curriculum | ❌ **MISSING** | Manual (recording delete only) | ❌ |
| `requestUploadUrl()` | recordings only | N/A (1 table) | N/A | ✅ |
| `assignToBatches()` | recording_batches, curriculum | ✅ | ✅ delete + delete | ⚠️ Partial |
| `removeBatchAccess()` | curriculum, recording_batches | ❌ **MISSING** | N/A | ✅ |
| `updateBatchCurriculum()` | recording_batches, curriculum | ✅ | ✅ upsert/delete + delete/upsert | ✅ |
| `deleteRecording()` | curriculum, recording_batches, recordings | ✅ | ⚠️ Steps 1-2 NO-OP | ❌ No rollback tests |
| `batchCurriculum.add()` | curriculum, recording_batches | ✅ | ✅ delete + delete | ⚠️ Partial |
| `batchCurriculum.remove()` | recording_batches, curriculum | ✅ | ⚠️ Step 2 NO-OP | ❌ Step 2 failure untested |
| `batchCurriculum.update()` | curriculum only | N/A (1 table) | N/A | ❌ |
| `batchCurriculum.reorder()` | curriculum only | N/A (1 table) | N/A | ❌ |
| `recording-upload.job` | upload_queue, recordings, recording_batches | ❌ **MISSING** | N/A | ❌ |
| `recording-cleanup.job` | recordings | ❌ **MISSING** | N/A | ❌ |
| `recording-curriculum-reconciliation` | curriculum | ❌ (expected) | N/A | ❌ |
| `courses.service.duplicate()` | curriculum | ❌ **MISSING** | N/A | ❌ |

## Database Flow Summary

```
                ┌──────────────────────────────────────────────┐
                │              RECORDINGS                       │
                │  ┌─────────┐  ┌──────────┐  ┌──────────────┐ │
                │  │ INSERT  │  │ UPDATE   │  │   DELETE     │ │
                │  │ create()│  │ update() │  │ deleteRecord │ │
                │  │ request │  │ mux web- │  │ ing()        │ │
                │  │ Upload  │  │ hook     │  │ cleanup.job  │ │
                │  │ Url()   │  │ handle   │  │              │ │
                │  │ create  │  │ Asset    │  │              │ │
                │  │ Record  │  │ Ready()  │  │              │ │
                │  │ ingWith │  │          │  │              │ │
                │  │ Upload()│  │          │  │              │ │
                │  │ upload  │  │          │  │              │ │
                │  │ job     │  │          │  │              │ │
                │  └─────────┘  └──────────┘  └──────────────┘ │
                └──────────────────────────────────────────────┘
                                      │
                                      │ PK: id
                                      ▼
                ┌──────────────────────────────────────────────┐
                │           RECORDING_BATCHES                   │
                │  ┌─────────┐  ┌──────────┐  ┌──────────────┐ │
                │  │ UPSERT  │  │ INSERT   │  │   DELETE      │ │
                │  │ assign  │  │ create() │  │ removeBatch   │ │
                │  │ ToBatch │  │ upload   │  │ Access()      │ │
                │  │ es()    │  │ job      │  │ deleteRecord  │ │
                │  │ update  │  │          │  │ ing()         │ │
                │  │ Batch   │  │          │  │ batchCurric   │ │
                │  │ Curric  │  │          │  │ ulum.remove() │ │
                │  │ ulum()  │  │          │  │              │ │
                │  │ batch   │  │          │  │              │ │
                │  │ Curric  │  │          │  │              │ │
                │  │ ulum    │  │          │  │              │ │
                │  │ .add()  │  │          │  │              │ │
                │  └─────────┘  └──────────┘  └──────────────┘ │
                └──────────────────────────────────────────────┘
                                      │
                                      │ FK: recording_id, batch_id
                                      ▼
                ┌──────────────────────────────────────────────┐
                │       BATCH_RECORDING_CURRICULUM              │
                │  ┌─────────┐  ┌──────────┐  ┌──────────────┐ │
                │  │ UPSERT  │  │ INSERT   │  │   DELETE      │ │
                │  │ assign  │  │ batch    │  │ removeBatch   │ │
                │  │ ToBatch │  │ Curric   │  │ Access()      │ │
                │  │ es()    │  │ ulum     │  │ deleteRecord  │ │
                │  │ update  │  │ .add()   │  │ ing()         │ │
                │  │ Batch   │  │ reconcil │  │ batchCurric   │ │
                │  │ Curric  │  │ iation   │  │ ulum.remove() │ │
                │  │ ulum()  │  │ courses  │  │ reconcil      │ │
                │  │ create  │  │ .duplic  │  │ iation        │ │
                │  │ Record  │  │ ate()    │  │              │ │
                │  │ ingWith │  │          │  │              │ │
                │  │ Upload  │  │          │  │              │ │
                │  │ ()      │  │          │  │              │ │
                │  └─────────┘  └──────────┘  └──────────────┘ │
                └──────────────────────────────────────────────┘
```

## Sequence Diagrams

### Student Fetches Recordings

```
Student              Next.js              API                  Supabase              Redis
   │                    │                  │                      │                    │
   │  /student/videos   │                  │                      │                    │
   │───────────────────>│                  │                      │                    │
   │                    │──GET /recordings │                      │                    │
   │                    │  /my             │                      │                    │
   │                    │─────────────────>│                      │                    │
   │                    │                  │──fetchRecordings────>│                    │
   │                    │                  │  ForStudent(userId)  │                    │
   │                    │                  │                      │                    │
   │                    │                  │  Check cache:        │                    │
   │                    │                  │───────────────────────────────────────────>│
   │                    │                  │<───────────────────────────────────────────│
   │                    │                  │  (cache miss)       │                    │
   │                    │                  │                      │                    │
   │                    │                  │──SELECT batch_──────>│                    │
   │                    │                  │  students            │                    │
   │                    │                  │<──{batchIds}────────│                    │
   │                    │                  │                      │                    │
   │                    │                  │──SELECT recording───>│                    │
   │                    │                  │  _batches WHERE      │                    │
   │                    │                  │  batch_id IN (...)   │                    │
   │                    │                  │                      │                    │
   │                    │                  │  IF 0 results:       │                    │
   │                    │                  │  RETURN []           │                    │
   │                    │                  │                      │                    │
   │                    │                  │──SELECT recordings──>│                    │
   │                    │                  │  WHERE id IN (...)   │                    │
   │                    │                  │<──{recordings}──────│                    │
   │                    │                  │                      │                    │
   │                    │                  │──Store in cache─────>│                    │
   │                    │                  │───────────────────────────────────────────>│
   │                    │                  │                      │                    │
   │                    │<──{recordings}───│                      │                    │
   │                    │                  │                      │                    │
   │  <──Page render───│                   │                      │                    │
```

### Admin Creates Recording with Upload

```
Admin                Frontend             API Controller         RecordingsService     Supabase/Mux
   │                    │                      │                      │                   │
   │  Click "Upload"    │                      │                      │                   │
   │───────────────────>│                      │                      │                   │
   │                    │──POST /admin/───────>│                      │                   │
   │                    │  recordings          │                      │                   │
   │                    │                      │──createRecordingWith │                   │
   │                    │                      │  Upload(dto)         │                   │
   │                    │                      │─────────────────────>│                   │
   │                    │                      │                      │                   │
   │                    │                      │                      │──createUploadUrl  │
   │                    │                      │                      │──────────────────>│
   │                    │                      │                      │<──uploadUrl──────│
   │                    │                      │                      │                   │
   │                    │                      │                      │──INSERT recording │
   │                    │                      │                      │─>Supabase         │
   │                    │                      │                      │<──recording row───│
   │                    │                      │                      │                   │
   │                    │                      │     Transaction      │                   │
   │                    │                      │     ┌────────────────┐                   │
   │                    │                      │     │ upsert batch   │                   │
   │                    │                      │     │ links +        │─>Supabase         │
   │                    │                      │     │ curriculum     │<──OK──────────────│
   │                    │                      │     └────────────────┘                   │
   │                    │                      │                      │                   │
   │                    │                      │                      │──invalidateCache  │
   │                    │                      │                      │─>Redis            │
   │                    │                      │                      │                   │
   │                    │<──{recording,        │                      │                   │
   │                    │  uploadUrl}          │                      │                   │
   │                    │                      │                      │                   │
   │  <──Upload UI─────│                       │                      │                   │
```

### Mux Webhook Processing

```
Mux                    API Controller           MuxService           Supabase
   │                       │                      │                    │
   │  video.upload.asset   │                      │                    │
   │  _created             │                      │                    │
   │──────────────────────>│                      │                    │
   │                       │──verify signature   │                    │
   │                       │──UPDATE recordings──│───────────────────>│
   │                       │  SET mux_asset_id   │                    │
   │                       │  = ..., status =    │                    │
   │                       │  'processing'       │                    │
   │                       │                      │                    │
   │  <──200 OK────────────│                      │                    │
   │                       │                      │                    │
   │  video.asset.ready    │                      │                    │
   │──────────────────────>│                      │                    │
   │                       │──verify signature   │                    │
   │                       │──handleAssetReady──>│                    │
   │                       │  (asset_id,          │──fetch from S3────>│
   │                       │   playback_id)       │──UPDATE recordings│
   │                       │                      │  SET status =     │
   │                       │                      │  'ready',         │
   │                       │                      │  duration_seconds │
   │                       │                      │  = ...            │
   │                       │                      │───────────────────>│
   │                       │                      │                    │
   │  <──200 OK────────────│                      │                    │
```

## Compliance Report

### Architecture Compliance Score: **52/100**

### Violations

#### CRITICAL (Severity: Critical)

| # | Violation | File | Line | Impact |
|---|-----------|------|------|--------|
| V1 | **`create()` — 3-table write without Transaction** | `recordings.service.ts` | 125-155 | Inserts into `recordings`, `recording_batches`, and `batch_recording_curriculum` sequentially. If the curriculum upsert fails, the recording and batch links already exist with no automatic rollback. Only the recording is manually deleted on batch-link failure; there is no rollback if curriculum creation fails after batch links. |
| V2 | **`removeBatchAccess()` — 2-table delete without Transaction** | `recordings.service.ts` | 441-482 | Deletes from `batch_recording_curriculum` first, then `recording_batches`. If step 2 fails, curriculum entries are already removed but batch links remain — students retain access but curriculum display is gone. |
| V3 | **`recording-upload.job.ts` — 3-table write without Transaction** | `recording-upload.job.ts` | 76-131 | Updates `upload_queue`, inserts into `recordings`, inserts into `recording_batches`, updates `upload_queue` again. No rollback on any failure. If batch link insert fails, the recording and upload_queue status are left in inconsistent state. |
| V4 | **`mux.controller.ts` — 3 direct DB writes in webhook** | `mux.controller.ts` | 93-100, 143-146, 166-169 | Three of four Mux webhook handlers (`video.upload.asset_created`, `video.asset.errored`, `video.asset.deleted`) write directly to `recordings` table instead of delegating to `MuxService`. Only `video.asset.ready` properly delegates to `muxService.handleAssetReady()`. |
| V5 | **`createRecordingWithUpload()` — zero test coverage** | `recordings.service.spec.ts` | — | This method has a 1-step Transaction with rollback and an outer orphan-recording cleanup block. Despite being a core upload path, there are zero tests for success, failure, or rollback behavior. |

#### HIGH (Severity: High)

| # | Violation | File | Line | Impact |
|---|-----------|------|------|--------|
| V6 | **`deleteRecording()` — steps 1-2 have no-op rollbacks** | `recordings.service.ts` | 755-757, 768-770 | Steps 1 (delete curriculum) and 2 (delete batch links) have rollbacks that just log warnings: "Cannot roll back curriculum/batch-link deletion". If Mux asset deletion (step 3+) fails, the DB references are already permanently removed. The recording is left as an orphan row marked `cleanup_pending`. |
| V7 | **`batch-curriculum.remove()` — step 2 has no-op rollback** | `batch-curriculum.service.ts` | 296-298 | The `delete-curriculum-item` step's rollback logs "Cannot rollback curriculum item deletion" — if this step succeeds but a subsequent step (if any) fails, the curriculum deletion cannot be undone. |
| V8 | **`assignToBatches()` tests — rollback not verified** | `recordings.service.spec.ts` | 348-394 | Two error tests verify that `BadRequestException` is thrown when curriculum upsert fails, but they never assert that the first-step rollback (deleting the recording_batches rows) was actually executed. The Transaction's internal rollback runs untested. |
| V9 | **`batch-curriculum.remove()` — step 2 failure untested** | `batch-curriculum.service.spec.ts` | — | No test covers the scenario where `delete-recording-batch-link` succeeds but `delete-curriculum-item` fails, which would trigger the re-insert rollback of the batch link. |

#### MEDIUM (Severity: Medium)

| # | Violation | File | Line | Impact |
|---|-----------|------|------|--------|
| V10 | **`zoom.controller.ts` — 3 direct DB queries + inline business logic** | `zoom.controller.ts` | 54-58, 66-68, 71-74, 76, 82-86, 88-89 | Session lookup, batch access check, user batch resolution — all inline. The session status check (`if session.status !== 'live'`) and batch authorization logic should be in `ZoomService`. |
| V11 | **`auth.controller.ts` — direct DB query** | `auth.controller.ts` | 110-114 | `getProfile()` queries `profiles` table via `supabaseService.client` directly instead of calling `AuthService.getProfile()`. |
| V12 | **`email.controller.ts` — inline HMAC verification** | `email.controller.ts` | 57-99 | Full Resend webhook signature verification (HMAC computation, timing-safe comparison, timestamp validation) inline in controller. |
| V13 | **`uploads.controller.ts` — direct storage operations** | `uploads.controller.ts` | 24-30, 37-40 | Supabase Storage file upload and signed URL creation inline. Also missing `@Roles()` decorator. |
| V14 | **`recording-cleanup.job.ts` — no Transaction** | `recording-cleanup.job.ts` | 144-199 | Multi-step retry logic (update retry count, conditionally mark cleanup_failed, conditionally delete row) has no Transaction. A failure between incrementing retry_count and setting cleanup_failed could leave stale state. |
| V15 | **`courses.service.duplicate()` — curriculum insert outside Transaction** | `courses.service.ts` | 208-223 | Course duplication copies curriculum entries via direct insert without Transaction. If one batch's entries fail to copy, previous batches' insertions are not rolled back. |

#### LOW (Severity: Low)

| # | Violation | File | Line | Impact |
|---|-----------|------|------|--------|
| V16 | **`recording-curriculum-reconciliation.service.ts` — no Transaction** | `reconciliation/recording-curriculum-reconciliation.service.ts` | 125-177 | The reconciliation service is expected to be best-effort (it repairs drift between tables). Not wrapping in Transaction is an acceptable tradeoff, but it means a partial repair could leave inconsistent state that requires a second run. |
| V17 | **`batch-curriculum.add()` — rollback not explicitly asserted in tests** | `batch-curriculum.service.spec.ts` | 81 | The test exercises the rollback path (FK violation on batch link upsert triggers curriculum delete rollback) but only asserts the exception type, not that the rollback delete was actually called. |
| V18 | **3 Transaction-using services have no spec files** | `live-sessions.service.spec.ts`, `evaluation.service.spec.ts`, `payments.service.spec.ts` | — | These services use `Transaction` for multi-step mutations but have zero test files, meaning their Transaction rollback behavior is completely untested. |
