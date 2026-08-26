import { Test, TestingModule } from '@nestjs/testing';
import { RecordingCleanupJob } from './recording-cleanup.job';
import { SupabaseService } from '../common/services/supabase.service';
import { RecordingProviderResolver } from '../modules/video-provider/recording-provider.resolver';
import { ObservabilityService } from '../modules/observability/observability.service';

const terminalEq = jest.fn().mockResolvedValue({ data: null, error: null });

function mockChain() {
  const mutationChain = { eq: terminalEq };
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.single = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(mutationChain);
  chain.delete = jest.fn().mockReturnValue(mutationChain);
  return chain;
}

describe('RecordingCleanupJob', () => {
  let job: RecordingCleanupJob;
  let supabase: any;
  let providerDeleteAsset: jest.Mock;
  let resolver: any;
  let observabilityService: any;
  let chain: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    chain = mockChain();
    supabase = { client: { from: jest.fn().mockReturnValue(chain) } };
    providerDeleteAsset = jest.fn().mockResolvedValue(undefined);
    resolver = {
      providerFor: jest.fn().mockReturnValue({ deleteAsset: providerDeleteAsset }),
      resolveUploadProvider: jest.fn().mockReturnValue('mux'),
      resolve: jest.fn().mockReturnValue({ deleteAsset: providerDeleteAsset }),
    };
    observabilityService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingCleanupJob,
        { provide: SupabaseService, useValue: supabase },
        { provide: RecordingProviderResolver, useValue: resolver },
        { provide: ObservabilityService, useValue: observabilityService },
      ],
    }).compile();

    job = module.get<RecordingCleanupJob>(RecordingCleanupJob);
  });

  it('should return zeros when no recordings are pending cleanup', async () => {
    chain.limit.mockResolvedValue({ data: [], error: null });

    const summary = await job.processCleanupQueue();

    expect(summary.processed).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(providerDeleteAsset).not.toHaveBeenCalled();
  });

  it('should delete recording when Mux deletion succeeds', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-1', mux_asset_id: 'mux-1', provider: 'mux', title: 'Test', retry_count: 0 }],
      error: null,
    });
    providerDeleteAsset.mockResolvedValue(undefined);

    const summary = await job.processCleanupQueue();

    expect(summary.processed).toBe(1);
    expect(summary.deleted).toBe(1);
    expect(providerDeleteAsset).toHaveBeenCalledWith('mux-1');
    // Routing must go through the recording's owning provider
    expect(resolver.providerFor).toHaveBeenCalledWith(expect.objectContaining({ provider: 'mux' }));
    expect(observabilityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'RECORDING_CLEANUP_COMPLETED' }),
    );
  });

  it('should route bunny recordings to the bunny provider', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-b', mux_asset_id: 'bny-1', provider: 'bunny', title: 'Bunny rec', retry_count: 0 }],
      error: null,
    });
    providerDeleteAsset.mockResolvedValue(undefined);

    const summary = await job.processCleanupQueue();

    expect(summary.deleted).toBe(1);
    expect(providerDeleteAsset).toHaveBeenCalledWith('bny-1');
  });

  it('should delete recording when provider returns 404 (handled by provider)', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-2', mux_asset_id: 'mux-2', provider: 'mux', title: 'Test 2', retry_count: 0 }],
      error: null,
    });
    providerDeleteAsset.mockResolvedValue(undefined);

    const summary = await job.processCleanupQueue();

    expect(summary.deleted).toBe(1);
    expect(providerDeleteAsset).toHaveBeenCalledWith('mux-2');
    expect(observabilityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'RECORDING_CLEANUP_COMPLETED' }),
    );
  });

  it('should retry when provider deletion fails with 5xx', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-3', mux_asset_id: 'mux-3', provider: 'mux', title: 'Test 3', retry_count: 0 }],
      error: null,
    });
    const muxError = new Error('Mux API timeout');
    (muxError as any).status = 502;
    providerDeleteAsset.mockRejectedValue(muxError);

    const summary = await job.processCleanupQueue();

    expect(summary.processed).toBe(1);
    expect(summary.retried).toBe(1);
    expect(summary.deleted).toBe(0);
    expect(terminalEq).toHaveBeenCalledWith('id', 'rec-3');
    expect(observabilityService.logEvent).not.toHaveBeenCalled();
  });

  it('should retry when provider deletion fails with network timeout', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-4', mux_asset_id: 'mux-4', provider: 'mux', title: 'Test 4', retry_count: 1 }],
      error: null,
    });
    providerDeleteAsset.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const summary = await job.processCleanupQueue();

    expect(summary.retried).toBe(1);
    expect(summary.deleted).toBe(0);
    expect(terminalEq).toHaveBeenCalledWith('id', 'rec-4');
  });

  it('should mark cleanup_failed when retry limit is reached', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-5', mux_asset_id: 'mux-5', provider: 'mux', title: 'Test 5', retry_count: 9 }],
      error: null,
    });
    providerDeleteAsset.mockRejectedValue(new Error('Mux persistent error'));

    const summary = await job.processCleanupQueue();

    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.deleted).toBe(0);
    expect(observabilityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'RECORDING_CLEANUP_FAILED' }),
    );
  });

  it('should delete orphan recording rows without mux_asset_id', async () => {
    chain.limit.mockResolvedValue({
      data: [{ id: 'rec-6', mux_asset_id: null, provider: 'mux', title: 'Orphan', retry_count: 0 }],
      error: null,
    });

    const summary = await job.processCleanupQueue();

    expect(summary.deleted).toBe(1);
    expect(providerDeleteAsset).not.toHaveBeenCalled();
  });

  it('should process multiple recordings sequentially', async () => {
    chain.limit.mockResolvedValue({
      data: [
        { id: 'rec-a', mux_asset_id: 'mux-a', provider: 'mux', title: 'A', retry_count: 0 },
        { id: 'rec-b', mux_asset_id: 'mux-b', provider: 'mux', title: 'B', retry_count: 0 },
        { id: 'rec-c', mux_asset_id: 'mux-c', provider: 'mux', title: 'C', retry_count: 0 },
      ],
      error: null,
    });
    providerDeleteAsset.mockResolvedValue(undefined);

    const summary = await job.processCleanupQueue();

    expect(summary.processed).toBe(3);
    expect(summary.deleted).toBe(3);
    expect(providerDeleteAsset).toHaveBeenCalledTimes(3);
  });

  it('should handle Supabase query error gracefully', async () => {
    chain.limit.mockResolvedValue({ data: null, error: { message: 'DB connection lost' } });

    const summary = await job.processCleanupQueue();

    expect(summary.processed).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(providerDeleteAsset).not.toHaveBeenCalled();
  });
});
