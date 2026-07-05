import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { MuxService } from '../mux/mux.service';
import { PlaybackGuardService } from '../playback/playback-guard.service';
import { ObservabilityService } from '../observability/observability.service';
import { RedisService } from '@liaoliaots/nestjs-redis';

function mockResolvedQuery(result: any) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  };
}

function mockChain(fromResult?: any) {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnValue(fromResult),
  };

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.range.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.single.mockResolvedValue({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });

  return chain;
}

describe('RecordingsService', () => {
  let service: RecordingsService;
  let supabase: any;
  let muxService: any;
  let playbackGuard: any;
  let chain: any;

  function setupQuery(results: any[]) {
    let callIndex = 0;
    chain.from.mockImplementation(() => {
      const result = results[callIndex];
      callIndex++;

      const q = mockChain();
      if (result && typeof result === 'object') {
        if (result.data !== undefined) {
          q.single.mockResolvedValue(result);
          q.maybeSingle.mockResolvedValue(result);
          q.eq.mockReturnThis();
          q.in.mockReturnValue({
            in: jest.fn().mockResolvedValue(result),
          });
          q.eq.mockImplementation(() => ({
            in: jest.fn().mockResolvedValue(result),
          }));
        }
      }
      return q;
    });
  }

  beforeEach(async () => {
    chain = mockChain(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingsService,
        {
          provide: SupabaseService,
          useValue: {
            client: chain,
            authClient: chain,
          },
        },
        {
          provide: MuxService,
          useValue: {
            createUploadUrl: jest.fn(),
            deleteAsset: jest.fn().mockResolvedValue(undefined),
            getSignedPlaybackUrl: jest.fn(),
            getSignedThumbnailUrl: jest.fn(),
          },
        },
        {
          provide: PlaybackGuardService,
          useValue: {
            authorize: jest.fn().mockResolvedValue({
              playbackToken: 'mock-token',
              sessionId: 'mock-session',
              expiresInSeconds: 14400,
            }),
          },
        },
        {
          provide: ObservabilityService,
          useValue: {
            logEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({
              get: jest.fn(),
              setex: jest.fn(),
              del: jest.fn(),
              scan: jest.fn().mockResolvedValue(['0', []]),
              expire: jest.fn(),
              incr: jest.fn(),
            }),
          },
        },
        RedisCacheService,
      ],
    }).compile();

    service = module.get<RecordingsService>(RecordingsService);
    supabase = module.get(SupabaseService);
    muxService = module.get(MuxService);
    playbackGuard = module.get(PlaybackGuardService);
    jest.clearAllMocks();
  });

  describe('authorizePlayback - student assigned to batch', () => {
    it('should authorize when student is in a batch linked to the recording', async () => {
      const recordingId = 'rec-1';
      const userId = 'user-1';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const q = mockChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          q.single.mockResolvedValue({
            data: { id: recordingId, status: 'ready' },
            error: null,
          });
        } else if (idx === 1) {
          q.eq.mockResolvedValue({
            data: [{ batch_id: 'batch-1' }],
            error: null,
          });
        } else if (idx === 2) {
          q.eq.mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ batch_id: 'batch-1' }],
              error: null,
            }),
          });
        }
        return q;
      });

      const result = await service.authorizePlayback(recordingId, userId);

      expect(result).toBeDefined();
      expect(result.playbackToken).toBe('mock-token');
    });
  });

  describe('authorizePlayback - student not assigned', () => {
    it('should throw ForbiddenException when student is not assigned to any batch', async () => {
      const recordingId = 'rec-1';
      const userId = 'user-1';

      let callIndex = 0;
      chain.from.mockImplementation((table: string) => {
        const q = mockChain(null);
        if (callIndex === 0) {
          q.single.mockResolvedValueOnce({
            data: { id: recordingId, status: 'ready' },
            error: null,
          });
        } else if (callIndex === 1) {
          // batch_students: empty
          q.eq.mockImplementation(() => ({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }));
        }
        callIndex++;
        return q;
      });

      await expect(
        service.authorizePlayback(recordingId, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when recording is not linked to student batches', async () => {
      const recordingId = 'rec-1';
      const userId = 'user-1';

      let callIndex = 0;
      chain.from.mockImplementation((table: string) => {
        const q = mockChain(null);
        if (callIndex === 0) {
          q.single.mockResolvedValueOnce({
            data: { id: recordingId, status: 'ready' },
            error: null,
          });
        } else if (callIndex === 1) {
          // batch_students: has membership in 'other-batch'
          q.eq.mockImplementation(() => ({
            in: jest.fn().mockResolvedValue({
              data: [{ batch_id: 'other-batch' }],
              error: null,
            }),
          }));
        } else if (callIndex === 2) {
          // recording_batches: no match → empty
          q.eq.mockImplementation(() => ({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }));
        }
        callIndex++;
        return q;
      });

      await expect(
        service.authorizePlayback(recordingId, userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('authorizePlayback - recording not ready', () => {
    it('should throw BadRequestException when recording status is processing', async () => {
      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        q.single.mockResolvedValueOnce({
          data: { id: 'rec-1', status: 'processing' },
          error: null,
        });
        return q;
      });

      await expect(
        service.authorizePlayback('rec-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when recording status is failed', async () => {
      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        q.single.mockResolvedValueOnce({
          data: { id: 'rec-1', status: 'failed' },
          error: null,
        });
        return q;
      });

      await expect(
        service.authorizePlayback('rec-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('authorizePlayback - recording not found', () => {
    it('should throw NotFoundException when recording does not exist', async () => {
      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        q.single.mockResolvedValueOnce({
          data: null,
          error: { message: 'Not found', code: 'PGRST116' },
        });
        return q;
      });

      await expect(
        service.authorizePlayback('rec-nonexistent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignToBatches - syncs curriculum', () => {
    it('should create recording_batches and curriculum entries', async () => {
      const upsertMock = jest.fn().mockResolvedValue({ data: null, error: null });
      upsertMock.mockResolvedValueOnce({ data: null, error: null });
      upsertMock.mockResolvedValueOnce({ data: null, error: null });

      chain.from.mockReturnValue({
        upsert: upsertMock,
      });

      const result = await service.assignToBatches(
        '550e8400-e29b-41d4-a716-446655440000',
        ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'],
      );

      expect(result.assignedCount).toBe(2);
      expect(upsertMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('assignToBatches - curriculum payload validation', () => {
    it('should throw BadRequestException when recording ID is not a valid UUID', async () => {
      await expect(
        service.assignToBatches('not-a-uuid', ['550e8400-e29b-41d4-a716-446655440001']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when batch ID is not a valid UUID', async () => {
      await expect(
        service.assignToBatches('550e8400-e29b-41d4-a716-446655440000', ['not-a-uuid']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when batchIds is empty', async () => {
      await expect(
        service.assignToBatches('550e8400-e29b-41d4-a716-446655440000', []),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assignToBatches - curriculum database error', () => {
    it('should throw BadRequestException when curriculum upsert returns FK violation', async () => {
      const upsertMock = jest.fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: {
            message: 'insert or update on table "batch_recording_curriculum" violates foreign key constraint "batch_recording_curriculum_batch_id_fkey"',
            code: '23503',
            details: 'Key (batch_id)=(550e8400-e29b-41d4-a716-446655449999) is not present in table "batches".',
            hint: null,
          },
          status: 409,
          count: null,
        });

      chain.from.mockReturnValue({ upsert: upsertMock });

      await expect(
        service.assignToBatches(
          '550e8400-e29b-41d4-a716-446655440000',
          ['550e8400-e29b-41d4-a716-446655440001'],
        ),
      ).rejects.toThrow(BadRequestException);

      expect(upsertMock).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequestException when curriculum upsert returns generic error', async () => {
      const upsertMock = jest.fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'Database connection error', code: 'PGRST301', details: '', hint: null },
          status: 500,
          count: null,
        });

      chain.from.mockReturnValue({ upsert: upsertMock });

      await expect(
        service.assignToBatches(
          '550e8400-e29b-41d4-a716-446655440000',
          ['550e8400-e29b-41d4-a716-446655440001'],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeBatchAccess - syncs curriculum', () => {
    it('should delete from recording_batches and curriculum', async () => {
      const deleteMock = jest.fn().mockResolvedValue({ data: null, error: null });
      chain.from.mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.removeBatchAccess(
        '550e8400-e29b-41d4-a716-446655440000',
        ['550e8400-e29b-41d4-a716-446655440001'],
      );

      expect(result.removedCount).toBe(1);
    });
  });

  describe('removeBatchAccess - curriculum database error', () => {
    it('should throw BadRequestException when curriculum delete fails', async () => {
      chain.from.mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'Delete failed', code: 'PGRST301', details: '', hint: null },
          status: 500,
          count: null,
        }),
      });

      await expect(
        service.removeBatchAccess(
          '550e8400-e29b-41d4-a716-446655440000',
          ['550e8400-e29b-41d4-a716-446655440001'],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateBatchCurriculum - transaction rollback', () => {
    it('should rollback add-batch-links when curriculum upsert fails', async () => {
      const upsertMock = jest.fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'Unique constraint violation', code: '23505', details: 'Key (...) already exists.', hint: null },
          status: 409,
          count: null,
        });
      const deleteMock = jest.fn().mockReturnThis();
      const eqMock = jest.fn().mockReturnThis();
      const inMock = jest.fn().mockResolvedValue({ data: null, error: null });

      chain.from.mockReturnValue({
        upsert: upsertMock,
        delete: deleteMock,
        eq: eqMock,
        in: inMock,
      });

      await expect(
        service.updateBatchCurriculum('550e8400-e29b-41d4-a716-446655440000', {
          assignments: [{ batchId: '550e8400-e29b-41d4-a716-446655440001' }],
        }),
      ).rejects.toThrow(BadRequestException);

      // Step 1 upsert succeeded, step 2 upsert failed
      expect(upsertMock).toHaveBeenCalledTimes(2);
      // Rollback called delete().eq().in() to undo step 1
      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(eqMock).toHaveBeenCalledTimes(1);
      expect(inMock).toHaveBeenCalledTimes(1);
    });

    it('should rollback remove-curriculum-entries when batch links delete fails', async () => {
      const inMock = jest.fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'Delete error', code: 'PGRST301', details: '', hint: null },
          status: 500,
          count: null,
        });
      const upsertMock = jest.fn().mockResolvedValue({ data: null, error: null });

      chain.from.mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: inMock,
        upsert: upsertMock,
      });

      await expect(
        service.updateBatchCurriculum('550e8400-e29b-41d4-a716-446655440000', {
          assignments: [{ batchId: '550e8400-e29b-41d4-a716-446655440001', assigned: false }],
        }),
      ).rejects.toThrow(BadRequestException);

      // Step 1 in() succeeded (curriculum delete), step 2 in() failed (batch links delete)
      expect(inMock).toHaveBeenCalledTimes(2);
      // Rollback re-inserted curriculum entries
      expect(upsertMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateBatchCurriculum - edge cases', () => {
    it('should throw when remove path curriculum delete fails (no steps to rollback)', async () => {
      chain.from.mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'Delete error', code: 'PGRST301', details: '', hint: null },
          status: 500,
          count: null,
        }),
      });

      await expect(
        service.updateBatchCurriculum('550e8400-e29b-41d4-a716-446655440000', {
          assignments: [{ batchId: '550e8400-e29b-41d4-a716-446655440001', assigned: false }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle duplicate batch assignment without error', async () => {
      const upsertMock = jest.fn().mockResolvedValue({ data: null, error: null });
      chain.from.mockReturnValue({ upsert: upsertMock });

      const result1 = await service.updateBatchCurriculum(
        '550e8400-e29b-41d4-a716-446655440000',
        { assignments: [{ batchId: '550e8400-e29b-41d4-a716-446655440001' }] },
      );
      expect(result1.updated).toBe(true);

      const result2 = await service.updateBatchCurriculum(
        '550e8400-e29b-41d4-a716-446655440000',
        { assignments: [{ batchId: '550e8400-e29b-41d4-a716-446655440001' }] },
      );
      expect(result2.updated).toBe(true);
    });
  });

  describe('deleteRecording - syncs curriculum', () => {
    const REC = '550e8400-e29b-41d4-a716-446655440000';

    function setupRecordingMuxMock(callCount: number): { recordingId: string; muxAssetId: string } {
      const recordingId = REC;
      const muxAssetId = 'mux-1';
      let callIndex = 0;

      chain.from.mockImplementation(() => {
        const q = mockChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          q.single.mockResolvedValue({
            data: { id: recordingId, mux_asset_id: muxAssetId, title: 'Test' },
            error: null,
          });
        } else if (idx === 1) {
          // Transaction step 1: delete curriculum (delete + eq + eq)
          q.delete.mockReturnValue(q);
          q.eq
            .mockImplementationOnce(() => q)
            .mockResolvedValueOnce({ data: null, error: null });
        } else if (idx === 2) {
          // Transaction step 2: delete batch links (delete + eq)
          q.delete.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        } else if (idx === 3) {
          // Transaction step 3: update cleanup_pending (update + eq)
          q.update.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        } else {
          // Outside transaction: delete recording (delete + eq)
          q.delete.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        }
        return q;
      });

      return { recordingId, muxAssetId };
    }

    it('should delete curriculum + batch links, clean Mux, then delete recording', async () => {
      const { recordingId } = setupRecordingMuxMock(5);

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(result.cleanupPending).toBeUndefined();
      expect(muxService.deleteAsset).toHaveBeenCalledWith('mux-1');
    });

    it('should return cleanupPending=true when Mux deletion fails', async () => {
      const { recordingId } = setupRecordingMuxMock(4);
      jest.spyOn(muxService, 'deleteAsset').mockRejectedValue(new Error('Mux API timeout'));

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(result.cleanupPending).toBe(true);
      expect(muxService.deleteAsset).toHaveBeenCalledWith('mux-1');
    });

    it('should skip Mux deletion when recording has no mux_asset_id', async () => {
      const recordingId = REC;
      let callIndex = 0;

      chain.from.mockImplementation(() => {
        const q = mockChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          q.single.mockResolvedValue({
            data: { id: recordingId, mux_asset_id: null, title: 'Test no Mux' },
            error: null,
          });
        } else if (idx === 1) {
          q.delete.mockReturnValue(q);
          q.eq
            .mockImplementationOnce(() => q)
            .mockResolvedValueOnce({ data: null, error: null });
        } else if (idx === 2) {
          q.delete.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        } else if (idx === 3) {
          q.update.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        } else {
          q.delete.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        }
        return q;
      });

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(muxService.deleteAsset).not.toHaveBeenCalled();
    });
  });

  // ── requestUploadUrl ──────────────────────────────────────

  describe('requestUploadUrl - creates recording (title-only)', () => {
    const validRecId = '550e8400-e29b-41d4-a716-446655449990';

    it('should create a recording with just a title (no batch assignment)', async () => {
      const mockRecording = { id: validRecId, title: 'Test Upload', status: 'processing', created_at: '2026-01-01T00:00:00Z' };

      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        q.single.mockResolvedValue({ data: mockRecording, error: null });
        return q;
      });

      muxService.createDirectUploadUrl = jest.fn().mockResolvedValue({
        uploadUrl: 'https://example.com/upload',
        uploadId: 'upload-1',
      });

      const result = await service.requestUploadUrl({
        title: 'Test Upload',
      });

      expect(result.uploadUrl).toBe('https://example.com/upload');
      expect(result.recording).toEqual(mockRecording);
    });
  });

  // ── fetchRecordingsForStudent ─────────────────────────────

  describe('fetchRecordingsForStudent - respects recording_batches', () => {
    it('should return recordings linked via recording_batches', async () => {
      const studentId = 'student-1';
      const batchId = '550e8400-e29b-41d4-a716-446655440001';
      const recordingId = '550e8400-e29b-41d4-a716-446655449991';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        const idx = callIndex++;

        if (idx === 0) {
          q.eq.mockResolvedValue({ data: [{ batch_id: batchId }], error: null });
        } else if (idx === 1) {
          q.in.mockResolvedValue({ data: [{ recording_id: recordingId }], error: null });
        } else if (idx === 2) {
          const eqMock = jest.fn().mockReturnThis();
          const orderMock = jest.fn().mockResolvedValue({
            data: [{
              id: recordingId, title: 'Test Recording', description: null,
              topic_id: null, sort_order: 0, status: 'ready',
              created_at: '2026-01-01T00:00:00Z', topics: null,
            }],
            error: null,
          });
          q.in.mockReturnValue({ eq: eqMock });
          eqMock.mockReturnValue({ order: orderMock });
        } else if (idx === 3) {
          q.in.mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) });
        } else {
          q.in.mockResolvedValue({ data: [], error: null });
        }
        return q;
      });

      const result = await (service as any).fetchRecordingsForStudent(studentId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(recordingId);
      expect(result[0].status).toBe('ready');
    });

    it('should return empty when no recording_batches entries exist', async () => {
      const studentId = 'student-orphaned';
      const batchId = '550e8400-e29b-41d4-a716-446655440002';

      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        const idx = callIndex++;

        if (idx === 0) {
          q.eq.mockResolvedValue({ data: [{ batch_id: batchId }], error: null });
        } else if (idx === 1) {
          q.in.mockResolvedValue({ data: [], error: null });
        } else {
          q.in.mockResolvedValue({ data: [], error: null });
        }
        return q;
      });

      const result = await (service as any).fetchRecordingsForStudent(studentId);

      expect(result).toHaveLength(0);
    });
  });
});
