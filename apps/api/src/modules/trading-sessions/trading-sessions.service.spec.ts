import { Test, TestingModule } from '@nestjs/testing';
import { TradingSessionsService } from './trading-sessions.service';
import { LiveSessionsService } from '../live-sessions/live-sessions.service';

describe('TradingSessionsService (compat layer)', () => {
  let service: TradingSessionsService;
  let live: any;

  beforeEach(async () => {
    live = {
      create: jest.fn(),
      findAll: jest.fn(),
      deleteSession: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingSessionsService,
        { provide: LiveSessionsService, useValue: live },
      ],
    }).compile();
    service = module.get(TradingSessionsService);
  });

  describe('create', () => {
    it('delegates to LiveSessionsService with mapped fields + preserves legacy shape', async () => {
      live.create.mockResolvedValue({
        id: 's1',
        zoom_webinar_id: 'w1',
        start_time: '2026-12-01T10:00:00Z',
        topic: 'Nifty Class',
        status: 'scheduled',
        created_at: 'x',
        updated_at: 'x',
        batches: ['b1'],
      });
      const result = await service.create({
        title: 'Nifty Class',
        startTime: '2026-12-01T10:00:00Z',
        durationMinutes: 60,
        batchIds: ['b1'],
      });
      // Legacy create is called with mapped fields (title -> topic, no teacher)
      expect(live.create).toHaveBeenCalledWith({
        topic: 'Nifty Class',
        startTime: '2026-12-01T10:00:00Z',
        durationMinutes: 60,
        batchIds: ['b1'],
      });
      // Response preserved the legacy ScheduledSession contract
      expect(result).toMatchObject({
        id: 's1',
        zoom_meeting_id: 'w1',
        title: 'Nifty Class',
        is_live: false,
        start_time: '2026-12-01T10:00:00Z',
      });
      expect(result.joinUrl).toBeDefined();
    });

    it('maps is_live=true when canonical status is live', async () => {
      live.create.mockResolvedValue({
        id: 's1', zoom_webinar_id: 'w1', start_time: 'x', topic: 'T', status: 'live', created_at: 'x', updated_at: 'x', batches: [],
      });
      const result = await service.create({ title: 'T', startTime: 'x', durationMinutes: 60, batchIds: ['b1'] });
      expect(result.is_live).toBe(true);
    });
  });

  describe('findAll', () => {
    it('delegates and maps each item to legacy shape', async () => {
      live.findAll.mockResolvedValue({
        items: [
          { id: 's1', zoom_webinar_id: 'w1', start_time: 'x', topic: 'T', status: 'scheduled', created_at: 'x', updated_at: 'x', batchNames: ['A'] },
        ],
        total: 1, page: 1, limit: 500,
      });
      const result = await service.findAll();
      expect(live.findAll).toHaveBeenCalledWith(1, 500);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 's1', zoom_meeting_id: 'w1', title: 'T', is_live: false, batchNames: ['A'] });
    });
  });

  describe('remove', () => {
    it('delegates to deleteSession and returns legacy shape', async () => {
      live.deleteSession.mockResolvedValue({ deleted: true });
      const result = await service.remove('s1');
      expect(live.deleteSession).toHaveBeenCalledWith('s1');
      expect(result).toEqual({ success: true, deletedId: 's1' });
    });
  });
});
