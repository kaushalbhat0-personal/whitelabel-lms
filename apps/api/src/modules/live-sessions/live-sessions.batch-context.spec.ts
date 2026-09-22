import { Test, TestingModule } from '@nestjs/testing';
import { LiveSessionsService } from './live-sessions.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { BatchesService } from '../batches/batches.service';
import { ZoomService } from '../zoom/zoom.service';
import { ObservabilityService } from '../observability/observability.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { NotFoundException } from '@nestjs/common';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    order: jest.fn(() => q),
    range: jest.fn(() => q),
    insert: jest.fn(() => q),
    update: jest.fn(() => q),
    delete: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    not: jest.fn(() => q),
    limit: jest.fn(() => q),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}

const baseBatches = [
  { id: 'batch-a', name: '12 PM - 2 PM - B1' },
  { id: 'batch-b', name: '6 PM - 8 PM - B2' },
  { id: 'batch-c', name: 'Weekend - B3' },
];

function createService(client: any) {
  return Test.createTestingModule({
    providers: [
      LiveSessionsService,
      { provide: SupabaseService, useValue: { client } },
      { provide: BatchesService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'b1' }) } },
      { provide: ZoomService, useValue: { createWebinar: jest.fn(), registerAttendee: jest.fn(), deleteWebinar: jest.fn() } },
      { provide: ObservabilityService, useValue: { logEvent: jest.fn() } },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
      { provide: RedisService, useValue: { getOrThrow: () => ({ get: jest.fn(), setex: jest.fn(), del: jest.fn(), scan: jest.fn().mockResolvedValue(['0', []]) }) } },
    ],
  }).compile().then((m) => m.get(LiveSessionsService));
}

