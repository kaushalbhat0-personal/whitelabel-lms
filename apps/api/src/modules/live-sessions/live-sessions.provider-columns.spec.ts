/*
 * Provider-neutral persistence (RCCF-LIVE-GMEET-03).
 *
 * Proves LiveSessionsService dual-writes provider_* + zoom_* on create,
 * mirrors provider_registrant_id on registrants, and reads generic
 * live-session behavior through provider_* columns with zoom_* fallback.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LiveSessionsService } from './live-sessions.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { BatchesService } from '../batches/batches.service';
import { LIVE_PROVIDER } from '../live-provider/live-provider.types';
import { ObservabilityService } from '../observability/observability.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';

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

function setupFrom(client: any, results: any[]) {
  let i = 0;
  client.from.mockImplementation(() => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return mockQuery(r);
  });
}

const redis = {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  scan: jest.fn().mockResolvedValue(['0', []]),
};

function buildProviderMock(name: string) {
  return {
    name,
    createWebinar: jest
      .fn()
      .mockResolvedValue({ webinarId: 'w1', joinUrl: 'https://zoom/j/w1', startUrl: 'https://zoom/s/w1' }),
    registerAttendee: jest.fn().mockResolvedValue('https://zoom/j/w1/personal'),
    deleteWebinar: jest.fn().mockResolvedValue(undefined),
  };
}

describe('LiveSessionsService provider-neutral persistence (GMEET-03)', () => {
  let service: LiveSessionsService;
  let client: any;
  let provider: any;

  beforeEach(async () => {
    client = { from: jest.fn() };
    provider = buildProviderMock('zoom');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionsService,
        { provide: SupabaseService, useValue: { client } },
        { provide: BatchesService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'b1' }) } },
        { provide: LIVE_PROVIDER, useValue: provider },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('df981417-5356-4c64-8a2b-66ef7720162c') } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();
    service = module.get(LiveSessionsService);
  });

  it('create dual-writes provider_* canonical columns and zoom_* mirrors', async () => {
    setupFrom(client, [
      { data: { id: 'h1', zoom_user_id: 'z1' }, error: null }, // host
      { data: { id: 's1', teacher_id: 'h1', status: 'scheduled' }, error: null }, // session insert
      { data: [], error: null }, // batch_students (no students → registrant loop skipped)
      { data: null, error: null }, // session_batches insert
    ]);
    await service.create({
      topic: 'T',
      startTime: '2026-12-01T10:00:00Z',
      durationMinutes: 60,
      batchIds: ['b1'],
    } as any);

    const insertIdx = client.from.mock.calls.findIndex((c: any[]) => c[0] === 'live_sessions');
    const insertPayload = client.from.mock.results[insertIdx]?.value.insert.mock.calls[0]?.[0];
    expect(insertPayload).toMatchObject({
      provider: 'zoom',
      provider_session_id: 'w1',
      provider_join_url: 'https://zoom/j/w1',
      provider_start_url: 'https://zoom/s/w1',
      zoom_webinar_id: 'w1',
      zoom_webinar_join_url: 'https://zoom/j/w1',
    });
  });

  it('create mirrors provider_registrant_id on registrant rows', async () => {
    setupFrom(client, [
      { data: { id: 'h1', zoom_user_id: 'z1' }, error: null }, // host
      { data: { id: 's1', teacher_id: 'h1', status: 'scheduled' }, error: null }, // session insert
      { data: [{ user_id: 'u1', profiles: { id: 'u1', name: 'S', email: 's@x.com' } }], error: null }, // batch_students
      { data: null, error: null }, // session_batches insert
      { data: null, error: null }, // registrants insert
    ]);
    await service.create({
      topic: 'T',
      startTime: '2026-12-01T10:00:00Z',
      durationMinutes: 60,
      batchIds: ['b1'],
    } as any);

    const regIdx = client.from.mock.calls.findIndex((c: any[]) => c[0] === 'session_registrants');
    const regPayload = client.from.mock.results[regIdx]?.value.insert.mock.calls[0]?.[0];
    expect(regPayload[0]).toMatchObject({
      session_id: 's1',
      user_id: 'u1',
      personal_join_url: 'https://zoom/j/w1/personal',
      provider_registrant_id: null,
      zoom_registrant_id: null,
    });
  });

  it('cancel reads provider_session_id (zoom_* only as fallback)', async () => {
    setupFrom(client, [
      // updateStatus: existing row carries provider id, no legacy id
      { data: { provider_session_id: 'p-meet-1', zoom_webinar_id: null }, error: null },
      { data: { id: 's1', status: 'cancelled' }, error: null }, // status update
      { data: [], error: null }, // invalidateSessionsForSessionId links
    ]);
    await service.updateStatus('s1', 'cancelled' as any);
    expect(provider.deleteWebinar).toHaveBeenCalledWith('p-meet-1');
  });

  it('cancel falls back to zoom_webinar_id when provider_session_id is null (legacy row)', async () => {
    setupFrom(client, [
      { data: { provider_session_id: null, zoom_webinar_id: 'w-legacy' }, error: null },
      { data: { id: 's1', status: 'cancelled' }, error: null },
      { data: [], error: null },
    ]);
    await service.updateStatus('s1', 'cancelled' as any);
    expect(provider.deleteWebinar).toHaveBeenCalledWith('w-legacy');
  });

  it('deleteSession prefers provider_session_id over zoom_webinar_id', async () => {
    setupFrom(client, [
      { data: { provider_session_id: 'p1', zoom_webinar_id: 'w1' }, error: null }, // fetch
      { data: null, error: null }, // delete
    ]);
    await service.deleteSession('s1');
    expect(provider.deleteWebinar).toHaveBeenCalledWith('p1');
  });
});
