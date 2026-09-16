import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { SupabaseService } from '../../common/services/supabase.service';
import { PlaybackGuardService } from '../playback/playback-guard.service';
import { RecordingProviderResolver } from '../video-provider/recording-provider.resolver';
import { ObservabilityService } from '../observability/observability.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';
import { Transaction, TransactionStep } from '../../common/utils/transaction.util';
import { logEntityEvent } from '../../common/utils/observability-helper';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { CreateTopicDto } from '../videos/dto/create-topic.dto';
import { RequestUploadDto } from '../videos/dto/request-upload.dto';
import { UpdateBatchCurriculumDto, BatchCurriculumAssignment } from './dto/update-batch-curriculum.dto';
import { UpdateRecordingDto } from './dto/update-recording.dto';
import { UpdateVideoProgressDto } from '../videos/dto/update-video-progress.dto';

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly redis: Redis;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly playbackGuard: PlaybackGuardService,
    private readonly observabilityService: ObservabilityService,
    private readonly redisCache: RedisCacheService,
    private readonly providerResolver: RecordingProviderResolver,
    redisService: RedisService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  // ── Topics ────────────────────────────────────────────────

  /**
   * Create a new topic.
   * @param dto - Topic name and optional description/sort order.
   * @returns The created topic row.
   * @throws BadRequestException on DB insert failure.
   */
  async createTopic(dto: CreateTopicDto) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.TOPICS)
      .insert({
        name: dto.name,
        description: dto.description ?? null,
        sort_order: dto.sortOrder ?? 0,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create topic: ${error.message}`);
      throw new BadRequestException('Failed to create topic');
    }

    return data;
  }

  /**
   * List all topics ordered by sort_order ascending.
   * @returns Array of topic rows, each with a recordings count.
   * @throws BadRequestException on DB query failure.
   */
  async getTopics() {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.TOPICS)
      .select('*, recordings(count)')
      .order('sort_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch topics: ${error.message}`);
      throw new BadRequestException('Could not retrieve topics');
    }

    return data ?? [];
  }

  /**
   * Fetch a single topic with its recordings.
   * @param id - Topic UUID.
   * @returns Topic row with nested recordings array.
   * @throws NotFoundException if the topic does not exist.
   */
  async getTopicById(id: string) {
    const { data: topic, error: topicError } = await this.supabaseService.client
      .from(TABLES.TOPICS)
      .select('*')
      .eq('id', id)
      .single();

    if (topicError || !topic) {
      throw new NotFoundException('Topic not found');
    }

    const { data: recordings } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('*')
      .eq('topic_id', id)
      .order('sort_order', { ascending: true });

    return { ...topic, recordings: recordings ?? [] };
  }

  // ── Recording CRUD ────────────────────────────────────────

  /**
   * Create a recording with direct-to-ready status and batch links.
   * Does NOT create a Mux upload — intended for pre-recorded content.
   * @param dto - Title, description, batch IDs, curriculum metadata.
   * @returns The created recording row with batchIds and batchNames.
   * @throws BadRequestException on insert or batch-linking failure.
   */
  async create(dto: CreateRecordingDto) {
    const { data: recording, error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .insert({
        title: dto.title,
        description: dto.description ?? null,
        status: 'ready',
      })
      .select()
      .single();

    if (error || !recording) {
      this.logger.error(`Failed to save recording: ${error?.message}`);
      throw new BadRequestException('Failed to create recording');
    }

    const batchLinks = dto.batchIds.map((batchId) => ({
      recording_id: recording.id,
      batch_id: batchId,
    }));

    const { error: linkError } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .insert(batchLinks);

    if (linkError) {
      await this.supabaseService.client.from(TABLES.RECORDINGS).delete().eq('id', recording.id);
      this.logger.error(`Failed to link recording to batches: ${linkError.message}`);
      throw new BadRequestException('Failed to link recording to batches');
    }

    await this.autoCreateCurriculumEntries(recording.id, dto);

    const { data: batchNames } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('batches!inner(name)')
      .eq('recording_id', recording.id);

    logEntityEvent(
      this.observabilityService,
      'RECORDING_CREATED',
      'recording',
      recording.id,
      'system',
      { title: dto.title, batchIds: dto.batchIds },
    ).catch(() => {});

    await this.redisCache.invalidateRecordingsCache();

    return {
      ...recording,
      batchIds: dto.batchIds,
      batchNames: (batchNames ?? []).map((b: any) => b.batches.name),
    };
  }

  /**
   * Paginated admin listing of recordings with batch names.
   * @param page - Page number (1-indexed, default 1).
   * @param limit - Page size (max 100, default 20).
   * @returns Paginated result with items, total, page, limit.
   * @throws BadRequestException on DB query failure.
   */
  async findAll(page = 1, limit = 20) {
    limit = Math.min(limit, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: recordings, error, count } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch recordings: ${error.message}`);
      throw new BadRequestException('Could not retrieve recordings');
    }

    if (!recordings || recordings.length === 0) {
      return { items: [], total: count ?? 0, page, limit };
    }

    const recordingIds = recordings.map((r: any) => r.id);

    const { data: links } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('recording_id, batches!inner(name)')
      .in('recording_id', recordingIds);

    const batchMap = new Map<string, string[]>();
    for (const link of links ?? []) {
      const prev = batchMap.get((link as any).recording_id) ?? [];
      prev.push((link as any).batches.name);
      batchMap.set((link as any).recording_id, prev);
    }

    return {
      items: (recordings ?? []).map((r: any) => ({
        ...r,
        batchNames: batchMap.get(r.id) ?? [],
      })),
      total: count ?? 0,
      page,
      limit,
    };
  }

  /**
   * Create a recording with a provider-routed upload handle.
   * Recording starts in 'processing' status; the owning provider's webhook
   * marks it 'ready'. Batch linking and curriculum creation are wrapped in a
   * Transaction.
   *
   * Provider selection is centralized and BUNNY-FIRST (Phase 7E business
   * decision): every NEW recording routes to Bunny; if Bunny is unavailable
   * the resolver fails visibly (503) instead of falling back to Mux. The
   * VIDEO_UPLOAD_PROVIDER=mux env switch is the documented emergency rollback.
   *
   * @param dto - Title, description, batch IDs, curriculum metadata.
   * @returns The recording row plus the direct-upload handle (`uploadUrl`
   *          legacy field + `upload` { url, kind, headers }).
   * @throws BadRequestException if recording creation or transaction steps fail.
   */
  async createRecordingWithUpload(dto: CreateRecordingDto) {
    const providerName = this.providerResolver.resolveUploadProvider(dto.batchIds);
    const handle = await this.providerResolver
      .resolve(providerName)
      .createDirectUpload({ title: dto.title });
    const { uploadUrl, uploadId } = handle;

    // ── Step 1: Create the recording row and capture its UUID ──
    const { data: recording, error: recordingError } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .insert({
        title: dto.title,
        description: dto.description ?? null,
        provider: providerName,
        mux_upload_id: uploadId, // provider-identifier storage slot (keyed by `provider`)
        status: 'processing',
      })
      .select()
      .single();

    if (recordingError || !recording) {
      throw new BadRequestException(`Failed to create recording: ${recordingError?.message}`);
    }

    // captured UUID — used by every child insert below
    const recordingId: string = recording.id;

    const steps: TransactionStep[] = [
      {
        name: 'insert-batch-links-and-curriculum',
        execute: async () => {
          await this.createBatchLinksAndCurriculum(recordingId, dto.batchIds, {
            categoryName: dto.categoryName,
            moduleName: dto.moduleName,
            isPublished: dto.isPublished,
            titleOverride: dto.titleOverride,
          });
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .delete()
            .eq('recording_id', recordingId);
          await this.supabaseService.client
            .from(TABLES.BATCH_RECORDING_CURRICULUM)
            .delete()
            .eq('content_id', recordingId)
            .eq('content_type', 'recording');
        },
      },
    ];

    const tx = new Transaction();
    try {
      await tx.run(steps);
    } catch (err) {
      // Dependent inserts (batch links, curriculum) failed — remove the orphan recording
      await this.supabaseService.client
        .from(TABLES.RECORDINGS)
        .delete()
        .eq('id', recordingId);
      throw err;
    }

    await this.redisCache.invalidateRecordingsCache();

    return {
      recording,
      uploadUrl,
      upload: {
        url: uploadUrl,
        kind: handle.uploadKind ?? ('plain-put' as const),
        headers: handle.uploadHeaders ?? {},
        recordingId,
      },
    };
  }

  // ── Upload URL ────────────────────────────────────────────

  /**
   * Create a direct provider upload handle for the frontend.
   * The recording starts in 'processing' status.
   *
   * Draft flow has no batch context — irrelevant under the Phase 7E
   * bunny-first policy, which routes ALL new recordings to Bunny (or fails
   * visibly when Bunny is not configured).
   * @param dto - Title for the recording/upload.
   * @returns The upload handle and the created recording row.
   * @throws BadRequestException if recording creation fails.
   */
  async requestUploadUrl(dto: RequestUploadDto) {
    const providerName = this.providerResolver.resolveUploadProvider([]);
    const handle = await this.providerResolver
      .resolve(providerName)
      .createDirectUpload({ title: dto.title });
    const { uploadUrl, uploadId } = handle;

    const { data: recording, error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .insert({
        title: dto.title,
        provider: providerName,
        mux_upload_id: uploadId, // provider-identifier storage slot (keyed by `provider`)
        status: 'processing',
      })
      .select('id, title, status, created_at')
      .single();

    if (error) {
      this.logger.error(`Failed to create recording: ${error.message}`);
      throw new BadRequestException('Failed to create recording');
    }

    return {
      uploadUrl,
      recording,
      upload: {
        url: uploadUrl,
        kind: handle.uploadKind ?? ('plain-put' as const),
        headers: handle.uploadHeaders ?? {},
        recordingId: recording.id,
      },
    };
  }

  // ── Batch Assignment ──────────────────────────────────────

  /**
   * Assign a recording to one or more batches.
   * Inserts recording_batches rows and auto-creates curriculum entries.
   * @param recordingId - UUID of the recording.
   * @param batchIds - Array of batch UUIDs.
   * @returns Object with assignedCount.
   * @throws BadRequestException on invalid payload, batch-link failure, or curriculum failure.
   */
  async assignToBatches(recordingId: string, batchIds: string[]) {
    this.validateCurriculumPayload(recordingId, batchIds);

    const records = batchIds.map((batchId) => ({
      recording_id: recordingId,
      batch_id: batchId,
    }));

    const curriculumEntries = batchIds.map((batchId) => ({
      batch_id: batchId,
      content_id: recordingId,
      content_type: 'recording',
      category_name: 'General',
      module_name: null,
      title_override: null,
      sort_order: 0,
      is_published: true,
    }));

    const steps: TransactionStep[] = [
      {
        name: 'upsert-recording-batches',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .upsert(records, { onConflict: 'recording_id,batch_id' });
          if (error) {
            this.logger.error(`Failed to assign recording to batches: ${error.message}`);
            throw new BadRequestException('Failed to assign recording to batches');
          }
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .delete()
            .eq('recording_id', recordingId)
            .in('batch_id', batchIds);
        },
      },
      {
        name: 'upsert-curriculum-entries',
        execute: async () => {
          this.logger.log(
            `[Curriculum UPSERT] BEGIN | recordingId=${recordingId} | batchIds=${JSON.stringify(batchIds)} | table=${TABLES.BATCH_RECORDING_CURRICULUM} | ts=${new Date().toISOString()}`,
          );
          const { error, status, count } = await this.supabaseService.client
            .from(TABLES.BATCH_RECORDING_CURRICULUM)
            .upsert(curriculumEntries, { onConflict: 'batch_id,content_id,content_type' });
          if (error) {
            this.logger.error(
              `[Curriculum UPSERT] FAILED | recordingId=${recordingId} | batchIds=${JSON.stringify(batchIds)} | error=${JSON.stringify(error)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
            );
            throw new BadRequestException(
              `Failed to create curriculum entries for recording ${recordingId}. Supabase Error [${error.code}]: ${error.message}${error.details ? ` | Details: ${error.details}` : ''}${error.hint ? ` | Hint: ${error.hint}` : ''}`,
            );
          }
          this.logger.debug(
            `[Curriculum UPSERT] SUCCEEDED | recordingId=${recordingId} | batchIds=${JSON.stringify(batchIds)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
          );
        },
        rollback: async () => {
          try {
            await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .delete()
              .eq('content_id', recordingId)
              .eq('content_type', 'recording')
              .in('batch_id', batchIds);
          } catch {
            // Rollback failure is non-fatal; logged by Transaction
          }
        },
      },
    ];

    const tx = new Transaction();
    await tx.run(steps);

    await this.redisCache.invalidateRecordingsCache();

    return { assignedCount: batchIds.length };
  }

  /**
   * Remove a recording from one or more batches.
   * Deletes curriculum entries first, then removes batch links.
   * Wrapped in Transaction — partial failures are rolled back.
   * @param recordingId - UUID of the recording.
   * @param batchIds - Array of batch UUIDs to remove.
   * @returns Object with removedCount.
   * @throws BadRequestException on invalid payload, curriculum delete failure, or batch-link delete failure.
   */
  async removeBatchAccess(recordingId: string, batchIds: string[]) {
    this.validateCurriculumPayload(recordingId, batchIds);

    const steps: TransactionStep[] = [
      {
        name: 'remove-curriculum-entries',
        execute: async () => {
          this.logger.log(
            `[Curriculum DELETE] BEGIN | recordingId=${recordingId} | batchIds=${JSON.stringify(batchIds)} | table=${TABLES.BATCH_RECORDING_CURRICULUM} | ts=${new Date().toISOString()}`,
          );
          const { data, error: curriculumError, status, count } = await this.supabaseService.client
            .from(TABLES.BATCH_RECORDING_CURRICULUM)
            .delete()
            .eq('content_id', recordingId)
            .eq('content_type', 'recording')
            .in('batch_id', batchIds);
          if (curriculumError) {
            this.logger.error(
              `[Curriculum DELETE] FAILED | recordingId=${recordingId} | batchIds=${JSON.stringify(batchIds)} | error=${JSON.stringify(curriculumError)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
            );
            throw new BadRequestException(
              `Failed to remove curriculum entries for recording ${recordingId}. Supabase Error [${curriculumError.code}]: ${curriculumError.message}${curriculumError.details ? ` | Details: ${curriculumError.details}` : ''}${curriculumError.hint ? ` | Hint: ${curriculumError.hint}` : ''}`,
            );
          }
          this.logger.debug(
            `[Curriculum DELETE] SUCCEEDED | recordingId=${recordingId} | batchIds=${JSON.stringify(batchIds)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
          );
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.BATCH_RECORDING_CURRICULUM)
            .upsert(
              batchIds.map((batchId) => ({
                batch_id: batchId,
                content_id: recordingId,
                content_type: 'recording',
                category_name: 'General',
                module_name: null,
                title_override: null,
                sort_order: 0,
                is_published: true,
              })),
              { onConflict: 'batch_id,content_id,content_type' },
            );
        },
      },
      {
        name: 'remove-batch-links',
        execute: async () => {
          const { error: linkError } = await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .delete()
            .eq('recording_id', recordingId)
            .in('batch_id', batchIds);
          if (linkError) {
            this.logger.error(`Failed to remove batch access: ${linkError.message}`);
            throw new BadRequestException('Failed to remove batch access');
          }
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .upsert(
              batchIds.map((batchId) => ({
                recording_id: recordingId,
                batch_id: batchId,
              })),
              { onConflict: 'recording_id,batch_id' },
            );
        },
      },
    ];

    const tx = new Transaction();
    await tx.run(steps);

    await this.redisCache.invalidateRecordingsCache();

    return { removedCount: batchIds.length };
  }

  // ── Batch Curriculum (per-batch metadata) ─────────────────

  /**
   * Update per-batch curriculum metadata for a recording.
   * Supports both ADD (assigned: true) and REMOVE (assigned: false) operations.
   * All steps are wrapped in a Transaction — if any step fails, prior steps are rolled back.
   * @param recordingId - UUID of the recording.
   * @param dto - Array of BatchCurriculumAssignment with batchId, sectionName, sortOrder, isVisible, assigned.
   * @returns Object with updated: true.
   * @throws BadRequestException on invalid payload or any DB operation failure.
   */
  async updateBatchCurriculum(recordingId: string, dto: UpdateBatchCurriculumDto) {
    const addBatches: string[] = [];
    const removeBatches: string[] = [];

    for (const a of dto.assignments) {
      if (a.assigned === false) {
        removeBatches.push(a.batchId);
      } else {
        addBatches.push(a.batchId);
      }
    }

    const steps: TransactionStep[] = [];
    const startTime = Date.now();

    // ── ADD path ───────────────────────────────────────────────
    if (addBatches.length > 0) {
      this.validateCurriculumPayload(recordingId, addBatches);

      const records = addBatches.map((batchId) => ({
        recording_id: recordingId,
        batch_id: batchId,
      }));

      const assignmentMap = new Map<string, BatchCurriculumAssignment>();
      for (const a of dto.assignments) {
        if (a.assigned !== false) assignmentMap.set(a.batchId, a);
      }

      const curriculumEntries = addBatches.map((batchId) => {
        const meta = assignmentMap.get(batchId);
        return {
          batch_id: batchId,
          content_id: recordingId,
          content_type: 'recording',
          category_name: meta?.sectionName ?? 'General',
          sort_order: meta?.sortOrder ?? 0,
          is_published: meta?.isVisible ?? true,
          module_name: null,
          title_override: null,
        };
      });

      steps.push(
        {
          name: 'add-batch-links',
          execute: async () => {
            const { error } = await this.supabaseService.client
              .from(TABLES.RECORDING_BATCHES)
              .upsert(records, { onConflict: 'recording_id,batch_id' });
            if (error) throw new BadRequestException(`Failed to add batch links: ${error.message}`);
          },
          rollback: async () => {
            await this.supabaseService.client
              .from(TABLES.RECORDING_BATCHES)
              .delete()
              .eq('recording_id', recordingId)
              .in('batch_id', addBatches);
          },
        },
        {
          name: 'add-curriculum-entries',
          execute: async () => {
            const { data, error, status, count } = await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .upsert(curriculumEntries, { onConflict: 'batch_id,content_id,content_type' });
            if (error) {
              this.logger.error(
                `[Curriculum UPSERT] FAILED | recordingId=${recordingId} | batchIds=${JSON.stringify(addBatches)} | error=${JSON.stringify(error)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
              );
              throw new BadRequestException(
                `Failed to sync curriculum entries for recording ${recordingId}. Supabase Error [${error.code}]: ${error.message}${error.details ? ` | Details: ${error.details}` : ''}${error.hint ? ` | Hint: ${error.hint}` : ''}`,
              );
            }
            this.logger.debug(
              `[Curriculum UPSERT] SUCCEEDED | recordingId=${recordingId} | batchIds=${JSON.stringify(addBatches)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
            );
          },
          rollback: async () => {
            await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .delete()
              .eq('content_id', recordingId)
              .eq('content_type', 'recording')
              .in('batch_id', addBatches);
          },
        },
      );
    }

    // ── REMOVE path ────────────────────────────────────────────
    if (removeBatches.length > 0) {
      this.validateCurriculumPayload(recordingId, removeBatches);

      steps.push(
        {
          name: 'remove-curriculum-entries',
          execute: async () => {
            const { data, error, status, count } = await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .delete()
              .eq('content_id', recordingId)
              .eq('content_type', 'recording')
              .in('batch_id', removeBatches);
            if (error) {
              this.logger.error(
                `[Curriculum DELETE] FAILED | recordingId=${recordingId} | batchIds=${JSON.stringify(removeBatches)} | error=${JSON.stringify(error)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
              );
              throw new BadRequestException(
                `Failed to remove curriculum entries for recording ${recordingId}. Supabase Error [${error.code}]: ${error.message}${error.details ? ` | Details: ${error.details}` : ''}${error.hint ? ` | Hint: ${error.hint}` : ''}`,
              );
            }
            this.logger.debug(
              `[Curriculum DELETE] SUCCEEDED | recordingId=${recordingId} | batchIds=${JSON.stringify(removeBatches)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
            );
          },
          rollback: async () => {
            await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .upsert(
                removeBatches.map((batchId) => ({
                  batch_id: batchId,
                  content_id: recordingId,
                  content_type: 'recording',
                  category_name: 'General',
                  module_name: null,
                  title_override: null,
                  sort_order: 0,
                  is_published: true,
                })),
                { onConflict: 'batch_id,content_id,content_type' },
              );
          },
        },
        {
          name: 'remove-batch-links',
          execute: async () => {
            const { error } = await this.supabaseService.client
              .from(TABLES.RECORDING_BATCHES)
              .delete()
              .eq('recording_id', recordingId)
              .in('batch_id', removeBatches);
            if (error) throw new BadRequestException(`Failed to remove batch links: ${error.message}`);
          },
          rollback: async () => {
            await this.supabaseService.client
              .from(TABLES.RECORDING_BATCHES)
              .upsert(
                removeBatches.map((batchId) => ({
                  recording_id: recordingId,
                  batch_id: batchId,
                })),
                { onConflict: 'recording_id,batch_id' },
              );
          },
        },
      );
    }

    if (steps.length === 0) {
      return { updated: true };
    }

    // ── Execute transaction ────────────────────────────────────
    this.logger.log(
      `[Transaction BEGIN] updateBatchCurriculum | recordingId=${recordingId} | addBatches=${JSON.stringify(addBatches)} | removeBatches=${JSON.stringify(removeBatches)} | ts=${new Date().toISOString()}`,
    );

    const tx = new Transaction();
    try {
      await tx.run(steps);
    } catch (err) {
      this.logger.log(
        `[Transaction ROLLBACK] updateBatchCurriculum | recordingId=${recordingId} | durationMs=${Date.now() - startTime} | error=${(err as Error).message} | ts=${new Date().toISOString()}`,
      );
      throw err;
    }

    this.logger.log(
      `[Transaction COMMIT] updateBatchCurriculum | recordingId=${recordingId} | durationMs=${Date.now() - startTime} | ts=${new Date().toISOString()}`,
    );

    await this.redisCache.invalidateRecordingsCache();

    return { updated: true };
  }

  // ── Update / Delete ───────────────────────────────────────

  /**
   * Update a recording's title, description, or topic assignment.
   * Only provided fields are updated.
   * @param id - UUID of the recording.
   * @param dto - Fields to update (title, description, topicId).
   * @returns The updated recording row with topic name.
   * @throws BadRequestException if no fields provided or DB update fails.
   */
  async updateRecording(id: string, dto: UpdateRecordingDto) {
    const updateData: Record<string, any> = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.topicId !== undefined) updateData.topic_id = dto.topicId;
    if (dto.status !== undefined) updateData.status = dto.status;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const { data, error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .update(updateData)
      .eq('id', id)
      .select('*, topics(name)')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update recording ${id}: ${error?.message}`);
      throw new BadRequestException('Failed to update recording');
    }

    await this.redisCache.invalidateRecordingsCache();

    return data;
  }

  /**
   * Delete a recording and its associated provider asset (Mux or Bunny).
   * Flow:
   *   1. Transaction: delete curriculum → delete batch links → set cleanup_pending=true
   *   2. Outside transaction: delete provider asset (never rolls back DB for provider failure)
   *   3. On success: hard-delete the recording row
   *   4. On failure: emit RECORDING_CLEANUP_PENDING event, return cleanupPending:true
   * @param id - UUID of the recording.
   * @returns Object with deleted:true and optionally cleanupPending:true.
   * @throws NotFoundException if recording does not exist.
   * @throws BadRequestException on transaction step failure.
   */
  async deleteRecording(id: string) {
    const { data: recording } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, mux_asset_id, provider, title')
      .eq('id', id)
      .single();

    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    // Collect affected batches/users BEFORE deleting links (for targeted cache invalidation)
    let affectedUserIds: string[] = [];
    try {
      const { data: links } = await this.supabaseService.client
        .from(TABLES.RECORDING_BATCHES)
        .select('batch_id')
        .eq('recording_id', id);
      const batchIds = (links ?? []).map((r: any) => r.batch_id);
      if (batchIds.length > 0) {
        const { data: students } = await this.supabaseService.client
          .from(TABLES.BATCH_STUDENTS)
          .select('user_id')
          .in('batch_id', batchIds);
        affectedUserIds = [...new Set((students ?? []).map((s: any) => s.user_id))];
      }
    } catch {
      // cache invalidation is best-effort; ignore lookup errors
    }

    const invalidateForAffected = async () => {
      if (affectedUserIds.length > 0) {
        await this.redisCache.invalidateRecordingsCacheForUsers(affectedUserIds).catch(() => {});
      } else {
        // Unassigned recording or lookup failed — still invalidate globally to cover admin listing
        await this.redisCache.invalidateRecordingsCache().catch(() => {});
      }
    };

    // ── Transaction: remove DB references, mark pending cleanup ──
    const steps: TransactionStep[] = [
      {
        name: 'delete-curriculum',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.BATCH_RECORDING_CURRICULUM)
            .delete()
            .eq('content_id', id)
            .eq('content_type', 'recording');
          if (error) throw new BadRequestException(`Failed to delete curriculum entries: ${error.message}`);
        },
        rollback: async () => {
          this.logger.warn(`Cannot roll back curriculum deletion for recording ${id}`);
        },
      },
      {
        name: 'delete-batch-links',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .delete()
            .eq('recording_id', id);
          if (error) throw new BadRequestException(`Failed to delete batch links: ${error.message}`);
        },
        rollback: async () => {
          this.logger.warn(`Cannot roll back batch-link deletion for recording ${id}`);
        },
      },
      {
        name: 'mark-cleanup-pending',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.RECORDINGS)
            .update({ cleanup_pending: true })
            .eq('id', id);
          if (error) throw new BadRequestException(`Failed to mark cleanup pending: ${error.message}`);
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.RECORDINGS)
            .update({ cleanup_pending: false })
            .eq('id', id);
        },
      },
    ];

    const tx = new Transaction();
    await tx.run(steps);

    // ── Outside transaction: delete the owning provider's asset ──
    // (never roll back DB for provider failure). Mux assets of existing
    // recordings are only ever deleted through this explicit admin path.
    if (recording.mux_asset_id) {
      try {
        await this.providerResolver.providerFor(recording).deleteAsset(recording.mux_asset_id);
      } catch (err: any) {
        const msg = (err?.message ?? '').toLowerCase();
        const status = err?.status ?? err?.response?.status;
        const isNotFound = status === 404;
        const isNotConfigured =
          err?.name === 'ServiceUnavailableException' ||
          msg.includes('not enabled/configured') ||
          msg.includes('must be set in environment variables') ||
          msg.includes('mux_token_id');

        if (isNotFound || isNotConfigured) {
          this.logger.warn(
            `Provider asset ${recording.mux_asset_id} for recording ${id} treated as already deleted (404 or not configured: ${msg || status}); proceeding to hard-delete DB row.`,
          );
          // fall through to hard delete — do NOT return cleanupPending
        } else {
          this.logger.error(
            `Failed to delete ${recording.provider ?? 'mux'} asset ${recording.mux_asset_id} for recording ${id}: ${(err as Error).message}. Cleanup_pending set to true; a reconciliation job should retry provider deletion.`,
          );

          logEntityEvent(
            this.observabilityService,
            'RECORDING_CLEANUP_PENDING',
            'recording',
            id,
            'system',
            { title: recording.title, mux_asset_id: recording.mux_asset_id, error: (err as Error).message },
          ).catch(() => {});

          await invalidateForAffected();

          return { deleted: true, cleanupPending: true };
        }
      }
    }

    // ── Provider cleaned (or none): hard-delete the recording row ──
    const { error: deleteError } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .delete()
      .eq('id', id);

    if (deleteError) {
      this.logger.error(
        `Failed to delete recording row ${id} after Mux cleanup: ${deleteError.message}. Cleanup_pending remains true.`,
      );

      await invalidateForAffected();

      return { deleted: true, cleanupPending: true };
    }

    logEntityEvent(
      this.observabilityService,
      'RECORDING_DELETED',
      'recording',
      id,
      'system',
      { title: recording.title },
    ).catch(() => {});

    await invalidateForAffected();

    return { deleted: true };
  }

  /**
   * Bulk delete recordings — one server-side operation for N IDs.
   * - Validates admin already via controller guard.
   * - Deduplicates IDs, validates UUID format.
   * - Loads recordings itself (never trusts client provider IDs).
   * - Per-recording: runs same two-phase flow as deleteRecording (transaction → provider → hard delete).
   * - Collects per-record success/failure; does NOT abort entire batch on single provider failure.
   * - Targeted cache invalidation for affected users only.
   */
  async bulkDeleteRecordings(recordingIds: string[]): Promise<{
    deleted: string[];
    failed: { id: string; error: string }[];
    total: number;
  }> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uniqueIds = [...new Set((recordingIds ?? []).filter(Boolean))];

    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one recording ID is required');
    }

    for (const id of uniqueIds) {
      if (!uuidRegex.test(id)) {
        throw new BadRequestException(`Invalid recording ID format: "${id}". Expected UUID.`);
      }
    }

    // Load all recordings in one query
    const { data: recordings, error } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, mux_asset_id, provider, title')
      .in('id', uniqueIds);

    if (error) {
      throw new BadRequestException(`Failed to load recordings: ${error.message}`);
    }

    const foundById = new Map((recordings ?? []).map((r: any) => [r.id, r]));
    const missing = uniqueIds.filter((id) => !foundById.has(id));

    // Collect affected users across all found recordings (for targeted invalidation)
    let affectedUserIds: string[] = [];
    try {
      const { data: links } = await this.supabaseService.client
        .from(TABLES.RECORDING_BATCHES)
        .select('batch_id')
        .in('recording_id', uniqueIds);
      const batchIds = [...new Set((links ?? []).map((r: any) => r.batch_id))];
      if (batchIds.length > 0) {
        const { data: students } = await this.supabaseService.client
          .from(TABLES.BATCH_STUDENTS)
          .select('user_id')
          .in('batch_id', batchIds);
        affectedUserIds = [...new Set((students ?? []).map((s: any) => s.user_id))];
      }
    } catch {}

    const deleted: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Missing IDs are failures
    for (const id of missing) {
      failed.push({ id, error: 'Recording not found' });
    }

    // Process each found recording individually (per-recording transaction + provider)
    for (const id of uniqueIds) {
      const rec = foundById.get(id);
      if (!rec) continue; // already counted as missing
      try {
        const result = await this.deleteRecording(id);
        // deleteRecording returns cleanupPending true if provider failed retriably
        if ((result as any).cleanupPending) {
          failed.push({ id, error: 'Provider deletion pending — will retry via cleanup job' });
        } else {
          deleted.push(id);
        }
      } catch (err: any) {
        failed.push({ id, error: err.message ?? 'Unknown error' });
      }
    }

    // Targeted invalidation for affected users (covers both deleted and pending cases)
    if (affectedUserIds.length > 0) {
      await this.redisCache.invalidateRecordingsCacheForUsers(affectedUserIds).catch(() => {});
    } else {
      await this.redisCache.invalidateRecordingsCache().catch(() => {});
    }

    return { deleted, failed, total: uniqueIds.length };
  }

  // ── Admin List (paginated, with batch info) ───────────────

  /**
   * Paginated admin recording list with topic and batch IDs.
   * Unlike findAll, this uses a join to include batch IDs and supports topic filtering.
   * @param topicId - Optional topic UUID to filter by.
   * @param page - Page number (1-indexed, default 1).
   * @param limit - Page size (default 20).
   * @returns Paginated result with items (including nested batch_id array), total.
   * @throws BadRequestException on DB query failure.
   */
  /**
   * Fetch recordings for the admin recordings table with server-side
   * search, filtering, and pagination.
   * @param filters - topicId, search (title/description), status, batchId,
   *   published ('true' = has batch links, 'false' = none), sort ('newest'|'oldest').
   * @param page - 1-based page number.
   * @param limit - page size, capped at 100.
   * @returns Paginated recordings with topics + batch links (with batch names).
   * @throws BadRequestException on DB query failure.
   */
  async getAdminRecordings(
    filters: {
      topicId?: string;
      search?: string;
      status?: string;
      batchId?: string;
      published?: string;
      sort?: string;
    } = {},
    page = 1,
    limit = 20,
  ) {
    limit = Math.min(limit, 1000);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select(
        `*, topics(name), ${TABLES.RECORDING_BATCHES}!recording_id(batch_id, batches(name))`,
        { count: 'exact' },
      );

    // ── Search: title OR description (case-insensitive) ──
    if (filters.search) {
      const term = filters.search.replace(/[\\%_*,\"]/g, (m) => `\\${m}`).replace(/'/g, "''").replace(/\*/g, '\\*');
      query = query.or(`title.ilike.*${term}*,description.ilike.*${term}*`);
    }

    if (filters.topicId) {
      query = query.eq('topic_id', filters.topicId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    // ── Batch / published filters ─────────────────────────────
    // PostgREST embedded to-many filters are unreliable on this dataset,
    // so resolve recording IDs from recording_batches first, then filter
    // the recordings query with in/not.in. Count stays exact.
    if (filters.batchId || filters.published) {
      let linksQuery = this.supabaseService.client
        .from(TABLES.RECORDING_BATCHES)
        .select('recording_id');

      if (filters.batchId) {
        linksQuery = linksQuery.eq('batch_id', filters.batchId);
      }

      const { data: links } = await linksQuery;
      const recordingIds = [
        ...new Set((links ?? []).map((l: any) => l.recording_id)),
      ];

      if (filters.batchId) {
        query = query.in('id', recordingIds);
      } else if (filters.published === 'true') {
        query = query.in('id', recordingIds);
      } else if (filters.published === 'false' && recordingIds.length > 0) {
        query = query.not('id', 'in', `(${recordingIds.join(',')})`);
      }
    }

    query = query.order('created_at', {
      ascending: filters.sort === 'oldest',
    });

    const { data, error, count } = await query.range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch admin recordings: ${error.message}`);
      throw new BadRequestException('Could not retrieve recordings');
    }

    return {
      items: data ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }

  // ── Student: accessible recordings ────────────────────────

  /**
   * Get recordings accessible to a student, optionally filtered by topic.
   * Results are cached in Redis for 300 seconds.
   * Access is determined via recording_batches (authorization table).
   * @param userId - UUID of the student.
   * @param topicId - Optional topic UUID to filter by.
   * @returns Array of recordings with progress data.
   * @throws BadRequestException on DB query failure.
   */
  async getRecordingsForStudent(userId: string, topicId?: string) {
    const cacheKey = this.redisCache.key('recordings', 'flat', userId, topicId ?? 'all');
    return this.redisCache.wrap(cacheKey, 300, async () => {
      return this.fetchRecordingsForStudent(userId, topicId);
    });
  }

  private async fetchRecordingsForStudent(userId: string, topicId?: string) {
    this.logger.debug(`[DEBUG] fetchRecordingsForStudent | studentId=${userId} | topicId=${topicId ?? 'none'}`);

    const { data: batchMemberships } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);

    const batchIds = (batchMemberships ?? []).map((b: any) => b.batch_id);
    this.logger.debug(`[DEBUG] fetchRecordingsForStudent | batchMemberships count=${batchMemberships?.length ?? 0} | batchIds=${JSON.stringify(batchIds)}`);

    if (batchIds.length === 0) {
      this.logger.debug(`[DEBUG] fetchRecordingsForStudent | EARLY RETURN: no batch memberships | response=[]`);
      return [];
    }

    const { data: accessRecords } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('recording_id')
      .in('batch_id', batchIds);

    const recordingIds = [
      ...new Set((accessRecords ?? []).map((r: any) => r.recording_id)),
    ];
    this.logger.debug(`[DEBUG] fetchRecordingsForStudent | accessRecords count=${accessRecords?.length ?? 0} | recordingIds=${JSON.stringify(recordingIds)}`);

    if (recordingIds.length === 0) {
      this.logger.debug(`[DEBUG] fetchRecordingsForStudent | EARLY RETURN: no access records | response=[]`);
      return [];
    }

    // Phase 9: enforce publish gate — only is_published=true curriculum entries are student-visible.
    // Legacy fallback: if zero curriculum rows exist for these recordings, show via recording_batches alone.
    const { data: publishedCurriculum } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('content_id')
      .eq('content_type', 'recording')
      .in('batch_id', batchIds)
      .eq('is_published', true)
      .in('content_id', recordingIds);

    let publishedRecordingIds = [
      ...new Set((publishedCurriculum ?? []).map((r: any) => r.content_id)),
    ];
    this.logger.debug(`[DEBUG] fetchRecordingsForStudent | publishedCurriculum count=${publishedCurriculum?.length ?? 0} | publishedRecordingIds=${JSON.stringify(publishedRecordingIds)}`);

    if (publishedRecordingIds.length === 0) {
      const { data: anyCurriculum } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .select('content_id')
        .eq('content_type', 'recording')
        .in('batch_id', batchIds)
        .in('content_id', recordingIds);
      if (!anyCurriculum || anyCurriculum.length === 0) {
        // No curriculum at all for these recordings — legacy fallback, use recording_batches ids.
        publishedRecordingIds = recordingIds;
        this.logger.debug(`[DEBUG] fetchRecordingsForStudent | LEGACY FALLBACK: no curriculum rows, using recordingIds=${JSON.stringify(publishedRecordingIds)}`);
      } else {
        this.logger.debug(`[DEBUG] fetchRecordingsForStudent | EARLY RETURN: no published curriculum entries (curriculum exists but unpublished) | response=[]`);
        return [];
      }
    }

    let recordingsQuery = this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, title, description, topic_id, sort_order, status, created_at, topics(name)')
      .in('id', publishedRecordingIds)
      .eq('status', 'ready')
      .order('sort_order', { ascending: true });

    if (topicId) {
      recordingsQuery = recordingsQuery.eq('topic_id', topicId);
    }

    const { data: recordings } = await recordingsQuery;
    this.logger.debug(`[DEBUG] fetchRecordingsForStudent | recordings query returned count=${recordings?.length ?? 0} | status filter='ready'`);

    if (!recordings || recordings.length === 0) {
      this.logger.debug(`[DEBUG] fetchRecordingsForStudent | EARLY RETURN: no ready recordings | response=[]`);
      return [];
    }

    const recordingIdList = recordings.map((v: any) => v.id);
    const { data: progress } = await this.supabaseService.client
      .from(TABLES.VIDEO_PROGRESS)
      .select('video_id, watched_seconds, completed, last_watched_at')
      .in('video_id', recordingIdList)
      .eq('user_id', userId);

    const progressMap = new Map(
      (progress ?? []).map((p: any) => [p.video_id, p]),
    );

    const response = recordings.map((recording: any) => ({
      ...recording,
      progress: progressMap.get(recording.id) ?? {
        watched_seconds: 0,
        completed: false,
        last_watched_at: null,
      },
    }));
    this.logger.debug(`[DEBUG] fetchRecordingsForStudent | FINAL response=${JSON.stringify(response)}`);
    return response;
  }

  // ── Student: grouped recordings by batch → section ────────

  /**
   * Get all of a student's recordings grouped by batch → curriculum section.
   * Results are cached in Redis for 300 seconds.
   * Access is determined via recording_batches; sections come from batch_recording_curriculum.
   * @param userId - UUID of the student.
   * @returns Array of batch groups, each with sections containing recordings with progress.
   * @throws BadRequestException on DB query failure (propagated from fetchMyRecordingsGrouped).
   */
  async getMyRecordingsGrouped(userId: string) {
    const cacheKey = this.redisCache.key('recordings', 'grouped', userId);
    return this.redisCache.wrap(cacheKey, 300, async () => {
      return this.fetchMyRecordingsGrouped(userId);
    });
  }

  private async fetchMyRecordingsGrouped(userId: string) {
    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | studentId=${userId}`);

    const { data: batchMemberships } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);

    const userBatchIds = (batchMemberships ?? []).map((b: any) => b.batch_id);
    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | batchMemberships count=${batchMemberships?.length ?? 0} | userBatchIds=${JSON.stringify(userBatchIds)}`);
    if (userBatchIds.length === 0) {
      this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | EARLY RETURN: no batch memberships | response=[]`);
      return [];
    }

    const { data: batches } = await this.supabaseService.client
      .from(TABLES.BATCHES)
      .select('id, name')
      .in('id', userBatchIds);
    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | batches count=${batches?.length ?? 0} | batch names=${JSON.stringify((batches ?? []).map((b: any) => ({ id: b.id, name: b.name })))}`);

    const batchMap = new Map((batches ?? []).map((b: any) => [b.id, b.name]));

    const { data: accessRecords } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('recording_id, batch_id')
      .in('batch_id', userBatchIds);

    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | accessRecords count=${accessRecords?.length ?? 0} | rows=${JSON.stringify(accessRecords ?? [])}`);

    const recordingIds = [...new Set((accessRecords ?? []).map((r: any) => r.recording_id))];
    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | unique recordingIds from recording_batches=${JSON.stringify(recordingIds)}`);
    if (recordingIds.length === 0) {
      this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | EARLY RETURN: no recording_batches entries | response=[]`);
      return [];
    }

    const { data: recordings } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, title, description, mux_playback_id, duration_seconds, sort_order, status, created_at')
      .in('id', recordingIds)
      .eq('status', 'ready')
      .order('sort_order', { ascending: true });

    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | recordings query returned count=${recordings?.length ?? 0} | status filter='ready' | recording statuses in DB=${JSON.stringify((recordings ?? []).map((r: any) => ({ id: r.id, status: r.status })))}`);

    if (!recordings || recordings.length === 0) {
      this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | EARLY RETURN: no ready recordings | response=[]`);
      return [];
    }

    const recordingIdList = recordings.map((r: any) => r.id);
    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | ready recordingIds=${JSON.stringify(recordingIdList)}`);

    const { data: curriculum } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('batch_id, content_id, category_name, sort_order, is_published, title_override')
      .eq('content_type', 'recording')
      .in('content_id', recordingIdList)
      .in('batch_id', userBatchIds)
      .eq('is_published', true);

    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | curriculum query returned count=${curriculum?.length ?? 0} | filters: content_type=recording, is_published=true | rows=${JSON.stringify(curriculum ?? [])}`);

    const { data: progress } = await this.supabaseService.client
      .from(TABLES.VIDEO_PROGRESS)
      .select('video_id, watched_seconds, completed, last_watched_at')
      .in('video_id', recordingIdList)
      .eq('user_id', userId);

    const progressMap = new Map(
      (progress ?? []).map((p: any) => [p.video_id, p]),
    );

    const curriculumByBatch = new Map<string, Map<string, any[]>>();
    for (const c of curriculum ?? []) {
      const bId = (c as any).batch_id;
      const section = (c as any).category_name ?? 'Uncategorized';
      if (!curriculumByBatch.has(bId)) {
        curriculumByBatch.set(bId, new Map());
      }
      const sections = curriculumByBatch.get(bId)!;
      if (!sections.has(section)) {
        sections.set(section, []);
      }
      sections.get(section)!.push(c);
    }

    const accessByRecording = new Map<string, Set<string>>();
    for (const a of accessRecords ?? []) {
      const recId = (a as any).recording_id;
      if (!accessByRecording.has(recId)) {
        accessByRecording.set(recId, new Set());
      }
      accessByRecording.get(recId)!.add((a as any).batch_id);
    }

    const result: any[] = [];
    for (const batchId of userBatchIds) {
      const batchName = batchMap.get(batchId) ?? 'Unknown Batch';
      const sections = curriculumByBatch.get(batchId);
      this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | processing batchId=${batchId} | batchName=${batchName} | hasSections=${!!sections}`);

      const recordingsInBatch = (accessRecords ?? [])
        .filter((a: any) => a.batch_id === batchId)
        .map((a: any) => a.recording_id);
      this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | batchId=${batchId} | recordingsInBatch from accessRecords=${JSON.stringify(recordingsInBatch)}`);

      if (sections) {
        const sectionArr: any[] = [];
        for (const [sectionName, items] of sections) {
          const recordingsInSection = items
            .map((item: any) => {
              const rec = recordings.find((r: any) => r.id === item.content_id);
              if (!rec || !recordingsInBatch.includes(rec.id)) return null;
              const prog = progressMap.get(rec.id);
              return {
                id: rec.id,
                title: item.title_override ?? rec.title,
                description: rec.description,
                muxPlaybackId: rec.mux_playback_id,
                durationSeconds: rec.duration_seconds,
                sortOrder: item.sort_order ?? rec.sort_order,
                createdAt: rec.created_at,
                progress: prog
                  ? { watchedSeconds: prog.watched_seconds, completed: prog.completed, lastWatchedAt: prog.last_watched_at }
                  : { watchedSeconds: 0, completed: false, lastWatchedAt: null },
              };
            })
            .filter(Boolean);
          this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | batchId=${batchId} | sectionName=${sectionName} | recordingsInSection count=${recordingsInSection.length}`);
          if (recordingsInSection.length > 0) {
            sectionArr.push({ sectionName, recordings: recordingsInSection });
          }
        }
        sectionArr.sort((a, b) => a.sectionName?.localeCompare(b.sectionName ?? '') ?? 0);
        result.push({ batchId, batchName, sections: sectionArr });
      } else {
        const uncategorized = recordings
          .filter((r: any) => recordingsInBatch.includes(r.id))
          .map((r: any) => {
            const prog = progressMap.get(r.id);
            return {
              id: r.id,
              title: r.title,
              description: r.description,
              muxPlaybackId: r.mux_playback_id,
              durationSeconds: r.duration_seconds,
              sortOrder: r.sort_order,
              createdAt: r.created_at,
              progress: prog
                ? { watchedSeconds: prog.watched_seconds, completed: prog.completed, lastWatchedAt: prog.last_watched_at }
                : { watchedSeconds: 0, completed: false, lastWatchedAt: null },
            };
          });
        this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | batchId=${batchId} | uncategorized count=${uncategorized.length}`);
        if (uncategorized.length > 0) {
          result.push({ batchId, batchName, sections: [{ sectionName: null, recordings: uncategorized }] });
        }
      }
    }
    this.logger.debug(`[DEBUG] fetchMyRecordingsGrouped | FINAL response=${JSON.stringify(result)}`);
    return result;
  }

  // ── Playback ──────────────────────────────────────────────

  private async validateAccess(recordingId: string, userId: string): Promise<void> {
    const { data: recording } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('status')
      .eq('id', recordingId)
      .single();

    if (!recording) throw new NotFoundException('Recording not found');
    if (recording.status !== 'ready') throw new BadRequestException('Recording is not ready for playback yet');

    const { data: userBatches } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);

    const userBatchIds = (userBatches ?? []).map((b: any) => b.batch_id);
    if (userBatchIds.length === 0) {
      this.logger.warn(`validateAccess: user ${userId} has no batch assignments`);
      throw new ForbiddenException('You do not have access to this recording');
    }

    this.logger.debug('validateAccess', {
      recordingId,
      userId,
      userBatchIds,
    });

    // Check primary access via recording_batches
    const { data: accessRecords } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('batch_id')
      .eq('recording_id', recordingId)
      .in('batch_id', userBatchIds);

    if (!accessRecords || accessRecords.length === 0) {
      this.logger.warn('validateAccess: access DENIED (no recording_batches overlap)', {
        recordingId, userId, userBatchIds,
      });
      throw new ForbiddenException('You do not have access to this recording');
    }

    // Phase 9: enforce publish gate — at least one intersecting batch must have is_published=true.
    // Legacy fallback: recordings with zero curriculum rows remain accessible via recording_batches alone
    // (pre-curriculum rows). Only when curriculum rows exist but none are published do we deny.
    const matchedBatchIds = accessRecords.map((r: any) => r.batch_id);
    const { data: publishedCurriculum } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('batch_id')
      .eq('content_type', 'recording')
      .eq('content_id', recordingId)
      .eq('is_published', true)
      .in('batch_id', matchedBatchIds);

    if (publishedCurriculum && publishedCurriculum.length > 0) {
      this.logger.debug('validateAccess: access granted via recording_batches + published curriculum', {
        recordingId, userId, matchedBatchIds: publishedCurriculum.map((r: any) => r.batch_id),
      });
      return;
    }

    // Fallback — check if any curriculum row exists for this recording+batches at all.
    const { data: anyCurriculum } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('batch_id')
      .eq('content_type', 'recording')
      .eq('content_id', recordingId)
      .in('batch_id', matchedBatchIds);

    if (!anyCurriculum || anyCurriculum.length === 0) {
      // No curriculum entry at all — legacy recording, allow via recording_batches.
      this.logger.debug('validateAccess: access granted via recording_batches (no curriculum rows — legacy fallback)', {
        recordingId, userId, matchedBatchIds,
      });
      return;
    }

    this.logger.warn('validateAccess: access DENIED (unpublished for all overlapping batches)', {
      recordingId, userId, userBatchIds, matchedBatchIds,
    });
    throw new ForbiddenException('This recording is not published for your batch');
  }

  /**
   * Authorize a student's playback request for a recording.
   * Validates access via recording_batches, then delegates to PlaybackGuard for token authorization.
   * @param recordingId - UUID of the recording.
   * @param userId - UUID of the student.
   * @param deviceId - Optional device identifier for pinning.
   * @param ip - Optional IP address for geo-checking.
   * @returns PlaybackGuard authorization result.
   * @throws NotFoundException if recording not found.
   * @throws BadRequestException if recording is not in 'ready' status.
   * @throws ForbiddenException if student has no batch access to the recording.
   */
  async authorizePlayback(recordingId: string, userId: string, deviceId?: string, ip?: string) {
    await this.validateAccess(recordingId, userId);
    return this.playbackGuard.authorize(userId, recordingId, deviceId, ip);
  }

  /**
   * Get a signed playback URL for a student (provider-transparent).
   * Validates access, then delegates to PlaybackGuard which resolves the
   * owning provider from recordings.provider and mints provider-signed URLs.
   * @param recordingId - UUID of the recording.
   * @param userId - UUID of the student.
   * @param token - Authorization token from authorizePlayback step.
   * @param deviceId - Optional device identifier.
   * @param ip - Optional IP address.
   * @returns Signed playback URL with expiry timestamp.
   * @throws NotFoundException if recording not found.
   * @throws BadRequestException if recording has no playback ID or not ready.
   * @throws ForbiddenException if student has no batch access.
   */
  async getPlaybackUrl(recordingId: string, userId: string, token: string, deviceId?: string, ip?: string) {
    await this.validateAccess(recordingId, userId);

    const { data: recording } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('provider, mux_playback_id') // mux_playback_id = provider-identifier slot
      .eq('id', recordingId)
      .single();

    if (!recording?.mux_playback_id) {
      throw new BadRequestException('Recording has no playback ID configured');
    }

    return this.playbackGuard.getSignedUrl(
      token,
      { playbackId: recording.mux_playback_id, provider: recording.provider },
      userId,
      recordingId,
      deviceId,
      ip,
    );
  }

  // ── Progress ──────────────────────────────────────────────

  /**
   * Update a student's watch progress for a recording.
   * Uses upsert on user_id+video_id conflict to support partial updates.
   * @param userId - UUID of the student.
   * @param recordingId - UUID of the recording.
   * @param dto - watchedSeconds, completed status.
   * @returns The upserted progress row.
   * @throws BadRequestException on DB upsert failure.
   */
  async updateProgress(
    userId: string,
    recordingId: string,
    dto: UpdateVideoProgressDto,
  ) {
    await this.validateAccess(recordingId, userId);

    const { data, error } = await this.supabaseService.client
      .from(TABLES.VIDEO_PROGRESS)
      .upsert(
        {
          user_id: userId,
          video_id: recordingId,
          watched_seconds: dto.watchedSeconds,
          completed: dto.completed ?? false,
          last_watched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,video_id' },
      )
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update progress: ${error.message}`);
      throw new BadRequestException('Failed to update progress');
    }

    return data;
  }

  // ── Batch Recordings (classroom) ──────────────────────────

  /**
   * Get recordings for a specific batch (classroom context).
   * Verifies the student is a member of the batch before returning recordings.
   * @param batchId - UUID of the batch.
   * @param userId - UUID of the student.
   * @returns Array of recordings in the batch with title, description, duration, status.
   * @throws ForbiddenException if student is not a member of the batch.
   */
  async getBatchRecordings(batchId: string, userId: string) {
    const { data: membership } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId)
      .eq('batch_id', batchId)
      .maybeSingle();

    if (!membership) {
      throw new ForbiddenException('You do not have access to this batch');
    }

    const { data: links } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('recording_id')
      .eq('batch_id', batchId);

    const recordingIds = (links ?? []).map((l: any) => l.recording_id);

    if (recordingIds.length === 0) {
      return [];
    }

    // Phase 9: enforce publish gate — filter to is_published=true curriculum for this batch.
    const { data: publishedLinks } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('content_id')
      .eq('content_type', 'recording')
      .eq('batch_id', batchId)
      .eq('is_published', true)
      .in('content_id', recordingIds);

    let publishedIds = [...new Set((publishedLinks ?? []).map((l: any) => l.content_id))];
    if (publishedIds.length === 0) {
      // Legacy fallback: if no published rows but also zero curriculum rows at all, use recording_batches.
      const { data: anyCurriculum } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .select('content_id')
        .eq('content_type', 'recording')
        .eq('batch_id', batchId)
        .in('content_id', recordingIds);
      if (!anyCurriculum || anyCurriculum.length === 0) {
        publishedIds = recordingIds;
      } else {
        return [];
      }
    }

    const { data: recordings } = await this.supabaseService.client
      .from(TABLES.RECORDINGS)
      .select('id, title, description, duration_seconds, status, created_at, sort_order')
      .in('id', publishedIds)
      .eq('status', 'ready')
      .order('sort_order', { ascending: true });

    return (recordings ?? []).map((v: any) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      duration: v.duration_seconds,
      status: v.status,
      createdAt: v.created_at,
    }));
  }

  private validateCurriculumPayload(recordingId: string, batchIds: string[]): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!recordingId || !uuidRegex.test(recordingId)) {
      throw new BadRequestException(
        `Invalid recording ID format for curriculum operation: "${recordingId}". Expected a valid UUID.`,
      );
    }

    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      throw new BadRequestException('At least one batch ID is required for curriculum operation');
    }

    for (const batchId of batchIds) {
      if (!batchId || !uuidRegex.test(batchId)) {
        throw new BadRequestException(
          `Invalid batch ID format in curriculum operation: "${batchId}". Expected a valid UUID.`,
        );
      }
    }
  }

  /**
   * Create batch links (recording_batches) and curriculum entries for a recording.
   * Shared between requestUploadUrl() and createRecordingWithUpload() transaction.
   * @throws BadRequestException on any DB failure.
   */
  private async createBatchLinksAndCurriculum(
    recordingId: string,
    batchIds: string[],
    options?: {
      categoryName?: string;
      moduleName?: string;
      isPublished?: boolean;
      titleOverride?: string;
    },
  ): Promise<void> {
    this.validateCurriculumPayload(recordingId, batchIds);

    const records = batchIds.map((batchId) => ({
      recording_id: recordingId,
      batch_id: batchId,
    }));

    const { error: linkError } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .upsert(records, { onConflict: 'recording_id,batch_id' });

    if (linkError) {
      throw new BadRequestException(`Failed to link recording to batches: ${linkError.message}`);
    }

    const categoryName = options?.categoryName || 'General';
    const moduleName = options?.moduleName || null;
    const isPublished = options?.isPublished ?? true;
    const titleOverride = options?.titleOverride ?? null;

    const entries = batchIds.map((batchId) => ({
      batch_id: batchId,
      content_id: recordingId,
      content_type: 'recording',
      category_name: categoryName,
      module_name: moduleName,
      title_override: titleOverride,
      sort_order: 0,
      is_published: isPublished,
    }));

    const { error: curriculumError } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .upsert(entries, { onConflict: 'batch_id,content_id,content_type' });

    if (curriculumError) {
      throw new BadRequestException(
        `Failed to create curriculum entries for recording ${recordingId}: ${curriculumError.message}`,
      );
    }
  }

  private async autoCreateCurriculumEntries(recordingId: string, dto: CreateRecordingDto) {
    this.validateCurriculumPayload(recordingId, dto.batchIds);

    const categoryName = dto.categoryName || 'General';
    const moduleName = dto.moduleName || null;
    const isPublished = dto.isPublished ?? true;

    const entries = dto.batchIds.map((batchId) => ({
      batch_id: batchId,
      content_id: recordingId,
      content_type: 'recording',
      category_name: categoryName,
      module_name: moduleName,
      title_override: dto.titleOverride ?? null,
      sort_order: 0,
      is_published: isPublished,
    }));

    this.logger.log(
      `[Curriculum UPSERT] BEGIN | recordingId=${recordingId} | batchIds=${JSON.stringify(dto.batchIds)} | entries=${JSON.stringify(entries)} | table=${TABLES.BATCH_RECORDING_CURRICULUM} | ts=${new Date().toISOString()}`,
    );

    const { data, error, status, count } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .upsert(entries, { onConflict: 'batch_id,content_id,content_type' });

    if (error) {
      this.logger.error(
        `[Curriculum UPSERT] FAILED | recordingId=${recordingId} | batchIds=${JSON.stringify(dto.batchIds)} | error=${JSON.stringify(error)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
      );
      throw new BadRequestException(
        `Failed to create curriculum entries for recording ${recordingId}. Supabase Error [${error.code}]: ${error.message}${error.details ? ` | Details: ${error.details}` : ''}${error.hint ? ` | Hint: ${error.hint}` : ''}`,
      );
    }

    this.logger.debug(
      `[Curriculum UPSERT] SUCCEEDED | recordingId=${recordingId} | batchIds=${JSON.stringify(dto.batchIds)} | status=${status} | count=${count} | ts=${new Date().toISOString()}`,
    );
  }
}
