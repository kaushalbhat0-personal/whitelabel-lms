import { Test, TestingModule } from '@nestjs/testing';
import { ZoomWebhookHandler, selectZoomRecordingFile } from './zoom-webhook.handler';

function freshChain() {
  const q: any = {
    _result: { data: [], error: null },
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    limit: jest.fn(() => q),
    upsert: jest.fn(() => q),
    update: jest.fn(() => q),
    insert: jest.fn(() => q),
  };
  q.then = (onF: any) => Promise.resolve(q._result).then(onF);
  return q;
}

/** Pure-function coverage for the Phase 8 file-selection rules. */
describe('selectZoomRecordingFile', () => {
  it('returns null when there are no MP4 files', () => {
    expect(
      selectZoomRecordingFile([
        { file_type: 'TRANSCRIPT', status: 'completed' },
        { file_type: 'M4A', status: 'completed' },
      ]),
    ).toBeNull();
  });

  it('ignores MP4 files that are not completed', () => {
    expect(
      selectZoomRecordingFile([{ file_type: 'MP4', status: 'processing' }]),
    ).toBeNull();
    expect(
      selectZoomRecordingFile([{ file_type: 'MP4', status: 'completed' }]),
    ).not.toBeNull();
  });

  it('prefers the largest usable video over later/smaller files', () => {
    const picked = selectZoomRecordingFile([
      { id: 'small', file_type: 'MP4', status: 'completed', play_width: 640, play_height: 360 },
      { id: 'big', file_type: 'MP4', status: 'completed', play_width: 1920, play_height: 1080 },
      { id: 'mid', file_type: 'MP4', status: 'completed', play_width: 1280, play_height: 720 },
    ]);
    expect(picked?.file.id).toBe('big');
    expect(picked?.reason).toContain('skipped');
  });

  it('breaks pixel ties deterministically on latest recording_start', () => {
    const picked = selectZoomRecordingFile([
      { id: 'a', file_type: 'MP4', status: 'completed', play_width: 1280, play_height: 720, recording_start: '2026-01-01T10:00:00Z' },
      { id: 'b', file_type: 'MP4', status: 'completed', play_width: 1280, play_height: 720, recording_start: '2026-01-01T11:00:00Z' },
    ]);
    expect(picked?.file.id).toBe('b');
  });
});

