import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { SupabaseService } from '../../common/services/supabase.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    upsert: jest.fn(),
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

describe('AttendanceService', () => {
  let service: AttendanceService;
  let client: any;

  beforeEach(async () => {
    client = { from: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendanceService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(AttendanceService);
  });

  describe('getBatchAttendanceReport (s.users -> s.profiles fix)', () => {
    it('maps students via profiles embed (not users)', async () => {
      setupFrom(client, [
        { data: { id: 'b1', name: 'Batch A' }, error: null }, // batch
        { data: [{ session_id: 's1', live_sessions: { id: 's1', topic: 'T', start_time: 'x', status: 'ended' } }], error: null }, // sessions
        { data: [{ user_id: 'u1', profiles: { id: 'u1', name: 'Alice', email: 'a@x.com' } }], error: null }, // students
        { data: [{ session_id: 's1', user_id: 'u1', status: 'present' }], error: null }, // attendance
      ]);
      const result = await service.getBatchAttendanceReport('b1');
      expect(result.batchName).toBe('Batch A');
      expect(result.students).toHaveLength(1);
      expect(result.students[0].name).toBe('Alice'); // would be undefined if s.users bug remained
      expect(result.students[0].attendance['s1']).toBe('present');
      expect(result.students[0].percentage).toBe(100);
    });
  });

  describe('getStudentAttendance', () => {
    it('returns summary + records', async () => {
      setupFrom(client, [
        { data: [{ session_id: 's1', live_sessions: { id: 's1', topic: 'T', start_time: 'x', status: 'ended' } }], error: null }, // registrations
        { data: [{ session_id: 's1', status: 'present' }], error: null }, // attendance
      ]);
      const result = await service.getStudentAttendance('u1');
      expect(result.summary.total).toBe(1);
      expect(result.summary.present).toBe(1);
      expect(result.records[0].sessionId).toBe('s1');
    });

    it('returns empty when no registrations', async () => {
      setupFrom(client, [{ data: [], error: null }]);
      const result = await service.getStudentAttendance('u1');
      expect(result.summary.total).toBe(0);
    });
  });

  describe('markManual', () => {
    it('rejects when session has not ended', async () => {
      setupFrom(client, [{ data: { id: 's1', status: 'scheduled' }, error: null }]);
      await expect(service.markManual({ sessionId: 's1', entries: [] } as any, 't1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('upserts attendance for an ended session', async () => {
      const q = mockQuery({ data: null, error: null });
      q.upsert.mockResolvedValue({ error: null });
      client.from.mockImplementation(() => q);
      q.single.mockResolvedValueOnce({ data: { id: 's1', status: 'ended' }, error: null });
      const result = await service.markManual({ sessionId: 's1', entries: [{ userId: 'u1', status: 'present' }] } as any, 't1');
      expect(result.updatedCount).toBe(1);
    });
  });

  describe('getSessionAttendance', () => {
    it('throws NotFound when session missing', async () => {
      setupFrom(client, [{ data: null, error: new Error('x') }]);
      await expect(service.getSessionAttendance('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
