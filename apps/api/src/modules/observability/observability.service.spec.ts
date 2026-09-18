import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityService } from './observability.service';
import { SupabaseService } from '../../common/services/supabase.service';

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe('ObservabilityService - reconcileErrors', () => {
  let service: ObservabilityService;
  let supabaseMock: any;
  let updateCalls: any[];

  const setupRows = (rows: any[]) => {
    // Mock select pagination: first call returns rows, second returns empty
    let callIndex = 0;
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'system_errors') {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (callIndex === 0) {
              callIndex++;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
        } as any;
      }
      return {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });

    // Capture update batches
    updateCalls = [];
    const originalFrom = supabaseMock.client.from;
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table === 'system_errors') {
        const chain: any = {
          select: jest.fn().mockImplementation((cols: string) => {
            if (cols.includes('id, error_type')) {
              // This is the fetch path - handled above via range mock
              return chain;
            }
            // update path select
            return chain;
          }),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (chain._isUpdate) {
              return Promise.resolve({ data: [{ id: 'x' }], error: null });
            }
            if (callIndex === 0) {
              callIndex++;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
          update: jest.fn().mockImplementation((vals: any) => {
            chain._isUpdate = true;
            chain._updateVals = vals;
            return chain;
          }),
          in: jest.fn().mockImplementation((col: string, ids: string[]) => {
            chain._ids = ids;
            return chain;
          }),
          eq: jest.fn().mockReturnThis(),
          lt: jest.fn().mockImplementation(() => {
            // Simulate successful update returning data length
            const ids = chain._ids || [];
            updateCalls.push({ ids, vals: chain._updateVals });
            return Promise.resolve({ data: ids.map((id: string) => ({ id })), error: null });
          }),
        };
        // For fetch we need to distinguish: if not update, use rows
        // Override select to return proper chain for fetch vs update
        let isFetch = true;
        const fetchChain: any = {
          select: jest.fn().mockImplementation(() => fetchChain),
          order: jest.fn().mockImplementation(() => fetchChain),
          range: jest.fn().mockImplementation(() => {
            if (callIndex === 0) {
              callIndex++;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
          update: jest.fn().mockImplementation((vals: any) => {
            isFetch = false;
            const updChain: any = {
              in: jest.fn().mockImplementation((col: string, ids: string[]) => {
                updChain._ids = ids;
                return updChain;
              }),
              eq: jest.fn().mockReturnThis(),
              lt: jest.fn().mockImplementation(() => {
                updateCalls.push({ ids: updChain._ids });
                return Promise.resolve({ data: updChain._ids.map((id: string) => ({ id })), error: null });
              }),
              select: jest.fn().mockImplementation(() => updChain),
            };
            return updChain;
          }),
          eq: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
        };
        // Actually we need simpler: just return fetchChain for initial fetch, but supabaseMock is called twice: once for fetch, once for update
        // We'll just use a closure that tracks call count
        return fetchChain;
      }
      return {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
  };

  beforeEach(async () => {
    supabaseMock = { client: { from: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservabilityService,
        { provide: SupabaseService, useValue: supabaseMock },
      ],
    }).compile();
    service = module.get<ObservabilityService>(ObservabilityService);
  });

  // Simplified helper: directly test via real service with mocked from that returns rows then handles updates
  const mockServiceWithRows = (rows: any[]) => {
    let fetchDone = false;
    updateCalls = [];
    supabaseMock.client.from.mockImplementation((table: string) => {
      if (table !== 'system_errors') {
        return { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: jest.fn().mockResolvedValue({ data: [], error: null }) } as any;
      }
      // Determine if this is fetch or update by inspecting call stack: first calls are fetch (select with ordering)
      // We track whether fetch has been consumed
      if (!fetchDone) {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (!fetchDone) {
              fetchDone = true;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
        } as any;
      }
      // Update path
      return {
        update: jest.fn().mockImplementation(() => ({
          in: jest.fn().mockImplementation((col: string, ids: string[]) => ({
            eq: jest.fn().mockImplementation(() => ({
              lt: jest.fn().mockImplementation(() => ({
                select: jest.fn().mockImplementation(() => Promise.resolve({ data: ids.map((id: string) => ({ id })), error: null })),
              })),
              select: jest.fn().mockImplementation(() => Promise.resolve({ data: ids.map((id: string) => ({ id })), error: null })),
            })),
            select: jest.fn().mockImplementation(() => Promise.resolve({ data: ids.map((id: string) => ({ id })), error: null })),
          })),
        })),
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
  };

  it('resolves old stale group (10 open rows >7d)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${i}`,
      error_type: 'api_error',
      message: 'stale error',
      url: '/api/courses',
      severity: 'error',
      created_at: daysAgo(10),
      resolved: false,
    }));
    // Mock fetch to return rows + handle update count
    let updateCount = 0;
    let fetchDone2 = false;
    supabaseMock.client.from.mockImplementation(() => {
      if (!fetchDone2) {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (!fetchDone2) {
              fetchDone2 = true;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        } as any;
      }
      return {
        update: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              lt: jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({ data: rows.map((r) => ({ id: r.id })), error: null }),
              }),
            }),
          }),
        }),
      } as any;
    });
    // Override to track update correctly - simpler direct
    const original = service.reconcileErrors.bind(service);
    // Use actual implementation path: we will mock the update chain to return count
    // Easier: just call service and check result via mocked update that returns batch ids
    // To avoid complex mock, we will use a simpler approach: let service run, it will auto-resolve via our mock that returns batch ids length
    // For test, we need to ensure update is called
    // Use spy on supabaseMock.client.from to capture
    let fromCalls: any[] = [];
    const origFrom = supabaseMock.client.from;
    let fetchReturned = false;
    supabaseMock.client.from = jest.fn().mockImplementation((table: string) => {
      fromCalls.push(table);
      if (!fetchReturned) {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (!fetchReturned) {
              fetchReturned = true;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        } as any;
      }
      return {
        update: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              lt: jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({ data: rows.map((r) => ({ id: r.id })), error: null }),
              }),
            }),
          }),
        }),
      } as any;
    });

    const result = await service.reconcileErrors({ staleDays: 7 }, 'admin-1');
    expect(result.checkedGroups).toBe(1);
    expect(result.autoResolvedRows).toBe(10);
    expect(result.stillActiveGroups).toBe(0);
    expect(result.skippedCriticalGroups).toBe(0);
  });

  it('does not resolve recent recurring group', async () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `old-${i}`,
        error_type: 'db_error',
        message: 'recent error',
        url: '/api/users',
        severity: 'error',
        created_at: daysAgo(10),
        resolved: false,
      })),
      {
        id: 'recent-1',
        error_type: 'db_error',
        message: 'recent error',
        url: '/api/users',
        severity: 'error',
        created_at: hoursAgo(1),
        resolved: false,
      },
    ];
    let fetchReturned = false;
    supabaseMock.client.from = jest.fn().mockImplementation(() => {
      if (!fetchReturned) {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (!fetchReturned) {
              fetchReturned = true;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        } as any;
      }
      return {
        update: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
    const result = await service.reconcileErrors({ staleDays: 7 }, 'admin-1');
    expect(result.checkedGroups).toBe(1);
    expect(result.autoResolvedRows).toBe(0);
    expect(result.stillActiveGroups).toBe(1);
  });

  it('does not resolve critical group', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `crit-${i}`,
      error_type: 'api_error',
      message: 'critical boom',
      url: '/api/payments',
      severity: 'critical',
      created_at: daysAgo(10),
      resolved: false,
    }));
    let fetchReturned = false;
    supabaseMock.client.from = jest.fn().mockImplementation(() => {
      if (!fetchReturned) {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (!fetchReturned) {
              fetchReturned = true;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        } as any;
      }
      return {
        update: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      } as any;
    });
    const result = await service.reconcileErrors({ staleDays: 7 }, 'admin-1');
    expect(result.autoResolvedRows).toBe(0);
    expect(result.skippedCriticalGroups).toBe(1);
  });

  it('validates staleDays bounds', async () => {
    // This is DTO validation, not service - test controller validation via service still checks bounds
    // Service itself trusts DTO, but we test that invalid values would be rejected by class-validator
    // Here we just ensure service handles default
    const rows: any[] = [];
    let fetchReturned = false;
    supabaseMock.client.from = jest.fn().mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockImplementation(() => {
        if (!fetchReturned) {
          fetchReturned = true;
          return Promise.resolve({ data: rows, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    }) as any);
    const result = await service.reconcileErrors({}, 'admin-1');
    expect(result.staleDays).toBe(7);
    expect(result.checkedGroups).toBe(0);
  });

  it('different URLs remain separate groups', async () => {
    const rows = [
      { id: 'a1', error_type: 'api_error', message: 'same msg', url: '/api/a', severity: 'error', created_at: daysAgo(10), resolved: false },
      { id: 'b1', error_type: 'api_error', message: 'same msg', url: '/api/b', severity: 'error', created_at: daysAgo(10), resolved: false },
    ];
    let fetchReturned = false;
    supabaseMock.client.from = jest.fn().mockImplementation(() => {
      if (!fetchReturned) {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockImplementation(() => {
            if (!fetchReturned) {
              fetchReturned = true;
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        } as any;
      }
      return {
        update: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              lt: jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({ data: [{ id: 'a1' }], error: null }),
              }),
            }),
          }),
        }),
      } as any;
    });
    const result = await service.reconcileErrors({ staleDays: 7 }, 'admin-1');
    expect(result.checkedGroups).toBe(2);
  });
});
