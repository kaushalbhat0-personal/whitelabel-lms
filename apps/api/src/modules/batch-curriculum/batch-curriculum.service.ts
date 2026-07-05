import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { AddCurriculumItemDto } from './dto/add-curriculum-item.dto';
import { UpdateCurriculumItemDto } from './dto/update-curriculum-item.dto';
import { ReorderCurriculumDto } from './dto/reorder-curriculum.dto';
import { Transaction, TransactionStep } from '../../common/utils/transaction.util';

@Injectable()
export class BatchCurriculumService {
  private readonly logger = new Logger(BatchCurriculumService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

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

    const enriched = await Promise.all(
      items.map(async (item: any) => {
        const content = await this.resolveContent(item);
        return { ...item, content };
      }),
    );

    return enriched;
  }

  private async resolveContent(item: any): Promise<any> {
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
    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      const cat = item.category_name ?? 'General';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }
    return Object.entries(grouped).map(([category, items]) => ({
      category,
      items,
    }));
  }

  async add(batchId: string, dto: AddCurriculumItemDto) {
    let insertedData: any = null;

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
              category_name: dto.categoryName,
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

    return insertedData;
  }

  async update(id: string, dto: UpdateCurriculumItemDto) {
    await this.findById(id);

    const updates: Record<string, any> = {};
    if (dto.categoryName !== undefined) updates.category_name = dto.categoryName;
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

    return { deleted: true, cascadedPrerequisites: (prereqs ?? []).length };
  }

  async integrityCheck(batchId: string) {
    const items = await this.fetchCurriculum(batchId, false);

    const orphaned: any[] = [];
    const progressConflicts: any[] = [];

    for (const item of items) {
      const type = item.content_type ?? 'recording';
      const id = item.content_id;

      // Checks 2-3: Orphan detection for each content type
      if (id && type !== 'pdf') {
        let exists = false;
        try {
          if (type === 'test') {
            const { data } = await this.supabaseService.client
              .from(TABLES.TESTS)
              .select('id')
              .eq('id', id)
              .maybeSingle();
            exists = !!data;
          } else if (type === 'session') {
            const { data } = await this.supabaseService.client
              .from(TABLES.LIVE_SESSIONS)
              .select('id')
              .eq('id', id)
              .maybeSingle();
            exists = !!data;
          } else {
            // recording
            const { data } = await this.supabaseService.client
              .from(TABLES.RECORDINGS)
              .select('id')
              .eq('id', id)
              .maybeSingle();
            exists = !!data;
          }
        } catch {
          exists = false;
        }

        if (!exists) {
          orphaned.push({
            curriculumId: item.id,
            contentType: type,
            contentId: id,
            category: item.category_name,
          });
        }
      }

      // Check for progress records on this item
      const { count: progCount } = await this.supabaseService.client
        .from(TABLES.BATCH_CURRICULUM_ITEM_PROGRESS)
        .select('id', { count: 'exact', head: true })
        .eq('curriculum_id', item.id);

      if (progCount && progCount > 0) {
        progressConflicts.push({
          curriculumId: item.id,
          contentType: type,
          studentCount: progCount,
        });
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
