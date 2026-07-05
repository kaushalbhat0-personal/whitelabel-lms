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
          c.insert.mockReturnValue(c);
          c.select.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: 'curriculum-1', batch_id: batchId, content_id: recordingId, content_type: 'recording' },
            error: null,
          });
        } else if (callIndex === 1) {
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
          c.insert.mockReturnValue(c);
          c.select.mockReturnValue(c);
          c.single.mockResolvedValue({
            data: { id: curriculumId, batch_id: batchId, content_id: recordingId, content_type: 'recording' },
            error: null,
          });
        } else if (callIndex === 1) {
          c.upsert.mockResolvedValue({
            data: null,
            error: { message: 'FK violation', code: '23503' },
          });
        } else if (callIndex === 2) {
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

      chain.from.mockImplementation(() => {
        const c = buildChain();
        c.insert.mockReturnValue(c);
        c.select.mockReturnValue(c);
        c.single.mockResolvedValue({
          data: { id: 'curriculum-pdf', batch_id: batchId, content_id: null, content_type: 'pdf' },
          error: null,
        });
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
});
