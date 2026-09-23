import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException, Optional } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { TABLES } from '../../common/constants/tables.constant';
import { AddCurriculumItemDto } from './dto/add-curriculum-item.dto';
import { UpdateCurriculumItemDto } from './dto/update-curriculum-item.dto';
import { ReorderCurriculumDto } from './dto/reorder-curriculum.dto';
import { Transaction, TransactionStep } from '../../common/utils/transaction.util';
import {
  normalizeCategoryDisplay,
  normalizeCategoryKey,
  groupByCategoryMerged,
  resolveCanonicalCategoryName,
} from '../../common/utils/category.util';

@Injectable()
export class BatchCurriculumService {
  private readonly logger = new Logger(BatchCurriculumService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) {}

  private async invalidateForBatch(batchId: string): Promise<void> {
    if (!this.redisCache) return;
    try {
      const { data: students } = await this.supabaseService.client
        .from(TABLES.BATCH_STUDENTS)
        .select('user_id')
        .eq('batch_id', batchId);
      const userIds = [...new Set((students ?? []).map((s: any) => s.user_id))];
      if (userIds.length > 0) {
        await this.redisCache.invalidateRecordingsCacheForUsers(userIds);
      } else {
        await this.redisCache.invalidateRecordingsCache();
      }
    } catch {
      // best-effort fallback: global invalidation
      try {
        await this.redisCache.invalidateRecordingsCache();
      } catch {}
    }
  }

  async findAll(batchId: string) {
    const raw = await this.fetchCurriculum(batchId, false);
    return this.groupByCategory(raw);
  }

  async findPublished(batchId: string) {
    const raw = await this.fetchCurriculum(batchId, true);
    return this.groupByCategory(raw);
  }

  private async fetchCurriculum(batchId: string, publishedOnly: boolean) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('*')
      .eq('batch_id', batchId)
      .order('category_name', { ascending: true })
      .order('sort_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch curriculum for batch ${batchId}: ${error.message}`);
      throw new InternalServerErrorException('Could not load curriculum.');
    }

    const items = publishedOnly
      ? (data ?? []).filter((i: any) => i.is_published)
      : (data ?? []);

    if (items.length === 0) return [];

    // Batch resolve: collect IDs per content type → single IN query per type
    const idsByType: Record<string, string[]> = { test: [], session: [], recording: [] };
    for (const it of items as any[]) {
      const type = it.content_type ?? 'recording';
      const id = it.content_id;
      if (!id || type === 'pdf') continue;
      if (type === 'test') idsByType.test.push(id);
      else if (type === 'session') idsByType.session.push(id);
      else idsByType.recording.push(id);
    }

    const unique = (arr: string[]) => [...new Set(arr)];
    const testIds = unique(idsByType.test);
    const sessionIds = unique(idsByType.session);
    const recordingIds = unique(idsByType.recording);

    const buildMap = async (table: string, ids: string[], select: string) => {
      if (!ids.length) return new Map<string, any>();
      try {
        const { data } = await (this.supabaseService.client.from(table as any).select(select).in('id', ids) as any);
        const m = new Map<string, any>();
        for (const row of (data ?? []) as any[]) m.set(row.id, row);
        return m;
      } catch { return new Map<string, any>(); }
    };
    const [testsMap, sessionsMap, recordingsMap] = await Promise.all([
      buildMap(TABLES.TESTS, testIds, 'id, title, description, duration_minutes, total_marks, passing_marks'),
      buildMap(TABLES.LIVE_SESSIONS, sessionIds, 'id, topic as title, description, start_time, status'),
      buildMap(TABLES.RECORDINGS, recordingIds, 'id, title, description, duration_seconds, status, created_at'),
    ]);

    const enriched = items.map((item: any) => {
      const type = item.content_type ?? 'recording';
      const id = item.content_id;
      let content: any;
      if (!id) {
        if (type === 'pdf') content = { title: item.pdf_title ?? item.title_override ?? 'PDF Document', description: null, pdfUrl: item.pdf_url };
        else content = { title: item.title_override ?? 'Unknown', description: null };
      } else if (type === 'test') {
        content = testsMap.get(id) ?? { title: item.title_override ?? 'Unknown Test' };
      } else if (type === 'session') {
        content = sessionsMap.get(id) ?? { title: item.title_override ?? 'Unknown Session' };
      } else if (type === 'pdf') {
        content = { title: item.pdf_title ?? item.title_override ?? 'PDF Document', description: null, pdfUrl: item.pdf_url };
      } else {
        content = recordingsMap.get(id) ?? { title: item.title_override ?? 'Unknown Recording' };
      }
      return { ...item, content };
    });

