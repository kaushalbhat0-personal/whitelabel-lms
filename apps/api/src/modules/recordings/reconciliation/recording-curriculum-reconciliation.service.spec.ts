import { Test, TestingModule } from '@nestjs/testing';
import { RecordingCurriculumReconciliationService } from './recording-curriculum-reconciliation.service';
import { SupabaseService } from '../../../common/services/supabase.service';

function mockChain() {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    from: jest.fn(),
  };

  // Make the chain thenable so `await from().select(...)` works without a terminal method
  chain.then = jest.fn().mockImplementation((resolve: Function) => {
    resolve({ data: null, error: null, status: 200, count: null });
  });

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.range.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);

  return chain;
}

describe('RecordingCurriculumReconciliationService', () => {
  let service: RecordingCurriculumReconciliationService;
  let chain: any;

  beforeEach(async () => {
    chain = mockChain();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingCurriculumReconciliationService,
        {
          provide: SupabaseService,
          useValue: { client: chain },
        },
      ],
    }).compile();

    service = module.get<RecordingCurriculumReconciliationService>(RecordingCurriculumReconciliationService);
    jest.clearAllMocks();
  });

  describe('run - dry run', () => {
    it('should return processed count without mutations', async () => {
      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const q = mockChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          // from(RECORDING_BATCHES).select(...) → no terminal method, override then()
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: [{ recording_id: 'rec-1', batch_id: 'batch-1' }], error: null, status: 200, count: 1 });
          });
        } else if (idx === 1) {
          // from(BATCH_RECORDING_CURRICULUM).select(...).eq().eq().eq().maybeSingle()
          q.maybeSingle.mockResolvedValue({ data: null, error: null });
        } else if (idx === 2) {
          // from(BATCH_RECORDING_CURRICULUM).select(...).eq(...) → no terminal, override then()
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: [{ id: 'curr-1', batch_id: 'batch-2', content_id: 'rec-2' }], error: null, status: 200, count: 1 });
          });
        } else if (idx === 3) {
          // from(RECORDING_BATCHES).select(...).eq().eq().maybeSingle()
          q.maybeSingle.mockResolvedValue({ data: null, error: null });
        }
        return q;
      });

      const result = await service.run(true);

      expect(result.dryRun).toBe(true);
      expect(result.processed).toBe(2);
      expect(result.inserted).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.skipped).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('run - live run with metrics', () => {
    it('should insert missing and delete orphans with correct metrics', async () => {
      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const q = mockChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          q.then.mockImplementation((resolve: Function) => {
            resolve({
              data: [
                { recording_id: 'rec-1', batch_id: 'batch-1' },
                { recording_id: 'rec-2', batch_id: 'batch-2' },
              ],
              error: null, status: 200, count: 2,
            });
          });
        } else if (idx === 1) {
          // rec-1 exists in curriculum
          q.maybeSingle.mockResolvedValue({ data: { id: 'curr-1' }, error: null });
        } else if (idx === 2) {
          // rec-2 missing from curriculum
          q.maybeSingle.mockResolvedValue({ data: null, error: null });
        } else if (idx === 3) {
          q.then.mockImplementation((resolve: Function) => {
            resolve({
              data: [
                { id: 'curr-2', batch_id: 'batch-3', content_id: 'rec-3' },
                { id: 'curr-3', batch_id: 'batch-4', content_id: 'rec-4' },
              ],
              error: null, status: 200, count: 2,
            });
          });
        } else if (idx === 4) {
          // rec-3 has batch link → not orphan
          q.maybeSingle.mockResolvedValue({ data: { recording_id: 'rec-3' }, error: null });
        } else if (idx === 5) {
          // rec-4 no batch link → orphan
          q.maybeSingle.mockResolvedValue({ data: null, error: null });
        } else if (idx === 6) {
          // fetch existing categories for category_sort_order
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: [], error: null, status: 200, count: 0 });
          });
        } else if (idx === 7) {
          // insertMissingEntries: insert rec-2
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: null, error: null, status: 201, count: 1 });
          });
        } else if (idx === 8) {
          // deleteOrphanEntries: delete curr-3
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: null, error: null, status: 200, count: 1 });
          });
        }
        return q;
      });

      const result = await service.run(false);

      expect(result.dryRun).toBe(false);
      expect(result.processed).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track failed counts on Supabase errors', async () => {
      let callIndex = 0;
      chain.from.mockImplementation(() => {
        const q = mockChain();
        const idx = callIndex;
        callIndex++;

        if (idx === 0) {
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: [{ recording_id: 'rec-1', batch_id: 'batch-1' }], error: null, status: 200, count: 1 });
          });
        } else if (idx === 1) {
          q.maybeSingle.mockResolvedValue({ data: null, error: null });
        } else if (idx === 2) {
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: [{ id: 'curr-1', batch_id: 'batch-2', content_id: 'rec-2' }], error: null, status: 200, count: 1 });
          });
        } else if (idx === 3) {
          q.maybeSingle.mockResolvedValue({ data: null, error: null });
        } else if (idx === 4) {
          // fetch existing categories for category_sort_order (new in Phase 1)
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: [], error: null, status: 200, count: 0 });
          });
        } else if (idx === 5) {
          // insert fails
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: null, error: { message: 'Insert failed', code: '23505' }, status: 409, count: null });
          });
        } else if (idx === 6) {
          // delete fails
          q.then.mockImplementation((resolve: Function) => {
            resolve({ data: null, error: { message: 'Delete failed', code: 'PGRST301' }, status: 500, count: null });
          });
        }
        return q;
      });

      const result = await service.run(false);

      expect(result.processed).toBe(2);
      expect(result.inserted).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should report the correct ReconciliationSummary shape', async () => {
      chain.from.mockImplementation(() => {
        const q = mockChain();
        q.then.mockImplementation((resolve: Function) => {
          resolve({ data: [], error: null, status: 200, count: 0 });
        });
        return q;
      });

      const result = await service.run(false);

      expect(result).toHaveProperty('dryRun');
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('inserted');
      expect(result).toHaveProperty('deleted');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('missingEntries');
      expect(result).toHaveProperty('orphanEntries');
    });
  });
});
