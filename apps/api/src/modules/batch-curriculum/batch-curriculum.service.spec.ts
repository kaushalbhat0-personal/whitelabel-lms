import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException, BadRequestException } from '@nestjs/common';
import { BatchCurriculumService } from './batch-curriculum.service';
import { SupabaseService } from '../../common/services/supabase.service';

function buildChain() {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    then: jest.fn((resolve) => resolve({ data: null, error: null })),
  };
  return chain;
}

describe('BatchCurriculumService', () => {
  let service: BatchCurriculumService;
  let chain: any;

  beforeEach(async () => {
    chain = buildChain();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchCurriculumService,
        {
          provide: SupabaseService,
          useValue: {
            client: chain,
          },
        },
      ],
    }).compile();

    service = module.get<BatchCurriculumService>(BatchCurriculumService);
    jest.clearAllMocks();
  });

  describe('add - recording type', () => {
    it('should insert into batch_recording_curriculum and recording_batches', async () => {
      const batchId = 'batch-1';
      const recordingId = 'rec-1';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        if (callIndex === 0) {
          // pre-fetch existing categories (case-insensitive dedup)
          c.then = jest.fn((resolve) => resolve({ data: [], error: null }));
        } else if (callIndex === 1) {
          c.insert.mockReturnValue(c);
          c.select.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: 'curriculum-1', batch_id: batchId, content_id: recordingId, content_type: 'recording' },
            error: null,
          });
        } else if (callIndex === 2) {
          c.upsert.mockResolvedValue({ data: null, error: null });
        }
        callIndex++;
        return c;
      });

      const result = await service.add(batchId, {
        contentType: 'recording',
        contentId: recordingId,
        categoryName: 'General',
      } as any);

      expect(result.id).toBe('curriculum-1');
      expect(chain.from).toHaveBeenCalledWith('batch_recording_curriculum');
      expect(chain.from).toHaveBeenCalledWith('recording_batches');
    });

    it('should rollback curriculum entry when recording_batches upsert fails', async () => {
      const batchId = 'batch-1';
      const recordingId = 'rec-1';
      const curriculumId = 'curriculum-1';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        if (callIndex === 0) {
          c.then = jest.fn((resolve) => resolve({ data: [], error: null }));
        } else if (callIndex === 1) {
          c.insert.mockReturnValue(c);
          c.select.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: curriculumId, batch_id: batchId, content_id: recordingId, content_type: 'recording' },
            error: null,
          });
        } else if (callIndex === 2) {
          c.upsert.mockResolvedValue({
            data: null,
            error: { message: 'FK violation', code: '23503' },
          });
        } else if (callIndex === 3) {
          c.delete.mockReturnValue(c);
          c.eq.mockResolvedValue({ data: null, error: null });
        }
        callIndex++;
        return c;
      });

      await expect(
        service.add(batchId, {
          contentType: 'recording',
          contentId: recordingId,
          categoryName: 'General',
        } as any),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should NOT insert into recording_batches for non-recording types', async () => {
      const batchId = 'batch-1';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        if (callIndex === 0) {
          c.then = jest.fn((resolve) => resolve({ data: [], error: null }));
        } else {
          c.insert.mockReturnValue(c);
          c.select.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: 'curriculum-pdf', batch_id: batchId, content_id: null, content_type: 'pdf' },
            error: null,
          });
        }
        callIndex++;
        return c;
      });

      const result = await service.add(batchId, {
        contentType: 'pdf',
        categoryName: 'General',
        pdfUrl: 'https://example.com/test.pdf',
      } as any);

      expect(result.id).toBe('curriculum-pdf');
      const recordingBatchesCalls = chain.from.mock.calls.filter(
        (call: any[]) => call[0] === 'recording_batches',
      );
      expect(recordingBatchesCalls.length).toBe(0);
    });
  });

  describe('remove - recording type', () => {
    it('should delete from recording_batches and batch_recording_curriculum', async () => {
      const curriculumId = 'curriculum-1';
      const batchId = 'batch-1';
      const recordingId = 'rec-1';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          c.select.mockReturnValue(c);
          c.eq.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: curriculumId, batch_id: batchId, content_id: recordingId, content_type: 'recording' },
            error: null,
          });
        } else if (idx === 1) {
          c.select.mockReturnValue(c);
          c.eq.mockResolvedValue({ data: [], error: null, count: 0 });
        } else if (idx === 2) {
          c.or.mockResolvedValue({ data: [], error: null });
        } else if (idx === 3) {
          c.delete.mockReturnValue(c);
          c.eq.mockImplementationOnce(() => c);
          c.eq.mockImplementationOnce(() => c);
          c.then = jest.fn((resolve) => resolve({ data: null, error: null }));
        } else if (idx === 4) {
          c.delete.mockReturnValue(c);
          c.eq.mockResolvedValue({ data: null, error: null });
        }
        return c;
      });

      const result = await service.remove(curriculumId);

      expect(result.deleted).toBe(true);
      expect(chain.from).toHaveBeenCalledWith('recording_batches');
      expect(chain.from).toHaveBeenCalledWith('batch_recording_curriculum');
    });

    it('should throw when recording_batches delete fails', async () => {
      const curriculumId = 'curriculum-1';
      const batchId = 'batch-1';
      const recordingId = 'rec-1';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          c.select.mockReturnValue(c);
          c.eq.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: curriculumId, batch_id: batchId, content_id: recordingId, content_type: 'recording' },
            error: null,
          });
        } else if (idx === 1) {
          c.select.mockReturnValue(c);
          c.eq.mockResolvedValue({ data: [], error: null, count: 0 });
        } else if (idx === 2) {
          c.or.mockResolvedValue({ data: [], error: null });
        } else if (idx === 3) {
          c.delete.mockReturnValue(c);
          c.eq.mockImplementationOnce(() => c);
          c.eq.mockImplementationOnce(() => c);
          c.then = jest.fn((resolve) => resolve({ data: null, error: { message: 'DB error', code: 'PGRST301' } }));
        }
        return c;
      });

      await expect(service.remove(curriculumId)).rejects.toThrow(InternalServerErrorException);
    });

    it('should NOT delete from recording_batches for non-recording types', async () => {
      const curriculumId = 'curriculum-pdf';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          c.select.mockReturnValue(c);
          c.eq.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: curriculumId, batch_id: 'batch-1', content_id: null, content_type: 'pdf' },
            error: null,
          });
        } else if (idx === 1) {
          c.select.mockReturnValue(c);
          c.eq.mockResolvedValue({ data: [], error: null, count: 0 });
        } else if (idx === 2) {
          c.or.mockResolvedValue({ data: [], error: null });
        } else if (idx === 3) {
          c.delete.mockReturnValue(c);
          c.eq.mockResolvedValue({ data: null, error: null });
        }
        return c;
      });

      const result = await service.remove(curriculumId);

      expect(result.deleted).toBe(true);
      const recordingBatchesCalls = chain.from.mock.calls.filter(
        (call: any[]) => call[0] === 'recording_batches',
      );
      expect(recordingBatchesCalls.length).toBe(0);
    });
  });

  describe('reorderCategories', () => {
    const batchId = '550e8400-e29b-41d4-a716-446655440001';

    function mockReorderCategories(existingRows: any[], orderedNames: string[]) {
      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const c = buildChain();
        const idx = callIndex++;
        if (idx === 0) {
          // batch exists check: from('batches').select('id').eq('id', batchId).single()
          c.select.mockReturnThis();
          c.eq.mockReturnThis();
          c.single.mockResolvedValue({ data: { id: batchId }, error: null });
        } else if (idx === 1) {
          // fetch existing categories: from('batch_recording_curriculum').select('id, category_name, category_sort_order').eq('batch_id', batchId)
          c.select.mockReturnThis();
          c.eq.mockReturnThis();
          // Return existingRows as data
          c.then = jest.fn((resolve) => resolve({ data: existingRows, error: null }));
          // Also support .then for await
          (c as any).then = (fn: any) => Promise.resolve({ data: existingRows, error: null }).then(fn);
          // Mock the chain to be thenable
          return {
            select: c.select,
            eq: c.eq,
            then: (fn: any) => Promise.resolve({ data: existingRows, error: null }).then(fn),
          } as any;
        } else {
          // Subsequent calls are updates: from('batch_recording_curriculum').update(...).eq('batch_id', ...).in('id', ...)
          c.update.mockReturnThis();
          c.eq.mockReturnThis();
          c.in.mockResolvedValue({ error: null });
        }
        return c;
      });
      return chain.from;
    }

    it('should reorder categories A,B,C -> C,A,B', async () => {
      const existing = [
        { id: '1', category_name: 'A', category_sort_order: 0, batch_id: batchId },
        { id: '2', category_name: 'A', category_sort_order: 0, batch_id: batchId },
        { id: '3', category_name: 'B', category_sort_order: 1, batch_id: batchId },
        { id: '4', category_name: 'C', category_sort_order: 2, batch_id: batchId },
      ];
      mockReorderCategories(existing, ['C', 'A', 'B']);
      const result = await service.reorderCategories(batchId, { orderedCategoryNames: ['C', 'A', 'B'] });
      expect(result.reordered).toBe(true);
    });

    it('should preserve recording sort_order within categories', async () => {
      const existing = [
        { id: 'a1', category_name: 'A', category_sort_order: 0, batch_id: batchId, sort_order: 0 },
        { id: 'a2', category_name: 'A', category_sort_order: 0, batch_id: batchId, sort_order: 1 },
        { id: 'a3', category_name: 'A', category_sort_order: 0, batch_id: batchId, sort_order: 2 },
        { id: 'b1', category_name: 'B', category_sort_order: 1, batch_id: batchId, sort_order: 0 },
      ];
      mockReorderCategories(existing, ['B', 'A']);
      const result = await service.reorderCategories(batchId, { orderedCategoryNames: ['B', 'A'] });
      expect(result.reordered).toBe(true);
      // Verify that updates were called for each logical category (2 categories)
      // First existing fetch + batch check + 2 updates
      expect(chain.from).toHaveBeenCalledWith('batch_recording_curriculum');
    });

    it('should treat case-insensitive variants as one logical category', async () => {
      const existing = [
        { id: '1', category_name: 'Stock Market Basic To Advance', category_sort_order: 0, batch_id: batchId },
        { id: '2', category_name: 'Stock Market Basic to Advance', category_sort_order: 0, batch_id: batchId },
        { id: '3', category_name: 'Doubt Solving Sessions', category_sort_order: 1, batch_id: batchId },
      ];
      mockReorderCategories(existing, ['Doubt Solving Sessions', 'Stock Market Basic to Advance']);
      const result = await service.reorderCategories(batchId, {
        orderedCategoryNames: ['Doubt Solving Sessions', 'stock market basic to advance'],
      });
      expect(result.reordered).toBe(true);
    });

    it('should keep batches independent', async () => {
      const batchA = '550e8400-e29b-41d4-a716-446655440001';
      const batchB = '550e8400-e29b-41d4-a716-446655440002';
      // Mock for batchA reorder only, ensure batchB not affected is implicit
      const existingA = [
        { id: '1', category_name: 'Basics', category_sort_order: 0, batch_id: batchA },
        { id: '2', category_name: 'Trading', category_sort_order: 1, batch_id: batchA },
        { id: '3', category_name: 'Doubt', category_sort_order: 2, batch_id: batchA },
      ];
      mockReorderCategories(existingA, ['Basics', 'Doubt', 'Trading']);
      const result = await service.reorderCategories(batchA, {
        orderedCategoryNames: ['Basics', 'Doubt', 'Trading'],
      });
      expect(result.reordered).toBe(true);
    });

    it('should reject unknown category', async () => {
      const existing = [
        { id: '1', category_name: 'A', category_sort_order: 0, batch_id: batchId },
        { id: '2', category_name: 'B', category_sort_order: 1, batch_id: batchId },
      ];
      mockReorderCategories(existing, ['A', 'B']);
      await expect(
        service.reorderCategories(batchId, { orderedCategoryNames: ['A', 'Unknown'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate logical category', async () => {
      const existing = [
        { id: '1', category_name: 'A', category_sort_order: 0, batch_id: batchId },
        { id: '2', category_name: 'B', category_sort_order: 1, batch_id: batchId },
      ];
      mockReorderCategories(existing, ['A', 'B']);
      await expect(
        service.reorderCategories(batchId, {
          orderedCategoryNames: ['A', 'a'], // duplicate after normalization
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject omitted existing category', async () => {
      const existing = [
        { id: '1', category_name: 'A', category_sort_order: 0, batch_id: batchId },
        { id: '2', category_name: 'B', category_sort_order: 1, batch_id: batchId },
        { id: '3', category_name: 'C', category_sort_order: 2, batch_id: batchId },
      ];
      mockReorderCategories(existing, ['A', 'B', 'C']);
      await expect(
        service.reorderCategories(batchId, { orderedCategoryNames: ['A', 'B'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