    return enriched;
  }

  private async resolveContent(item: any): Promise<any> {
    // Kept for backward compat / single-item paths; batched path above is preferred.
    const type = item.content_type ?? 'recording';
    const id = item.content_id;

    if (!id) {
      if (type === 'pdf') {
        return {
          title: item.pdf_title ?? item.title_override ?? 'PDF Document',
          description: null,
        };
      }
      return { title: item.title_override ?? 'Unknown', description: null };
    }

    try {
      if (type === 'test') {
        const { data } = await this.supabaseService.client
          .from(TABLES.TESTS)
          .select('id, title, description, duration_minutes, total_marks, passing_marks')
          .eq('id', id)
          .single();
        return data ?? { title: item.title_override ?? 'Unknown Test' };
      }

      if (type === 'session') {
        const { data } = await this.supabaseService.client
          .from(TABLES.LIVE_SESSIONS)
          .select('id, topic as title, description, start_time, status')
          .eq('id', id)
          .single();
        return data ?? { title: item.title_override ?? 'Unknown Session' };
      }

      if (type === 'pdf') {
        return {
          title: item.pdf_title ?? item.title_override ?? 'PDF Document',
          description: null,
          pdfUrl: item.pdf_url,
        };
      }

      // Default: recording
      const { data } = await this.supabaseService.client
        .from(TABLES.RECORDINGS)
        .select('id, title, description, duration_seconds, status, created_at')
        .eq('id', id)
        .single();
      return data ?? { title: item.title_override ?? 'Unknown Recording' };
    } catch {
      return { title: item.title_override ?? `Unknown ${type}` };
    }
  }

  private groupByCategory(items: any[]) {
    return groupByCategoryMerged(items);
  }

  async add(batchId: string, dto: AddCurriculumItemDto) {
    let insertedData: any = null;

    // Normalize whitespace + case-insensitive dedup within this batch
    const normalizedDisplay = normalizeCategoryDisplay(dto.categoryName ?? 'General');
    let canonicalCategory = normalizedDisplay;
    try {
      const { data: existing } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .select('category_name')
        .eq('batch_id', batchId);
      const existingNames = (existing ?? []).map((r: any) => r.category_name as string);
      canonicalCategory = resolveCanonicalCategoryName(normalizedDisplay, existingNames);
    } catch {
      // best-effort: fallback to normalized display
    }

    const steps: TransactionStep[] = [
      {
        name: 'insert-curriculum-item',
        execute: async () => {
          const { data, error } = await this.supabaseService.client
            .from(TABLES.BATCH_RECORDING_CURRICULUM)
            .insert({
              batch_id: batchId,
              content_id: dto.contentId ?? null,
              content_type: dto.contentType,
              category_name: canonicalCategory,
              module_name: dto.moduleName ?? null,
              sort_order: dto.sortOrder ?? 0,
              is_published: dto.isPublished ?? true,
              pdf_url: dto.pdfUrl ?? null,
              pdf_title: dto.pdfTitle ?? null,
              title_override: dto.titleOverride ?? null,
            })
            .select('*')
            .single();

          if (error) {
            this.logger.error(`Failed to add curriculum item: ${error.message}`);
            throw new InternalServerErrorException(`Could not add curriculum item: ${error.message}`);
          }

          insertedData = data;
        },
        rollback: async () => {
          if (insertedData) {
            await this.supabaseService.client
              .from(TABLES.BATCH_RECORDING_CURRICULUM)
              .delete()
              .eq('id', insertedData.id);
          }
        },
      },
    ];

    if (dto.contentType === 'recording' && dto.contentId) {
      steps.push({
        name: 'upsert-recording-batch-link',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .upsert(
              { recording_id: dto.contentId, batch_id: batchId },
              { onConflict: 'recording_id,batch_id' },
            );

          if (error) {
            this.logger.error(
              `Failed to link recording ${dto.contentId} to batch ${batchId}: ${error.message}`,
            );
            throw new InternalServerErrorException(
              `Could not add curriculum item: failed to link recording to batch. ${error.message}`,
            );
          }
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .delete()
            .eq('recording_id', dto.contentId)
            .eq('batch_id', batchId);
        },
      });
    }

    const tx = new Transaction();
    await tx.run(steps);

    await this.invalidateForBatch(batchId).catch(() => {});

    return insertedData;
  }

  async update(id: string, dto: UpdateCurriculumItemDto) {
    const existingItem = await this.findById(id);

    const updates: Record<string, any> = {};
    if (dto.categoryName !== undefined) {
      const display = normalizeCategoryDisplay(dto.categoryName);
      let canonical = display;
      try {
        const { data: existing } = await this.supabaseService.client
          .from(TABLES.BATCH_RECORDING_CURRICULUM)
          .select('category_name')
          .eq('batch_id', (existingItem as any).batch_id);
        const existingNames = (existing ?? []).map((r: any) => r.category_name as string);
        canonical = resolveCanonicalCategoryName(display, existingNames);
        // If the desired category already exists as a different item's category with same key,
        // we already deduped to that canonical. Also allow keeping own display if it's the only
        // instance — but reuse rule above already handles case-only differences.
        // Also handle empty -> General.
        if (!canonical) canonical = 'General';
      } catch {}
      updates.category_name = canonical;
    }
    if (dto.moduleName !== undefined) updates.module_name = dto.moduleName;
    if (dto.sortOrder !== undefined) updates.sort_order = dto.sortOrder;
    if (dto.isPublished !== undefined) updates.is_published = dto.isPublished;
    if (dto.pdfUrl !== undefined) updates.pdf_url = dto.pdfUrl;
    if (dto.pdfTitle !== undefined) updates.pdf_title = dto.pdfTitle;
    if (dto.titleOverride !== undefined) updates.title_override = dto.titleOverride;

    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to update curriculum item ${id}: ${error.message}`);
      throw new InternalServerErrorException(`Could not update curriculum item: ${error.message}`);
    }
    if (data?.batch_id) {
      await this.invalidateForBatch(data.batch_id).catch(() => {});
    }
    return data;
  }

  async remove(id: string) {
    const item = await this.findById(id);

    // Check 1: Block delete if student progress exists (DB enforces RESTRICT, but catch early)
    const { count: progressCount, error: progressError } = await this.supabaseService.client
      .from(TABLES.BATCH_CURRICULUM_ITEM_PROGRESS)
      .select('id', { count: 'exact', head: true })
      .eq('curriculum_id', id);

    if (!progressError && (progressCount ?? 0) > 0) {
      throw new BadRequestException(
        `Cannot delete curriculum item "${id}": ${progressCount} student(s) have progress on this item. Remove progress records first.`,
      );
    }

    // Warn about cascade-deleted prerequisites (informational only — CASCADE is acceptable)
    const { data: prereqs, error: prereqError } = await this.supabaseService.client
      .from(TABLES.BATCH_CURRICULUM_PREREQUISITES)
      .select('id')
      .or(`curriculum_id.eq.${id},prerequisite_id.eq.${id}`);

    if (!prereqError && (prereqs ?? []).length > 0) {
      this.logger.warn(
        `Removing curriculum item "${id}" will cascade-delete ${prereqs.length} prerequisite link(s).`,
      );
    }

    const steps: TransactionStep[] = [];

    // Keep recording_batches in sync for access control (single source of truth)
    if (item.content_type === 'recording' && item.content_id) {
      steps.push({
        name: 'delete-recording-batch-link',
        execute: async () => {
          const { error } = await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .delete()
            .eq('recording_id', item.content_id)
            .eq('batch_id', item.batch_id);

          if (error) {
            this.logger.error(
              `Failed to remove recording batch link for ${item.content_id}: ${error.message}`,
            );
            throw new InternalServerErrorException(
              `Could not remove curriculum item: failed to remove recording batch link. ${error.message}`,
            );
          }
        },
        rollback: async () => {
          await this.supabaseService.client
            .from(TABLES.RECORDING_BATCHES)
            .upsert(
              { recording_id: item.content_id, batch_id: item.batch_id },
              { onConflict: 'recording_id,batch_id' },
            );
        },
      });
    }

    steps.push({
      name: 'delete-curriculum-item',
      execute: async () => {
        const { error } = await this.supabaseService.client
          .from(TABLES.BATCH_RECORDING_CURRICULUM)
          .delete()
          .eq('id', id);

        if (error) {
          this.logger.error(`Failed to remove curriculum item ${id}: ${error.message}`);
          throw new InternalServerErrorException(`Could not remove curriculum item: ${error.message}`);
        }
      },
      rollback: async () => {
        // Cannot re-insert a deleted row reliably without original data
        this.logger.warn(`Cannot rollback curriculum item deletion for ${id} — manual restoration may be required`);
      },
    });

    const tx = new Transaction();
    await tx.run(steps);

    await this.invalidateForBatch(item.batch_id).catch(() => {});

    return { deleted: true, cascadedPrerequisites: (prereqs ?? []).length };
  }

  async integrityCheck(batchId: string) {
    const items = await this.fetchCurriculum(batchId, false);

    const orphaned: any[] = [];
    const progressConflicts: any[] = [];

    if (items.length === 0) {
      return { batchId, totalItems: 0, orphanedReferences: [], itemsWithProgress: [] };
    }

    // Batch orphan detection: 3 IN queries + 1 IN for progress counts
    const idsByType: Record<string, string[]> = { test: [], session: [], recording: [] };
    const itemByContentKey = new Map<string, any>();
    for (const it of items as any[]) {
      const type = it.content_type ?? 'recording';
      const id = it.content_id;
      if (id && type !== 'pdf') {
        if (type === 'test') idsByType.test.push(id);
        else if (type === 'session') idsByType.session.push(id);
        else idsByType.recording.push(id);
        itemByContentKey.set(`${type}:${id}`, it);
      }
    }
    const uniq = (arr: string[]) => [...new Set(arr)];
    const fetchIds = async (table: string, ids: string[]) => {
      if (!ids.length) return new Set<string>();
      try { const { data } = await (this.supabaseService.client.from(table as any).select('id').in('id', ids) as any); return new Set((data ?? []).map((x: any) => x.id)); } catch { return new Set<string>(); }
    };
    const fetchProgress = async () => {
      try { const { data } = await (this.supabaseService.client.from(TABLES.BATCH_CURRICULUM_ITEM_PROGRESS).select('curriculum_id').in('curriculum_id', items.map((i: any) => i.id)) as any);
        const m = new Map<string, number>(); for (const row of (data ?? []) as any[]) m.set(row.curriculum_id, (m.get(row.curriculum_id) ?? 0) + 1); return m; } catch { return new Map<string, number>(); }
    };
    const [testSet, sessionSet, recordingSet, progressCounts] = await Promise.all([
      fetchIds(TABLES.TESTS, uniq(idsByType.test)),
      fetchIds(TABLES.LIVE_SESSIONS, uniq(idsByType.session)),
      fetchIds(TABLES.RECORDINGS, uniq(idsByType.recording)),
      fetchProgress(),
    ]);

    for (const item of items as any[]) {
      const type = item.content_type ?? 'recording';
      const id = item.content_id;
      if (id && type !== 'pdf') {
        let exists = true;
        if (type === 'test') exists = (testSet as Set<string>).has(id);
        else if (type === 'session') exists = (sessionSet as Set<string>).has(id);
        else exists = (recordingSet as Set<string>).has(id);
        if (!exists) {
          orphaned.push({ curriculumId: item.id, contentType: type, contentId: id, category: item.category_name });
        }
      }
      const cnt = (progressCounts as Map<string, number>).get(item.id) ?? 0;
      if (cnt > 0) {
        progressConflicts.push({ curriculumId: item.id, contentType: type, studentCount: cnt });
      }
    }

    return {
      batchId,
      totalItems: items.length,
      orphanedReferences: orphaned,
      itemsWithProgress: progressConflicts,
    };
  }

  async reorder(batchId: string, dto: ReorderCurriculumDto) {
    for (const item of dto.items) {
      const { error } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .update({ sort_order: item.sortOrder })
        .eq('id', item.id);
      if (error) {
        this.logger.error(`Reorder failed for item ${item.id}: ${error.message}`);
        throw new InternalServerErrorException('Reorder failed.');
      }
    }
    await this.invalidateForBatch(batchId).catch(() => {});
    return { reordered: true };
  }

  private async findById(id: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Curriculum item "${id}" not found.`);
    }
    return data;
  }
}
