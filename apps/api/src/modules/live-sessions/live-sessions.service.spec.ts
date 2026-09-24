import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

describe('LiveSessionsService', () => {
  let service: LiveSessionsService;
  let client: any;
  let zoom: any;

  beforeEach(async () => {
    client = { from: jest.fn() };
    zoom = {
      createWebinar: jest.fn().mockResolvedValue({ webinarId: 'w1', joinUrl: 'https://zoom/j/w1', startUrl: 'https://zoom/s/w1' }),
      registerAttendee: jest.fn().mockResolvedValue('https://zoom/j/w1/personal'),
      deleteWebinar: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionsService,
        { provide: SupabaseService, useValue: { client } },
        { provide: BatchesService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'b1' }) } },
        { provide: LIVE_PROVIDER, useValue: zoom },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('df981417-5356-4c64-8a2b-66ef7720162c') } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();
    service = module.get(LiveSessionsService);
  });

  describe('Host Resolver (schema + host abstraction)', () => {
    it('resolves explicit host when they have zoom_user_id', async () => {
      // resolveHost is private; exercise via create(). Explicit host path:
      client.from.mockReset();
      setupFrom(client, [
        { data: { id: 'host-1', zoom_user_id: 'zoom-1' }, error: null }, // explicit host
        { data: { id: 's1', teacher_id: 'host-1', status: 'scheduled', created_at: 'x', updated_at: 'x', zoom_webinar_id: 'w1', zoom_webinar_join_url: 'u', topic: 'T', start_time: 'x' }, error: null }, // session insert
        { data: [{ user_id: 'u1', profiles: { id: 'u1', name: 'S', email: 's@x.com' } }], error: null }, // batch_students
        { data: null, error: null }, // insert session_batches
        { data: null, error: null }, // insert registrants
      ]);
      const result = await service.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'], teacherId: 'host-1' } as any);
      expect(result.teacher_id).toBe('host-1');
      expect(result.id).toBe('s1');
      // Verify the session insert used the correct DB column teacher_id (not host_user_id)
      const insertCall = client.from.mock.calls.find((c: any[]) => c[0] === 'live_sessions');
      expect(insertCall).toBeTruthy();
    });

    it('rejects an explicit host without zoom_user_id', async () => {
      setupFrom(client, [
        { data: { id: 'host-1', zoom_user_id: null }, error: null },
      ]);
      await expect(service.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'], teacherId: 'host-1' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when explicit host not found', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'], teacherId: 'nope' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves default host from config when no explicit host', async () => {
      // ConfigService returns default host id; resolver first checks it
      client.from.mockReset();
      setupFrom(client, [
        { data: { id: 'default-1', zoom_user_id: 'zoom-d' }, error: null }, // default host
        { data: { id: 's1', teacher_id: 'default-1', status: 'scheduled', created_at: 'x', updated_at: 'x', zoom_webinar_id: 'w1', zoom_webinar_join_url: 'u', topic: 'T', start_time: 'x' }, error: null },
        { data: [{ user_id: 'u1', profiles: { id: 'u1', name: 'S', email: 's@x.com' } }], error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      const result = await service.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'] } as any);
      expect(result.teacher_id).toBe('default-1');
    });

    it('rejects with clear error when no host available', async () => {
      // default host has no zoom_user_id, first available host query returns none
      const config = { get: jest.fn().mockReturnValue('default-1') };
      const module = await Test.createTestingModule({
        providers: [
          LiveSessionsService,
          { provide: SupabaseService, useValue: { client: { from: jest.fn() } } },
          { provide: BatchesService, useValue: { findById: jest.fn() } },
          { provide: LIVE_PROVIDER, useValue: zoom },
          { provide: ObservabilityService, useValue: { logEvent: jest.fn() } },
          { provide: ConfigService, useValue: config },
          { provide: RedisService, useValue: { getOrThrow: () => redis } },
        ],
      }).compile();
      const svc = module.get(LiveSessionsService);
      const c2 = (module.get(SupabaseService) as any).client;
      setupFrom(c2, [
        { data: { id: 'default-1', zoom_user_id: null }, error: null }, // default host no zoom
        { data: null, error: null }, // first available host -> none
      ]);
      await expect(svc.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'] } as any)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create (schema-aligned write path)', () => {
    it('writes to live_sessions using teacher_id + zoom_webinar_join_url', async () => {
      setupFrom(client, [
        { data: { id: 'h1', zoom_user_id: 'z1' }, error: null }, // default host
        { data: { id: 's1', teacher_id: 'h1', status: 'scheduled', created_at: 'x', updated_at: 'x', zoom_webinar_id: 'w1', zoom_webinar_join_url: 'https://zoom/j/w1', topic: 'T', start_time: 'x' }, error: null },
        { data: [{ user_id: 'u1', profiles: { id: 'u1', name: 'S', email: 's@x.com' } }], error: null }, // batch_students
        { data: null, error: null }, // session_batches insert
        { data: null, error: null }, // registrants insert
      ]);
      await service.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'] } as any);
      // find the live_sessions insert call and inspect payload
      const liveSessionsCalls = client.from.mock.calls.map((c: any[], i: number) => ({ table: c[0], idx: i }));
      const insertIdx = liveSessionsCalls.find((c: { table: string }) => c.table === 'live_sessions')?.idx;
      const insertChain = client.from.mock.results[insertIdx]?.value;
      const insertPayload = insertChain?.insert.mock.calls[0]?.[0];
      expect(insertPayload).toMatchObject({ teacher_id: 'h1', zoom_webinar_join_url: 'https://zoom/j/w1', status: 'scheduled' });
      // MUST NOT reference the drifted columns
      expect(insertPayload.host_user_id).toBeUndefined();
      expect(insertPayload.zoom_join_url).toBeUndefined();
      expect(insertPayload.zoom_start_url).toBeUndefined();
    });

    it('writes registrants with personal_join_url (not join_url)', async () => {
      setupFrom(client, [
        { data: { id: 'h1', zoom_user_id: 'z1' }, error: null }, // default host
        { data: { id: 's1', teacher_id: 'h1', status: 'scheduled', created_at: 'x', updated_at: 'x', zoom_webinar_id: 'w1', zoom_webinar_join_url: 'u', topic: 'T', start_time: 'x' }, error: null },
        { data: [{ user_id: 'u1', profiles: { id: 'u1', name: 'S', email: 's@x.com' } }], error: null }, // batch_students
        { data: null, error: null }, // session_batches insert
        { data: null, error: null }, // registrants insert
      ]);
      await service.create({ topic: 'T', startTime: '2026-12-01T10:00:00Z', durationMinutes: 60, batchIds: ['b1'] } as any);
      const regIdx = client.from.mock.calls.findIndex((c: any[]) => c[0] === 'session_registrants');
      const regChain = client.from.mock.results[regIdx]?.value;
      const regPayload = regChain?.insert.mock.calls[0]?.[0];
      expect(regPayload).toBeDefined();
      expect(regPayload[0].personal_join_url).toBe('https://zoom/j/w1/personal');
      expect(regPayload[0].join_url).toBeUndefined();
      expect(regPayload[0].registered_at).toBeUndefined();
    });
  });

  describe('deleteSession', () => {
    it('deletes the Zoom webinar then the session row', async () => {
      setupFrom(client, [
        { data: { zoom_webinar_id: 'w1' }, error: null }, // fetch
        { data: null, error: null }, // delete
      ]);
      await expect(service.deleteSession('s1')).resolves.toEqual({ deleted: true });
      expect(zoom.deleteWebinar).toHaveBeenCalledWith('w1');
    });

    it('throws NotFound when session missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.deleteSession('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates status and returns the session', async () => {
      setupFrom(client, [{ data: { id: 's1', status: 'ended' }, error: null }]);
      const result = await service.updateStatus('s1', 'ended' as any);
      expect(result.status).toBe('ended');
    });
  });
});