describe('ZoomWebhookHandler', () => {
  let handler: ZoomWebhookHandler;
  let fromResults: any[];
  let fromChains: any[];
  let supabase: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ZoomWebhookHandler],
    }).compile();
    handler = module.get(ZoomWebhookHandler);
    fromResults = [];
    fromChains = [];
    supabase = {
      rpc: jest.fn().mockResolvedValue({ error: null }),
      from: jest.fn(() => {
        const q = freshChain();
        fromChains.push(q);
        // Each from() call resolves to the next configured result.
        const idx = fromChains.length - 1;
        if (fromResults[idx]) q._result = fromResults[idx];
        return q;
      }),
    };
  });

  describe('webinar.participant_joined', () => {
    it('writes attendance with join_time (schema-aligned, not joined_at)', async () => {
      fromResults.push({ data: [{ id: 's1' }], error: null }); // session lookup
      fromResults.push({ data: [{ id: 'u1' }], error: null }); // user lookup

      await handler.handle('webinar.participant_joined', {
        object: { id: 'w1', participant: { email: 'student-a@mct.com' } },
      }, supabase);

      const attendanceChain = fromChains.find((c, i) => fromChains.indexOf(c) === i && c.upsert.mock.calls.length > 0);
      const upsertPayload = attendanceChain?.upsert.mock.calls[0][0];
      expect(upsertPayload).toMatchObject({ session_id: 's1', user_id: 'u1', status: 'present', marked_manually: false });
      expect(upsertPayload.join_time).toBeDefined();
      expect(upsertPayload.joined_at).toBeUndefined();
    });

    it('ignores unknown email gracefully', async () => {
      fromResults.push({ data: [{ id: 's1' }], error: null });
      fromResults.push({ data: [], error: null });
      await expect(handler.handle('webinar.participant_joined', { object: { id: 'w1', participant: { email: 'ghost@x.com' } } }, supabase)).resolves.toBeUndefined();
    });
  });

  describe('webinar.participant_left', () => {
    it('updates duration_seconds + leave_time', async () => {
      fromResults.push({ data: [{ id: 's1' }], error: null }); // session
      fromResults.push({ data: [{ id: 'u1' }], error: null }); // user
      fromResults.push({ data: [{ join_time: new Date(Date.now() - 60000).toISOString() }], error: null }); // attendance

      await handler.handle('webinar.participant_left', { object: { id: 'w1', participant: { email: 'student-a@mct.com' } } }, supabase);

      const updateChain = fromChains.find((c) => c.update.mock.calls.length > 0);
      const updatePayload = updateChain?.update.mock.calls[0][0];
      expect(updatePayload.duration_seconds).toBeGreaterThan(50);
      expect(updatePayload.leave_time).toBeDefined();
      expect(updatePayload.joined_at).toBeUndefined();
    });
  });

  describe('webinar.ended', () => {
    it('sets session status to ended and calls mark_absent_for_session RPC', async () => {
      fromResults.push({ data: null, error: null }); // live_sessions update (no select result)
      fromResults.push({ data: [{ id: 's1' }], error: null }); // session lookup for RPC

      await handler.handle('webinar.ended', { object: { id: 'w1' } }, supabase);

      const updateChain = fromChains.find((c) => c.update.mock.calls.length > 0);
      expect(updateChain?.update.mock.calls[0][0].status).toBe('ended');
      expect(supabase.rpc).toHaveBeenCalledWith('mark_absent_for_session', { session_id: 's1' });
    });
  });

  describe('recording.completed', () => {
    const baseFile = { id: 'f1', file_type: 'MP4', status: 'completed', download_url: 'https://zoom/rec.mp4' };

    function completedEvent(files: any[] = [baseFile], extra: Record<string, any> = {}) {
      return { object: { id: 'wb1', uuid: 'meet-uuid-1', topic: 'Mentorship #12', recording_files: files, ...extra } };
    }

    it('queues ONE pending ingestion capturing Zoom identity metadata', async () => {
      fromResults.push({ data: [{ id: 's1' }], error: null }); // session lookup
      fromResults.push({ data: [], error: null }); // dedupe lookup (no prior job)

      await handler.handle('recording.completed', completedEvent(), supabase);

      const uqChain = fromChains.find((c) => c.insert.mock.calls.length > 0);
      const payload = uqChain?.insert.mock.calls[0][0];
      expect(payload).toMatchObject({
        session_id: 's1',
        zoom_download_url: 'https://zoom/rec.mp4',
        zoom_meeting_uuid: 'meet-uuid-1',
        zoom_recording_file_id: 'f1',
        zoom_topic: 'Mentorship #12',
        status: 'pending',
      });
      expect(payload.zoom_url_expires_at).toBeDefined();
    });

    it('selects the best MP4, never the literal first file', async () => {
      fromResults.push({ data: [{ id: 's1' }], error: null });
      fromResults.push({ data: [], error: null });

      await handler.handle('recording.completed', completedEvent([
        { id: 'tr', file_type: 'TRANSCRIPT', status: 'completed', download_url: 'https://zoom/t.vtt' },
        { id: 'small', file_type: 'MP4', status: 'completed', play_width: 640, play_height: 360, download_url: 'https://zoom/s.mp4' },
        { id: 'big', file_type: 'MP4', status: 'completed', play_width: 1920, play_height: 1080, download_url: 'https://zoom/b.mp4' },
      ]), supabase);

      const payload = fromChains.find((c) => c.insert.mock.calls.length > 0)?.insert.mock.calls[0][0];
      expect(payload.zoom_download_url).toBe('https://zoom/b.mp4');
      expect(payload.zoom_recording_file_id).toBe('big');
    });

    it('ignores events without any completed MP4 (no queue write)', async () => {
      await handler.handle('recording.completed', completedEvent([
        { id: 'tr', file_type: 'TRANSCRIPT', status: 'completed', download_url: 'https://zoom/t.vtt' },
        { id: 'aud', file_type: 'M4A', status: 'completed', download_url: 'https://zoom/a.m4a' },
      ]), supabase);
      expect(fromChains.some((c) => c.insert.mock.calls.length > 0)).toBe(false);
    });

    it('records an observable FAILED row for an unknown webinar instead of dropping the event', async () => {
      fromResults.push({ data: [], error: null }); // session lookup misses

      await handler.handle('recording.completed', completedEvent(), supabase);

      const payload = fromChains.find((c) => c.insert.mock.calls.length > 0)?.insert.mock.calls[0][0];
      expect(payload.status).toBe('failed');
      expect(payload.session_id).toBeNull();
      expect(payload.error_message).toContain('no_matching_live_session');
      // The source URL is preserved so ops can re-enqueue manually.
      expect(payload.zoom_download_url).toBe('https://zoom/rec.mp4');
    });

    it('records an observable FAILED row when the selected file has no download URL', async () => {
      await handler.handle('recording.completed', completedEvent([
        { id: 'f9', file_type: 'MP4', status: 'completed' },
      ]), supabase);

      const payload = fromChains.find((c) => c.insert.mock.calls.length > 0)?.insert.mock.calls[0][0];
      expect(payload.status).toBe('failed');
      expect(payload.session_id).toBeNull();
      expect(payload.error_message).toContain('download_url');
      expect(payload.zoom_recording_file_id).toBe('f9');
    });

    it('is idempotent: a redelivered event for a known file id never enqueues twice', async () => {
      // Delivery 1: session resolves, dedupe lookup misses, one job enqueued.
      // from-call order per delivery: [session lookup, dedupe lookup, insert chain].
      fromResults.push({ data: [{ id: 's1' }], error: null }); // #0 session lookup (delivery 1)
      fromResults.push({ data: [], error: null }); // #1 dedupe lookup (delivery 1) — miss
      fromResults.push({ data: null, error: null }); // #2 insert chain (delivery 1) — result never read
      // Delivery 2: session resolves again, dedupe lookup now finds the job
      // that delivery 1 inserted (mimics the persisted row) => no second insert.
      fromResults.push({ data: [{ id: 's1' }], error: null }); // #3 session lookup (delivery 2)
      fromResults.push({ data: [{ id: 'job-77', status: 'pending' }], error: null }); // #4 dedupe hit (delivery 2)

      await handler.handle('recording.completed', completedEvent(), supabase);
      await handler.handle('recording.completed', completedEvent(), supabase);

      // Exactly ONE job was enqueued (delivery 1); the redelivery was a no-op.
      expect(fromChains.filter((c) => c.insert.mock.calls.length > 0)).toHaveLength(1);
    });

    it('treats a unique-index race (23505) on insert as a benign duplicate', async () => {
      fromResults.push({ data: [{ id: 's1' }], error: null }); // session lookup
      fromResults.push({ data: [], error: null }); // dedupe miss
      fromResults.push({ data: null, error: { code: '23505', message: 'duplicate key' } }); // insert race

      await expect(
        handler.handle('recording.completed', completedEvent(), supabase),
      ).resolves.toBeUndefined();
      // Exactly one insert was attempted; no crash propagated.
      expect(fromChains.filter((c) => c.insert.mock.calls.length > 0)).toHaveLength(1);
    });

    it('keeps other events working when payload.object is malformed', async () => {
      await expect(handler.handle('recording.completed', {}, supabase)).resolves.toBeUndefined();
      await expect(handler.handle('recording.completed', { object: {} }, supabase)).resolves.toBeUndefined();
      expect(fromChains.some((c) => c.insert.mock.calls.length > 0)).toBe(false);
    });
  });
});