describe('LiveSessions batch context (student ∩ session)', () => {
  const future = new Date(Date.now() + 24*60*60*1000).toISOString();
  const past = new Date(Date.now() - 24*60*60*1000).toISOString();

  function setupFetchForStudent(opts: {
    userBatchIds: string[];
    sessionRows: any[];
    sessionBatchLinks: { session_id: string; batch_id: string }[];
    batchRows: { id: string; name: string }[];
    attendance?: { session_id: string; status: string }[];
  }) {
    const client: any = { from: jest.fn() };
    // Sequence for fetchForStudent:
    // 1 batch_students, 2 session_batches (sessionIds), 3 live_sessions, 4 attach: session_batches (all links), 5 batches, (optional 6 past links + 7 batches + attendance)
    let call = 0;
    client.from.mockImplementation((table: string) => {
      call++;
      if (call === 1) {
        // batch_students
        return mockQuery({ data: opts.userBatchIds.map((id) => ({ batch_id: id })), error: null });
      }
      if (call === 2) {
        // session_batches IN userBatchIds -> need to simulate filtering: return sessionBatchLinks filtered where batch in userBatchIds? Actual code does IN(batchIds) then dedup.
        const filtered = opts.sessionBatchLinks.filter((l) => opts.userBatchIds.includes(l.batch_id));
        return mockQuery({ data: filtered.map((l) => ({ session_id: l.session_id })), error: null });
      }
      if (call === 3) {
        // live_sessions IN sessionIds
        const eligibleIds = [...new Set(opts.sessionBatchLinks.filter((l) => opts.userBatchIds.includes(l.batch_id)).map((l) => l.session_id))];
        const rows = opts.sessionRows.filter((r) => eligibleIds.includes(r.id));
        return mockQuery({ data: rows, error: null });
      }
      if (call === 4) {
        // attach upcoming: session_batches IN sessionIds
        return mockQuery({ data: opts.sessionBatchLinks, error: null });
      }
      if (call === 5) {
        // batches IN matchingIds
        return mockQuery({ data: opts.batchRows, error: null });
      }
      if (call === 6) {
        // attach past: same pattern (if split)
        // second attach for past
        return mockQuery({ data: opts.sessionBatchLinks, error: null });
      }
      if (call === 7) {
        return mockQuery({ data: opts.batchRows, error: null });
      }
      if (call === 8) {
        // attendance
        return mockQuery({ data: opts.attendance ?? [], error: null });
      }
      return mockQuery({ data: [], error: null });
    });
    return client;
  }

  it('Case A: Student A + Session A+B => matchingBatches = A only', async () => {
    const session = { id: 's1', topic: 'Market Analysis', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const client = setupFetchForStudent({
      userBatchIds: ['batch-a'],
      sessionRows: [session],
      sessionBatchLinks: [
        { session_id: 's1', batch_id: 'batch-a' },
        { session_id: 's1', batch_id: 'batch-b' },
      ],
      batchRows: [baseBatches[0]],
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-a');
    expect(res.upcoming).toHaveLength(1);
    expect(res.upcoming[0].matchingBatches).toEqual([{ id: 'batch-a', name: '12 PM - 2 PM - B1' }]);
    expect(res.upcoming[0].matchingBatches.some((b: any) => b.id === 'batch-b')).toBe(false);
  });

  it('Case B: Student A+B + Session A+B => matchingBatches = A,B', async () => {
    const session = { id: 's1', topic: 'Live Trading', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const client = setupFetchForStudent({
      userBatchIds: ['batch-a', 'batch-b'],
      sessionRows: [session],
      sessionBatchLinks: [
        { session_id: 's1', batch_id: 'batch-a' },
        { session_id: 's1', batch_id: 'batch-b' },
      ],
      batchRows: [baseBatches[0], baseBatches[1]],
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-ab');
    expect(res.upcoming[0].matchingBatches).toHaveLength(2);
    expect(res.upcoming[0].matchingBatches.map((b: any) => b.id).sort()).toEqual(['batch-a', 'batch-b']);
  });

  it('Case C: Student A + Session B => not visible', async () => {
    const session = { id: 's2', topic: 'Options', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const client = setupFetchForStudent({
      userBatchIds: ['batch-a'],
      sessionRows: [session],
      sessionBatchLinks: [{ session_id: 's2', batch_id: 'batch-b' }],
      batchRows: [],
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-a');
    expect(res.upcoming).toHaveLength(0);
    expect(res.past).toHaveLength(0);
  });

  it('Case D: Student A+B + Session B+C => matchingBatches = B only', async () => {
    const session = { id: 's1', topic: 'Live Trading', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const client = setupFetchForStudent({
      userBatchIds: ['batch-a', 'batch-b'],
      sessionRows: [session],
      sessionBatchLinks: [
        { session_id: 's1', batch_id: 'batch-b' },
        { session_id: 's1', batch_id: 'batch-c' },
      ],
      batchRows: [baseBatches[1]],
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-ab');
    expect(res.upcoming[0].matchingBatches).toEqual([{ id: 'batch-b', name: '6 PM - 8 PM - B2' }]);
  });

  it('Case E: Student A + Session A => matchingBatches = A', async () => {
    const session = { id: 's1', topic: 'Options Session', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const client = setupFetchForStudent({
      userBatchIds: ['batch-a'],
      sessionRows: [session],
      sessionBatchLinks: [{ session_id: 's1', batch_id: 'batch-a' }],
      batchRows: [baseBatches[0]],
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-a');
    expect(res.upcoming[0].matchingBatches).toEqual([{ id: 'batch-a', name: '12 PM - 2 PM - B1' }]);
  });

  it('Case F: session with no batch links => not visible (preserve invisible behavior)', async () => {
    const client = setupFetchForStudent({
      userBatchIds: ['batch-a'],
      sessionRows: [],
      sessionBatchLinks: [],
      batchRows: [],
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-a');
    expect(res.upcoming).toHaveLength(0);
  });

  it('findById student: returns only matchingBatches, not all batchIds', async () => {
    const client: any = { from: jest.fn() };
    let call = 0;
    client.from.mockImplementation(() => {
      call++;
      if (call === 1) return mockQuery({ data: { id: 's1', topic: 'Market', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' }, error: null });
      if (call === 2) return mockQuery({ data: [{ batch_id: 'batch-a' }, { batch_id: 'batch-b' }, { batch_id: 'batch-c' }], error: null });
      if (call === 3) return mockQuery({ data: [{ batch_id: 'batch-a' }, { batch_id: 'batch-b' }], error: null }); // userBatchIds A,B
      if (call === 4) return mockQuery({ data: [baseBatches[0], baseBatches[1]], error: null }); // batches filtered
      if (call === 5) return mockQuery({ data: { id: 't1', name: 'Teacher', email: 't@test.com' }, error: null });
      return mockQuery({ data: [], error: null });
    });
    const svc = await createService(client);
    const res: any = await svc.findById('s1', { id: 'user-ab', role: 'student' });
    expect(res.batchIds.sort()).toEqual(['batch-a', 'batch-b']);
    expect(res.matchingBatches.map((b: any) => b.id).sort()).toEqual(['batch-a', 'batch-b']);
    // batch-c must NOT be exposed
    expect(res.batchIds.includes('batch-c')).toBe(false);
    expect(res.matchingBatches.some((b: any) => b.id === 'batch-c')).toBe(false);
  });

  it('findById student C: direct get of session B should 404', async () => {
    const client: any = { from: jest.fn() };
    let call = 0;
    client.from.mockImplementation(() => {
      call++;
      if (call === 1) return mockQuery({ data: { id: 's1', topic: 'Market', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' }, error: null });
      if (call === 2) return mockQuery({ data: [{ batch_id: 'batch-b' }], error: null }); // session B
      if (call === 3) return mockQuery({ data: [{ batch_id: 'batch-a' }], error: null }); // user A
      return mockQuery({ data: [], error: null });
    });
    const svc = await createService(client);
    await expect(svc.findById('s1', { id: 'user-a', role: 'student' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dashboard: upcoming carries matchingBatches (slim)', async () => {
    const session = { id: 's1', topic: 'Market', start_time: future, duration_minutes: 60, status: 'scheduled', created_at: future };
    const client: any = { from: jest.fn() };
    let call = 0;
    client.from.mockImplementation(() => {
      call++;
      if (call === 1) return mockQuery({ data: [{ batch_id: 'batch-a' }], error: null });
      if (call === 2) return mockQuery({ data: [{ session_id: 's1' }], error: null });
      if (call === 3) return mockQuery({ data: [session], error: null });
      if (call === 4) return mockQuery({ data: [{ session_id: 's1', batch_id: 'batch-a' }, { session_id: 's1', batch_id: 'batch-b' }], error: null });
      if (call === 5) return mockQuery({ data: [baseBatches[0]], error: null });
      return mockQuery({ data: [], error: null });
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchDashboardSessions('user-a');
    expect(res.upcoming[0].matchingBatches).toEqual([{ id: 'batch-a', name: '12 PM - 2 PM - B1' }]);
    expect(res.past).toEqual([]);
  });

  it('attachMatchingBatches does not N+1: single session_batches + single batches query for many sessions', async () => {
    const s1 = { id: 's1', topic: 'S1', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const s2 = { id: 's2', topic: 'S2', start_time: future, duration_minutes: 60, status: 'scheduled', teacher_id: 't1' };
    const client: any = { from: jest.fn() };
    let call = 0;
    client.from.mockImplementation(() => {
      call++;
      if (call === 1) return mockQuery({ data: [{ batch_id: 'batch-a' }, { batch_id: 'batch-b' }], error: null });
      if (call === 2) return mockQuery({ data: [{ session_id: 's1' }, { session_id: 's2' }], error: null });
      if (call === 3) return mockQuery({ data: [s1, s2], error: null });
      if (call === 4) return mockQuery({ data: [
        { session_id: 's1', batch_id: 'batch-a' },
        { session_id: 's2', batch_id: 'batch-b' },
      ], error: null });
      if (call === 5) return mockQuery({ data: [baseBatches[0], baseBatches[1]], error: null });
      if (call === 6) return mockQuery({ data: [{ session_id: 's1', batch_id: 'batch-a' }, { session_id: 's2', batch_id: 'batch-b' }], error: null });
      if (call === 7) return mockQuery({ data: [baseBatches[0], baseBatches[1]], error: null });
      return mockQuery({ data: [], error: null });
    });
    const svc = await createService(client);
    const res: any = await (svc as any).fetchForStudent('user-ab');
    // Verify both sessions enriched with one batched call each for upcoming/past combined
    expect(res.upcoming.find((s: any) => s.id === 's1').matchingBatches).toEqual([{ id: 'batch-a', name: '12 PM - 2 PM - B1' }]);
    expect(res.upcoming.find((s: any) => s.id === 's2').matchingBatches).toEqual([{ id: 'batch-b', name: '6 PM - 8 PM - B2' }]);
    // Ensure client.from called limited times (not per-session)
    expect(call).toBeLessThanOrEqual(7);
  });
});
