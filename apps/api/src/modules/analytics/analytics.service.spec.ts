import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { SupabaseService } from '../../common/services/supabase.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let client: any;

  beforeEach(async () => {
    client = { from: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(AnalyticsService);
  });

  describe('getAdminOverview', () => {
    it('aggregates 4 parallel queries', async () => {
      // studentCount query resolves via select().eq() (thenable)
      const mkChain = (value: any) => {
        const q: any = {
          select: jest.fn(() => q),
          eq: jest.fn(() => q),
          gte: jest.fn(() => q),
          order: jest.fn(() => q),
          limit: jest.fn(() => q),
          head: jest.fn(() => q),
        };
        q.then = (onF: any) => Promise.resolve(value).then(onF);
        return q;
      };
      client.from
        .mockImplementationOnce(() => mkChain({ count: 6, data: null }))      // students
        .mockImplementationOnce(() => mkChain({ data: [{ amount: 100 }, { amount: 50 }] })) // payments
        .mockImplementationOnce(() => mkChain({ count: 3, data: null }))      // courses
        .mockImplementationOnce(() => mkChain({ data: [{ id: 's1', topic: 'T', start_time: 'x', duration_minutes: 60 }] })); // sessions

      const result = await service.getAdminOverview();
      expect(result.studentCount).toBe(6);
      expect(result.totalRevenue).toBe(150);
      expect(result.activeCourses).toBe(3);
      expect(result.upcomingSessions).toHaveLength(1);
      expect(result.upcomingSessions[0].topic).toBe('T');
    });

    it('gracefully handles query failures', async () => {
      const mkFail = (v: any) => {
        const q: any = { select: jest.fn(() => q), eq: jest.fn(() => q), gte: jest.fn(() => q), order: jest.fn(() => q), limit: jest.fn(() => q), head: jest.fn(() => q) };
        q.then = (_: any, onR: any) => Promise.reject(new Error('boom')).then(_ as any, onR);
        return q;
      };
      client.from
        .mockImplementationOnce(() => mkFail({}))
        .mockImplementationOnce(() => mkFail({}))
        .mockImplementationOnce(() => mkFail({}))
        .mockImplementationOnce(() => mkFail({}));
      const result = await service.getAdminOverview();
      expect(result.studentCount).toBe(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.activeCourses).toBe(0);
      expect(result.upcomingSessions).toEqual([]);
    });
  });
});
