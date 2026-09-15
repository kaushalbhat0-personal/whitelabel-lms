import { RecordingUploadJob } from './recording-upload.job';
import { ServiceUnavailableException } from '@nestjs/common';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({ data: { access_token: 'zoom-oauth-token' } }),
  },
}));

function futureIso(hoursAhead = 20) {
  return new Date(Date.now() + hoursAhead * 3600 * 1000).toISOString();
}
function minutesAgo(min: number) {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

/**
 * Table-aware Supabase mock. Each from(table) call consumes the next result
 * queued for that table (mirrors the repo's freshChain pattern, keyed per
 * table because the job interleaves upload_queue / session_batches /
 * recordings reads and writes).
 *
 * upload_queue call order per tick:
 *   [0] stale-reclaim update · [1] candidate fetch(select *)
 *   then per claimed job: claim-update, asset-persist-update, done-update
 *   (+ one update per expired parked row).
 */
function makeDb(
  queueResults: any[] = [],
  batchResults: any[] = [],
  recordingSelects: any[] = [],
) {
  const counters: Record<string, number> = {};

  const db = {
    from: jest.fn((table: string) => {
      const bank =
        table === 'upload_queue' ? queueResults :
        table === 'session_batches' ? batchResults :
        table === 'recordings' ? recordingSelects : [];
      const idx = counters[table] ?? 0;
      counters[table] = idx + 1;

      const q: any = {};
      q._result = bank[idx] ?? { data: null, error: null };
      for (const m of ['select', 'eq', 'in', 'lt', 'gt', 'order', 'limit']) {
        q[m] = jest.fn(() => q);
      }
      q.insertPayloads = [] as any[];
      q.updatePayloads = [] as any[];
      q.insert = jest.fn((payload: any) => {
        q.insertPayloads.push(payload);
        return q;
      });
      q.update = jest.fn((payload: any) => {
        q.updatePayloads.push(payload);
        return q;
      });
      q.single = jest.fn(() => Promise.resolve(q._result));
      q.then = (onF: any, onR?: any) => Promise.resolve(q._result).then(onF, onR);

      (q as any).__table = table;
      return q;
    }),
    /** All created chains, in creation order. */
    chains(): any[] {
      return (db.from as any).mock.results.map((r: any) => r.value);
    },
  };
  return { db };
}

/** Standard tick seed: reclaim consumes slot 0, candidate fetch consumes slot 1. */
function tickWithJobs(jobs: any[]) {
  return [
    { data: null, error: null }, // reclaim update
    { data: jobs, error: null }, // candidate fetch
  ];
}

function makeJob(db: { from: any }) {
  const provider = {
    name: 'bunny' as const,
    createAssetFromSource: jest.fn(async () => ({ assetId: 'guid-1' })),
  };
  const resolver = {
    resolveUploadProvider: jest.fn(() => 'bunny' as const),
    resolve: jest.fn(() => provider),
  };
  const recordingsService = { assignToBatches: jest.fn(async () => ({ assignedCount: 1 })) };
  const config = { get: jest.fn(() => 'cred') };

  const job = new RecordingUploadJob(
    { client: db } as any,
    recordingsService as any,
    resolver as any,
    config as any,
  );
  return { job, provider, resolver, recordingsService, config };
}

describe('RecordingUploadJob', () => {
  function pendingJob(overrides: Record<string, any> = {}) {
    return {
      id: 'job-1',
      status: 'pending',
      attempts: 0,
      session_id: 'sess-1',
      zoom_download_url: 'https://zoom.us/rec/download/f1',
      zoom_url_expires_at: futureIso(),
      zoom_topic: 'Mentorship #12',
      mux_asset_id: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('happy path: claims once, imports once, persists asset id, creates recording, inherits batches canonically, closes done', async () => {
    const { db } = makeDb(
      tickWithJobs([pendingJob({ id: 'job-happy' })]),
      [{ data: [{ batch_id: 'b1' }, { batch_id: 'b2' }], error: null }],
      [{ data: [], error: null }, { data: { id: 'rec-1' }, error: null }],
    );
    const { job, provider, recordingsService } = makeJob(db);

    await job.processPendingUploads();

    expect(provider.createAssetFromSource).toHaveBeenCalledTimes(1);
    expect(recordingsService.assignToBatches).toHaveBeenCalledWith('rec-1', ['b1', 'b2']);

    const chains = db.chains();
    expect(chains[2].updatePayloads[0]).toMatchObject({ status: 'processing', attempts: 1 });
    expect(chains[4].updatePayloads[0].mux_asset_id).toBe('guid-1');
    expect(chains[6].insertPayloads[0]).toMatchObject({
      session_id: 'sess-1',
      title: 'Mentorship #12',
      provider: 'bunny',
      mux_asset_id: 'guid-1',
      status: 'processing',
    });
    expect(chains[chains.length - 1].updatePayloads[0].status).toBe('done');
  });

  it('reuses an existing provider asset id after a mid-job crash — Bunny is never imported twice', async () => {
    const { db } = makeDb(
      tickWithJobs([pendingJob({ id: 'job-resume', mux_asset_id: 'guid-already-imported' })]),
      [{ data: [{ batch_id: 'b1' }], error: null }],
      [{ data: [{ id: 'rec-existing' }], error: null }],
    );
    const { job, provider, recordingsService } = makeJob(db);

    await job.processPendingUploads();

    expect(provider.createAssetFromSource).not.toHaveBeenCalled();
    expect(recordingsService.assignToBatches).toHaveBeenCalledWith('rec-existing', ['b1']);
    // No new recording row was inserted anywhere.
    expect(db.chains().some((c) => c.__table === 'recordings' && c.insertPayloads.length)).toBe(false);
  });

  it('retries a failed job whose backoff elapsed and increments attempts', async () => {
    const retryable = pendingJob({
      id: 'job-r',
      status: 'failed',
      attempts: 1,
      updated_at: minutesAgo(10), // > 5 min backoff after attempt #1
    });
    const { db } = makeDb(
      tickWithJobs([retryable]),
      [{ data: [], error: null }],
      [{ data: [], error: null }, { data: { id: 'rec-r' }, error: null }],
    );
    const { job } = makeJob(db);

    await job.processPendingUploads();

    const chains = db.chains();
    expect(chains[2].updatePayloads[0]).toMatchObject({ status: 'processing', attempts: 2 });
    expect(chains[chains.length - 1].updatePayloads[0].status).toBe('done');
  });

  it('skips backing-off / terminal jobs and parks expired pending URLs as expired', async () => {
    const backingOff = pendingJob({
      id: 'job-b', status: 'failed', attempts: 1, updated_at: minutesAgo(1),
    });
    const expiredJob = pendingJob({ id: 'job-e', zoom_url_expires_at: minutesAgo(5) });
    const terminal = pendingJob({
      id: 'job-t', status: 'failed',
      attempts: RecordingUploadJob.MAX_ATTEMPTS,
      updated_at: minutesAgo(120),
    });

    const { db } = makeDb(tickWithJobs([backingOff, expiredJob, terminal]));
    const { job, provider } = makeJob(db);

    await job.processPendingUploads();

    expect(provider.createAssetFromSource).not.toHaveBeenCalled();
    // Exactly one post-fetch write: parking the expired job.
    const postFetchWrites = db.chains().slice(2).flatMap((c) => c.updatePayloads);
    expect(postFetchWrites).toHaveLength(1);
    expect(postFetchWrites[0].status).toBe('expired');
  });

  it('zero batches: recording is created but NEVER auto-assigned (stays invisible to students)', async () => {
    const orphan = pendingJob({ id: 'job-orphan' });
    const { db } = makeDb(
      tickWithJobs([orphan]),
      [{ data: [], error: null }],
      [{ data: [], error: null }, { data: { id: 'rec-orph' }, error: null }],
    );
    const { job, recordingsService } = makeJob(db);

    await job.processPendingUploads();

    expect(recordingsService.assignToBatches).not.toHaveBeenCalled();
    expect(db.chains()[db.chains().length - 1].updatePayloads[0].status).toBe('done');
  });

  it('null session_id: proceeds without a session lookup and never assigns batches', async () => {
    const noSession = pendingJob({ id: 'job-ns', session_id: null });
    const { db } = makeDb(
      tickWithJobs([noSession]),
      [],
      [{ data: [], error: null }, { data: { id: 'rec-ns' }, error: null }],
    );
    const { job, recordingsService } = makeJob(db);

    await job.processPendingUploads();

    expect(recordingsService.assignToBatches).not.toHaveBeenCalled();
    expect(db.from.mock.calls.some((c: any[]) => c[0] === 'session_batches')).toBe(false);

    const recChain = db.chains().find((c) => c.__table === 'recordings' && c.insertPayloads.length);
    expect(recChain.insertPayloads[0].session_id).toBeNull();
  });

  it('provider misconfiguration (visible-503 policy failure) marks the job FAILED with the message persisted', async () => {
    const victim = pendingJob({ id: 'job-503' });
    const { db } = makeDb(tickWithJobs([victim]));
    const { job, resolver } = makeJob(db);
    resolver.resolveUploadProvider.mockImplementation(() => {
      throw new ServiceUnavailableException('Bunny not configured — upload refused');
    });

    await job.processPendingUploads();

    const failUpdate = db.chains()
      .flatMap((c) => c.updatePayloads)
      .find((u: any) => u.status === 'failed');
    expect(failUpdate.error_message).toContain('Bunny not configured');
  });

  it('sanitizes credential-bearing error text before persisting it', async () => {
    const victim = pendingJob({ id: 'job-leak' });
    const { db } = makeDb(tickWithJobs([victim]));
    const { job, provider } = makeJob(db);
    provider.createAssetFromSource.mockRejectedValue(
      new Error('fetch rejected for https://zoom/rec?access_token=SECRET123'),
    );

    await job.processPendingUploads();

    const failUpdate = db.chains()
      .flatMap((c) => c.updatePayloads)
      .find((u: any) => u.status === 'failed');
    expect(failUpdate.error_message).not.toContain('SECRET123');
    expect(failUpdate.error_message).toContain('access_token=[redacted]');
  });

  it('reclaims stale processing rows back to pending at tick start', async () => {
    const { db } = makeDb([{ data: null, error: null }, { data: [], error: null }]);
    const { job } = makeJob(db);

    await job.processPendingUploads();

    expect(db.chains()[0].updatePayloads[0].status).toBe('pending');
  });
});
