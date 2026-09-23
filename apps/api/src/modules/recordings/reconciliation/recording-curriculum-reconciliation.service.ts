import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/services/supabase.service';
import { TABLES } from '../../../common/constants/tables.constant';
import { normalizeCategoryDisplay, normalizeCategoryKey } from '../../../common/utils/category.util';

export interface ReconciliationSummary {
  dryRun: boolean;
  processed: number;
  inserted: number;
  deleted: number;
  failed: number;
  skipped: number;
  durationMs: number;
  missingEntries: any[];
  orphanEntries: any[];
}

@Injectable()
export class RecordingCurriculumReconciliationService {
  private readonly logger = new Logger(RecordingCurriculumReconciliationService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Run curriculum reconciliation.
   * Detects missing curriculum entries (in recording_batches but not in batch_recording_curriculum)
   * and orphan entries (in batch_recording_curriculum but not in recording_batches).
   * In live mode (dryRun=false): inserts missing entries and deletes orphans.
   * @param dryRun - If true (default), only reports drift without mutations.
   * @returns ReconciliationSummary with processed/inserted/deleted/failed/skipped/durationMs and entry lists.
   */
  async run(dryRun = true): Promise<ReconciliationSummary> {
    const startTime = Date.now();

    const missingEntries = await this.findMissingCurriculumEntries();
    const orphanEntries = await this.findOrphanCurriculumEntries();

    const processed = missingEntries.length + orphanEntries.length;
    let inserted = 0;
    let deleted = 0;
    let failed = 0;

    if (!dryRun) {
      const insertResult = await this.insertMissingEntries(missingEntries);
      inserted = insertResult.inserted;
      failed += insertResult.failed;

      const deleteResult = await this.deleteOrphanEntries(orphanEntries);
      deleted = deleteResult.deleted;
      failed += deleteResult.failed;
    }

    const skipped = dryRun ? processed : processed - inserted - deleted - failed;
    const durationMs = Date.now() - startTime;

    this.logger.log(
      `[Reconciliation] ${dryRun ? 'DRY RUN — ' : ''}Complete | processed=${processed} | inserted=${inserted} | deleted=${deleted} | failed=${failed} | skipped=${skipped} | durationMs=${durationMs}`,
    );

    return {
      dryRun,
      processed,
      inserted,
      deleted,
      failed,
      skipped,
      durationMs,
      missingEntries,
      orphanEntries,
    };
  }

  private async findMissingCurriculumEntries(): Promise<any[]> {
    const { data: batchLinks } = await this.supabaseService.client
      .from(TABLES.RECORDING_BATCHES)
      .select('recording_id, batch_id');

    const missing: any[] = [];
    for (const link of batchLinks ?? []) {
      const { data: existing } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .select('id')
        .eq('batch_id', (link as any).batch_id)
        .eq('content_id', (link as any).recording_id)
        .eq('content_type', 'recording')
        .maybeSingle();

      if (!existing) {
        missing.push({
          batch_id: (link as any).batch_id,
          content_id: (link as any).recording_id,
        });
      }
    }

    return missing;
  }

  private async findOrphanCurriculumEntries(): Promise<any[]> {
    const { data: curriculumEntries } = await this.supabaseService.client
      .from(TABLES.BATCH_RECORDING_CURRICULUM)
      .select('id, batch_id, content_id')
      .eq('content_type', 'recording');

    const orphans: any[] = [];
    for (const entry of curriculumEntries ?? []) {
      const { data: link } = await this.supabaseService.client
        .from(TABLES.RECORDING_BATCHES)
        .select('recording_id')
        .eq('recording_id', (entry as any).content_id)
        .eq('batch_id', (entry as any).batch_id)
        .maybeSingle();

      if (!link) {
        orphans.push({
          id: (entry as any).id,
          batch_id: (entry as any).batch_id,
          content_id: (entry as any).content_id,
        });
      }
    }

    return orphans;
  }

  private async insertMissingEntries(entries: any[]): Promise<{ inserted: number; failed: number }> {
    let inserted = 0;
    let failed = 0;

    for (const entry of entries) {
      // Resolve category_sort_order for 'General' in this batch
      let categorySortOrder = 0;
      try {
        const { data: existing } = await this.supabaseService.client
          .from(TABLES.BATCH_RECORDING_CURRICULUM)
          .select('category_name, category_sort_order')
          .eq('batch_id', entry.batch_id);
        const generalKey = normalizeCategoryKey('General');
        const keyToSort = new Map<string, number>();
        let maxSort = -1;
        for (const row of (existing ?? []) as any[]) {
          const k = normalizeCategoryKey(normalizeCategoryDisplay(row.category_name ?? 'General'));
          if (!keyToSort.has(k)) keyToSort.set(k, row.category_sort_order ?? 0);
          maxSort = Math.max(maxSort, row.category_sort_order ?? 0);
        }
        if (keyToSort.has(generalKey)) {
          categorySortOrder = keyToSort.get(generalKey)!;
        } else if (maxSort >= 0) {
          categorySortOrder = maxSort + 1;
        } else {
          categorySortOrder = 0;
        }
      } catch {}
      const { error } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .insert({
          batch_id: entry.batch_id,
          content_id: entry.content_id,
          content_type: 'recording',
          category_name: 'General',
          category_sort_order: categorySortOrder,
          module_name: null,
          title_override: null,
          sort_order: 0,
          is_published: true,
        });

      if (error) {
        this.logger.warn(
          `Failed to insert curriculum entry for recording ${entry.content_id} in batch ${entry.batch_id}: ${error.message} [${error.code}]`,
        );
        failed++;
      } else {
        inserted++;
      }
    }

    return { inserted, failed };
  }

  private async deleteOrphanEntries(entries: any[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const entry of entries) {
      const { error } = await this.supabaseService.client
        .from(TABLES.BATCH_RECORDING_CURRICULUM)
        .delete()
        .eq('id', entry.id);

      if (error) {
        this.logger.warn(
          `Failed to delete orphan curriculum entry ${entry.id} for recording ${entry.content_id} in batch ${entry.batch_id}: ${error.message} [${error.code}]`,
        );
        failed++;
      } else {
        deleted++;
      }
    }

    return { deleted, failed };
  }
}
