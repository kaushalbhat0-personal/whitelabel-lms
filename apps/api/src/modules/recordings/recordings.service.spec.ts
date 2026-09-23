import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';
import { PlaybackGuardService } from '../playback/playback-guard.service';
import { RecordingProviderResolver } from '../video-provider/recording-provider.resolver';
import { ObservabilityService } from '../observability/observability.service';
import { RedisService } from '@liaoliaots/nestjs-redis';

/** Fake VideoProvider standing in for whatever the resolver returns. */
const fakeProvider = {
  name: 'mux',
  createDirectUpload: jest.fn(),
  createAssetFromSource: jest.fn(),
  getAssetStatus: jest.fn(),
  getPlaybackUrls: jest.fn(),
  deleteAsset: jest.fn().mockResolvedValue(undefined),
};

const resolverMock = {
  resolveUploadProvider: jest.fn().mockReturnValue('mux'),
  resolve: jest.fn().mockReturnValue(fakeProvider),
  providerFor: jest.fn().mockReturnValue(fakeProvider),
};

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
          provide: RecordingProviderResolver,
          useValue: resolverMock,
        },
        {
          provide: PlaybackGuardService,
          useValue: {
            authorize: jest.fn().mockResolvedValue({
              playbackToken: 'mock-token',
              sessionId: 'mock-session',
              expiresInSeconds: 14400,
            }),
            getSignedUrl: jest.fn(),
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
    playbackGuard = module.get(PlaybackGuardService);
    jest.clearAllMocks();
    fakeProvider.deleteAsset.mockResolvedValue(undefined);
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
          // Affected batches lookup for targeted cache invalidation
          q.select.mockReturnValue(q);
          q.eq.mockReturnValue(q);
          // The chain is thenable; return empty links
          (q as any).then = (fn: any) => Promise.resolve({ data: [], error: null }).then(fn);
          return q;
        } else if (idx === 2) {
          // Transaction step 1: delete curriculum (delete + eq + eq)
          q.delete.mockReturnValue(q);
          q.eq
            .mockImplementationOnce(() => q)
            .mockResolvedValueOnce({ data: null, error: null });
        } else if (idx === 3) {
          // Transaction step 2: delete batch links (delete + eq)
          q.delete.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        } else if (idx === 4) {
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

    it('should delete curriculum + batch links, clean provider asset, then delete recording', async () => {
      const { recordingId } = setupRecordingMuxMock(5);

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(result.cleanupPending).toBeUndefined();
      expect(fakeProvider.deleteAsset).toHaveBeenCalledWith('mux-1');
      expect(resolverMock.providerFor).toHaveBeenCalledWith(
        expect.objectContaining({ mux_asset_id: 'mux-1' }),
      );
    });

    it('should return cleanupPending=true when provider deletion fails', async () => {
      const { recordingId } = setupRecordingMuxMock(4);
      fakeProvider.deleteAsset.mockRejectedValueOnce(new Error('Mux API timeout'));

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(result.cleanupPending).toBe(true);
      expect(fakeProvider.deleteAsset).toHaveBeenCalledWith('mux-1');
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
          // affected batches lookup
          q.select.mockReturnValue(q);
          q.eq.mockReturnValue(q);
          (q as any).then = (fn: any) => Promise.resolve({ data: [], error: null }).then(fn);
          return q;
        } else if (idx === 2) {
          q.delete.mockReturnValue(q);
          q.eq
            .mockImplementationOnce(() => q)
            .mockResolvedValueOnce({ data: null, error: null });
        } else if (idx === 3) {
          q.delete.mockReturnValue(q);
          q.eq.mockResolvedValue({ data: null, error: null });
        } else if (idx === 4) {
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
      expect(fakeProvider.deleteAsset).not.toHaveBeenCalled();
    });

    it('should hard-delete DB row even when provider reports 404', async () => {
      const { recordingId } = setupRecordingMuxMock(5);
      fakeProvider.deleteAsset.mockRejectedValueOnce({ status: 404, message: 'Not found' } as any);

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(result.cleanupPending).toBeUndefined();
    });

    it('should hard-delete DB row when provider not configured (ServiceUnavailable)', async () => {
      const { recordingId } = setupRecordingMuxMock(5);
      const err: any = new Error('Bunny video provider is not enabled/configured');
      err.name = 'ServiceUnavailableException';
      fakeProvider.deleteAsset.mockRejectedValueOnce(err);

      const result = await service.deleteRecording(recordingId);

      expect(result.deleted).toBe(true);
      expect(result.cleanupPending).toBeUndefined();
    });
  });

  describe('bulkDeleteRecordings', () => {
    const A = '550e8400-e29b-41d4-a716-44665544000a';
    const B = '550e8400-e29b-41d4-a716-44665544000b';
    const C = '550e8400-e29b-41d4-a716-44665544000c';

    it('should deduplicate duplicate IDs and process once', async () => {
      // Mock initial load: recordings + links + students + per-id deletes
      // For brevity, mock bulkDelete to use spied deleteRecording
      const ids = [A, B, B, C];
      // Mock load recordings
      chain.from.mockImplementation((table: string) => {
        const q = mockChain();
        if (table === 'recordings') {
          q.in.mockResolvedValue({ data: [{ id: A, mux_asset_id: 'a1', provider: 'mux', title: 'A' }, { id: B, mux_asset_id: 'b1', provider: 'mux', title: 'B' }, { id: C, mux_asset_id: null, provider: 'mux', title: 'C' }], error: null });
        } else if (table === 'recording_batches') {
          q.in.mockResolvedValue({ data: [{ batch_id: 'b1' }], error: null });
        } else if (table === 'batch_students') {
          q.in.mockResolvedValue({ data: [{ user_id: 'u1' }], error: null });
        }
        return q;
      });
      const spy = jest.spyOn(service as any, 'deleteRecording').mockResolvedValue({ deleted: true });

      const result = await (service as any).bulkDeleteRecordings(ids);
      expect(spy).toHaveBeenCalledTimes(3); // deduplicated
      expect(result.total).toBe(3);
      expect(result.deleted).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      spy.mockRestore();
    });

    it('should collect per-record failures without aborting batch', async () => {
      chain.from.mockImplementation((table: string) => {
        const q = mockChain();
        if (table === 'recordings') {
          q.in.mockResolvedValue({ data: [{ id: A, mux_asset_id: 'a1', provider: 'mux', title: 'A' }], error: null });
        } else if (table === 'recording_batches') {
          q.in.mockResolvedValue({ data: [], error: null });
        } else if (table === 'batch_students') {
          q.in.mockResolvedValue({ data: [], error: null });
        }
        return q;
      });
      // A will succeed, missing B will be reported
      const spy = jest.spyOn(service as any, 'deleteRecording').mockResolvedValue({ deleted: true, cleanupPending: true });

      const result = await (service as any).bulkDeleteRecordings([A, B]);
      expect(result.deleted).toHaveLength(0);
      expect(result.failed).toEqual(expect.arrayContaining([expect.objectContaining({ id: A }), expect.objectContaining({ id: B })]));
      spy.mockRestore();
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

      resolverMock.resolveUploadProvider.mockReturnValueOnce('mux');
      fakeProvider.createDirectUpload.mockResolvedValueOnce({
        uploadUrl: 'https://example.com/upload',
        uploadId: 'upload-1',
      });

      const result = await service.requestUploadUrl({
        title: 'Test Upload',
      });

      expect(result.uploadUrl).toBe('https://example.com/upload');
      expect(result.recording).toEqual(mockRecording);
      // Phase 7E: the FULL direct-upload handle must reach the browser so a
      // Bunny 'tus' response carries its presigned headers end-to-end.
      expect(result.upload).toEqual({
        url: 'https://example.com/upload',
        kind: 'plain-put',
        headers: {},
        recordingId: validRecId,
      });
      // Draft flow has no batch context — must resolve through the centralized
      // resolver with an empty batch set (audit A-3).
      expect(resolverMock.resolveUploadProvider).toHaveBeenCalledWith([]);
      expect(fakeProvider.createDirectUpload).toHaveBeenCalledWith({ title: 'Test Upload' });
    });

    it('Phase 7E: passes through a bunny TUS handle (kind + presigned headers) untouched', async () => {
      const mockRecording = { id: validRecId, title: 'TUS Upload', status: 'processing', created_at: '2026-01-01T00:00:00Z' };
      chain.from.mockImplementation(() => {
        const q = mockChain(null);
        q.single.mockResolvedValue({ data: mockRecording, error: null });
        return q;
      });

      resolverMock.resolveUploadProvider.mockReturnValueOnce('bunny');
      fakeProvider.createDirectUpload.mockResolvedValueOnce({
        uploadUrl: 'https://video.bunnycdn.com/tusupload',
        uploadId: 'guid-123',
        uploadKind: 'tus',
        uploadHeaders: {
          AuthorizationSignature: 'sig',
          AuthorizationExpire: '123',
          LibraryId: '133',
          VideoId: 'guid-123',
        },
      } as any);

      const result = await service.requestUploadUrl({ title: 'TUS Upload' });

      expect(result.upload.kind).toBe('tus');
      expect(result.upload.headers.VideoId).toBe('guid-123');
      expect(result.upload.url).toBe('https://video.bunnycdn.com/tusupload');
    });
  });

  // ── provider routing (Phase 7B) ───────────────────────────

  describe('provider routing', () => {
    it('createRecordingWithUpload resolves the upload provider from dto.batchIds via the resolver', async () => {
      const batchIds = ['550e8400-e29b-41d4-a716-446655440001'];
      fakeProvider.createDirectUpload.mockRejectedValueOnce(new Error('provider down'));

      await expect(
        service.createRecordingWithUpload({ title: 'X', batchIds } as any),
      ).rejects.toThrow('provider down');

      expect(resolverMock.resolveUploadProvider).toHaveBeenCalledWith(batchIds);
      expect(resolverMock.resolve).toHaveBeenCalledWith('mux');
      expect(fakeProvider.createDirectUpload).toHaveBeenCalledWith({ title: 'X' });
    });

    it('getPlaybackUrl passes provider + playback id to PlaybackGuard', async () => {
      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 0) {
          const q: any = mockChain(null);
          q.single.mockResolvedValueOnce({ data: { id: 'rec-1', status: 'ready' }, error: null });
          return q;
        } else if (idx === 1) {
          const q: any = mockChain(null);
          q.eq.mockResolvedValue({ data: [{ batch_id: 'batch-1' }], error: null });
          return q;
        } else if (idx === 2) {
          const q: any = mockChain(null);
          q.eq.mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: [{ batch_id: 'batch-1' }], error: null }),
          });
          return q;
        } else if (idx === 3) {
          // Phase 9 publish gate: must have is_published=true curriculum for this batch
          const chainObj: any = {};
          chainObj.select = jest.fn().mockReturnValue(chainObj);
          chainObj.eq = jest.fn().mockReturnValue(chainObj);
          chainObj.in = jest.fn().mockResolvedValue({ data: [{ batch_id: 'batch-1' }], error: null });
          return chainObj;
        } else if (idx === 4) {
          const q: any = mockChain(null);
          q.single.mockResolvedValueOnce({
            data: { provider: 'mux', mux_playback_id: 'pb-1' },
            error: null,
          });
          return q;
        }
        const q: any = mockChain(null);
        return q;
      });

      (playbackGuard.getSignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'u', thumbnail: 't', sessionId: 's', expiresAt: 'e',
      });

      await service.getPlaybackUrl('rec-1', 'user-1', 'tok');

      expect(playbackGuard.getSignedUrl).toHaveBeenCalledWith(
        'tok',
        { playbackId: 'pb-1', provider: 'mux' },
        'user-1',
        'rec-1',
        undefined,
        undefined,
      );
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
        const idx = callIndex++;
        if (idx === 0) {
          const q: any = mockChain(null);
          q.eq.mockResolvedValue({ data: [{ batch_id: batchId }], error: null });
          return q;
        } else if (idx === 1) {
          const q: any = mockChain(null);
          q.in.mockResolvedValue({ data: [{ recording_id: recordingId }], error: null });
          return q;
        } else if (idx === 2) {
          // Phase 9 publish gate: select('content_id').eq('content_type').in('batch_id').eq('is_published').in('content_id')
          const chainObj: any = {};
          chainObj.select = jest.fn().mockReturnValue(chainObj);
          chainObj.eq = jest.fn().mockReturnValue(chainObj);
          let inCalls = 0;
          chainObj.in = jest.fn().mockImplementation(() => {
            inCalls++;
            if (inCalls === 1) return chainObj;
            return Promise.resolve({ data: [{ content_id: recordingId }], error: null });
          });
          return chainObj;
        } else if (idx === 3) {
          const chainObj: any = {};
          chainObj.select = jest.fn().mockReturnValue(chainObj);
          chainObj.in = jest.fn().mockReturnValue(chainObj);
          chainObj.eq = jest.fn().mockReturnValue(chainObj);
          chainObj.order = jest.fn().mockResolvedValue({
            data: [{
              id: recordingId, title: 'Test Recording', description: null,
              topic_id: null, sort_order: 0, status: 'ready',
              created_at: '2026-01-01T00:00:00Z', topics: null,
            }],
            error: null,
          });
          return chainObj;
        } else if (idx === 4) {
          const q: any = mockChain(null);
          q.in.mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) });
          return q;
        }
        const q: any = mockChain(null);
        q.in.mockResolvedValue({ data: [], error: null });
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

  describe('fetchMyRecordingsGrouped - curriculum ordering (Phase A)', () => {
    const batchId = '550e8400-e29b-41d4-a716-446655440001';
    const recA = '550e8400-e29b-41d4-a716-4466554400a1';
    const recB = '550e8400-e29b-41d4-a716-4466554400b2';
    const recC = '550e8400-e29b-41d4-a716-4466554400c3';

    function mockGroupedCalls(curriculumRows: any[], recordingsRows: any[]) {
      let idx = 0;
      chain.from.mockImplementation((table: string) => {
        const call = idx++;
        // Use a fresh mock chain per call
        const q: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          single: jest.fn(),
          maybeSingle: jest.fn(),
        };
        // Helpers to make chain awaitable
        const makeAwaitable = (data: any) => {
          const p: any = Promise.resolve({ data, error: null });
          q.then = (fn: any) => p.then(fn);
          // also make order/in/eq resolve directly when awaited via order()
          q.order = jest.fn().mockReturnValue({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          });
          // For curriculum query which ends with .order(), we need order() to resolve
          // For recordings query which ends with .order(), same
          // But to keep simple, make the chain itself thenable
          q.then = (fn: any) => Promise.resolve({ data, error: null }).then(fn);
          return q;
        };

        if (call === 0) {
          // batch_students
          const data = [{ batch_id: batchId }];
          q.select.mockReturnThis();
          q.eq.mockImplementation(() => ({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          } as any));
          return q;
        }
        if (call === 1) {
          // batches
          const data = [{ id: batchId, name: '12 PM - 2 PM - B1' }];
          q.select.mockReturnThis();
          q.in.mockImplementation(() => ({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          } as any));
          return q;
        }
        if (call === 2) {
          // recording_batches
          const data = [
            { recording_id: recA, batch_id: batchId },
            { recording_id: recB, batch_id: batchId },
            { recording_id: recC, batch_id: batchId },
          ];
          q.select.mockReturnThis();
          q.in.mockImplementation(() => ({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          } as any));
          return q;
        }
        if (call === 3) {
          // recordings
          const data = recordingsRows;
          // chain: .select().in().eq().order() -> order resolves
          q.select.mockReturnThis();
          q.in.mockReturnThis();
          q.eq.mockReturnThis();
          q.order.mockImplementation(() => ({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          } as any));
          // also make the chain itself thenable for safety
          q.then = (fn: any) => Promise.resolve({ data, error: null }).then(fn);
          return q;
        }
        if (call === 4) {
          // curriculum
          const data = curriculumRows;
          q.select.mockReturnThis();
          q.eq.mockReturnThis();
          q.in.mockReturnThis();
          q.order.mockImplementation(() => ({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          } as any));
          q.then = (fn: any) => Promise.resolve({ data, error: null }).then(fn);
          return q;
        }
        if (call === 5) {
          // video_progress
          const data: any[] = [];
          q.select.mockReturnThis();
          q.in.mockReturnThis();
          q.eq.mockImplementation(() => ({
            then: (fn: any) => Promise.resolve({ data, error: null }).then(fn),
          } as any));
          return q;
        }
        // fallback
        q.then = (fn: any) => Promise.resolve({ data: [], error: null }).then(fn);
        return q;
      });
    }

    it('should return recordings ordered by curriculum sort_order ASC', async () => {
      const curriculumRows = [
        { batch_id: batchId, content_id: recB, category_name: 'Stock Market Basic To Advance', sort_order: 0, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recA, category_name: 'Stock Market Basic To Advance', sort_order: 1, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recC, category_name: 'Stock Market Basic To Advance', sort_order: 2, is_published: true, title_override: null },
      ];
      const recordingsRows = [
        { id: recA, title: 'Introduction And Syllabus Discussion', description: null, mux_playback_id: 'pb-a', duration_seconds: 100, sort_order: 5, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
        { id: recB, title: 'Learning Tradingview', description: null, mux_playback_id: 'pb-b', duration_seconds: 100, sort_order: 2, status: 'ready', created_at: '2026-09-02T00:00:00Z' },
        { id: recC, title: 'Tradingview Tools and Trendline', description: null, mux_playback_id: 'pb-c', duration_seconds: 100, sort_order: 9, status: 'ready', created_at: '2026-09-03T00:00:00Z' },
      ];
      mockGroupedCalls(curriculumRows, recordingsRows);

      const result = await (service as any).fetchMyRecordingsGrouped('student-1');
      expect(result).toHaveLength(1);
      const section = result[0].sections[0];
      expect(section.recordings.map((r: any) => r.id)).toEqual([recB, recA, recC]);
      expect(section.recordings.map((r: any) => r.title)).toEqual(['Learning Tradingview', 'Introduction And Syllabus Discussion', 'Tradingview Tools and Trendline']);
    });

    it('should merge case/whitespace category variants while preserving sort_order', async () => {
      const curriculumRows = [
        { batch_id: batchId, content_id: recA, category_name: 'Stock Market Basic to Advance', sort_order: 0, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recB, category_name: 'Stock Market Basic To Advance', sort_order: 1, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recC, category_name: '  Stock Market Basic   To   Advance  ', sort_order: 2, is_published: true, title_override: null },
      ];
      const recordingsRows = [
        { id: recA, title: 'Introduction And Syllabus Discussion', description: null, mux_playback_id: 'pb-a', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
        { id: recB, title: 'Learning Tradingview', description: null, mux_playback_id: 'pb-b', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
        { id: recC, title: 'Tradingview Tools and Trendline', description: null, mux_playback_id: 'pb-c', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
      ];
      mockGroupedCalls(curriculumRows, recordingsRows);

      const result = await (service as any).fetchMyRecordingsGrouped('student-1');
      expect(result).toHaveLength(1);
      expect(result[0].sections).toHaveLength(1); // merged to one logical category
      const ids = result[0].sections[0].recordings.map((r: any) => r.id);
      expect(ids).toEqual([recA, recB, recC]); // sorted by sort_order, not by variant
    });

    it('should keep two logical categories separate and each ordered by sort_order', async () => {
      const recD = '550e8400-e29b-41d4-a716-4466554400d4';
      const curriculumRows = [
        { batch_id: batchId, content_id: recA, category_name: 'Stock Market Basic To Advance', sort_order: 0, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recB, category_name: 'Stock Market Basic To Advance', sort_order: 1, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recC, category_name: 'Advanced', sort_order: 0, is_published: true, title_override: null },
        { batch_id: batchId, content_id: recD, category_name: 'Advanced', sort_order: 1, is_published: true, title_override: null },
      ];
      const recordingsRows = [
        { id: recA, title: 'A', description: null, mux_playback_id: 'pb-a', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
        { id: recB, title: 'B', description: null, mux_playback_id: 'pb-b', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
        { id: recC, title: 'C', description: null, mux_playback_id: 'pb-c', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
        { id: recD, title: 'D', description: null, mux_playback_id: 'pb-d', duration_seconds: 100, sort_order: 0, status: 'ready', created_at: '2026-09-01T00:00:00Z' },
      ];
      // Need to extend mock to handle 4 recordings
      let idx = 0;
      chain.from.mockImplementation((table: string) => {
        const call = idx++;
        const q: any = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() };
        if (call === 0) {
          q.eq.mockImplementation(() => ({ then: (fn:any)=>Promise.resolve({data:[{batch_id:batchId}],error:null}).then(fn)} as any));
          return q;
        }
        if (call === 1) {
          q.in.mockImplementation(() => ({ then: (fn:any)=>Promise.resolve({data:[{id:batchId,name:'B1'}],error:null}).then(fn)} as any));
          return q;
        }
        if (call === 2) {
          const data = [{recording_id:recA,batch_id:batchId},{recording_id:recB,batch_id:batchId},{recording_id:recC,batch_id:batchId},{recording_id:recD,batch_id:batchId}];
          q.in.mockImplementation(() => ({ then: (fn:any)=>Promise.resolve({data,error:null}).then(fn)} as any));
          return q;
        }
        if (call === 3) {
          const data = recordingsRows;
          q.order.mockImplementation(() => ({ then: (fn:any)=>Promise.resolve({data,error:null}).then(fn)} as any));
          q.then = (fn:any)=>Promise.resolve({data,error:null}).then(fn);
          return q;
        }
        if (call === 4) {
          const data = curriculumRows;
          q.order.mockImplementation(() => ({ then: (fn:any)=>Promise.resolve({data,error:null}).then(fn)} as any));
          q.then = (fn:any)=>Promise.resolve({data,error:null}).then(fn);
          return q;
        }
        if (call === 5) {
          q.eq.mockImplementation(() => ({ then: (fn:any)=>Promise.resolve({data:[],error:null}).then(fn)} as any));
          return q;
        }
        q.then = (fn:any)=>Promise.resolve({data:[],error:null}).then(fn);
        return q;
      });

      const result = await (service as any).fetchMyRecordingsGrouped('student-1');
      expect(result[0].sections).toHaveLength(2);
      const byCat = new Map(result[0].sections.map((s:any)=>[s.sectionName, s.recordings.map((r:any)=>r.id)]));
      expect(byCat.get('Stock Market Basic To Advance')).toEqual([recA, recB]);
      expect(byCat.get('Advanced')).toEqual([recC, recD]);
    });
  });
});
