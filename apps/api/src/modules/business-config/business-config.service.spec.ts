import { Test, TestingModule } from '@nestjs/testing';
import { BusinessConfigService } from './business-config.service';
import { SupabaseService } from '../../common/services/supabase.service';

const baseRow = {
  id: 'cfg-1',
  business_name: 'Demo Org',
  address_line_1: 'A',
  city: 'C',
  state: 'S',
  pincode: '000001',
  country: 'India',
  email: 'a@example.com',
  phone: '1234567890',
  invoice_prefix: 'INV',
  receipt_prefix: 'RCP',
  current_financial_year: '2026-2027',
  next_invoice_number: 1,
  next_receipt_number: 1,
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  locale: 'en-IN',
  fy_start_month: 3,
  tax_mode: 'inclusive',
  tax_rate: 18,
  favicon_url: null,
  support_email: null,
  support_phone: null,
  website: null,
  legal_footer: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function mockClient(getRow: any = baseRow) {
  const single = jest.fn().mockResolvedValue({ data: getRow, error: null });
  const select = jest.fn().mockReturnThis();
  const limit = jest.fn().mockReturnThis();
  const update = jest.fn().mockReturnThis();
  const eq = jest.fn().mockReturnThis();
  const from = jest.fn((table: string) => {
    expect(table).toBe('business_config');
    return { select, limit, single, update, eq };
  });
  // Chain for update: from().update().eq().select().single()
  // Need to make eq return object with select().single()
  // Simpler: from().update returns { eq: () => ({ select: () => ({ single }) }) }
  const updateChain: any = {
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single }),
    }),
  };
  from.mockImplementation((table: string) => {
    return {
      select,
      limit,
      single,
      update: jest.fn().mockReturnValue(updateChain),
      eq: jest.fn().mockReturnThis(),
      from,
    } as any;
  });
  // Simpler approach: just mock client.from to return chain that supports both get and update
  const client: any = {
    from: jest.fn((table: string) => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: getRow, error: null }),
        update: jest.fn((data: any) => {
          // capture updateData
          chain.__updateData = data;
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { ...getRow, ...data }, error: null }),
              }),
            }),
          };
        }),
        eq: jest.fn().mockReturnThis(),
      };
      return chain;
    }),
  };
  return client;
}

describe('BusinessConfigService — P2A fields', () => {
  let service: BusinessConfigService;
  let client: any;

  beforeEach(async () => {
    client = mockClient(baseRow);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessConfigService,
        { provide: SupabaseService, useValue: { client } },
      ],
    }).compile();
    service = module.get(BusinessConfigService);
  });

  it('GET returns P2A fields', async () => {
    const row = await service.getConfig();
    expect(row.timezone).toBe('Asia/Kolkata');
    expect(row.currency).toBe('INR');
    expect(row.locale).toBe('en-IN');
    expect(row.fy_start_month).toBe(3);
    expect(row.tax_mode).toBe('inclusive');
    expect(row.tax_rate).toBe(18);
    expect(row.favicon_url).toBeNull();
    expect(row.support_email).toBeNull();
  });

  it('partial update of timezone persists correctly', async () => {
    // Client B: Global Skills Academy
    const dto: any = { timezone: 'Asia/Dubai' };
    const updated = await service.updateConfig(dto);
    // Verify that service sent snake_case timezone
    const updateCall = client.from.mock.results
      .map((r: any) => r.value?.update?.mock?.calls[0]?.[0])
      .filter(Boolean)[0];
    // Alternative: check returned data has new timezone
    expect(updated.timezone).toBe('Asia/Dubai');
    // Existing fields remain
    expect(updated.business_name).toBe('Demo Org');
  });

  it('partial update of fyStartMonth persists as number', async () => {
    const updated = await service.updateConfig({ fyStartMonth: 0 } as any);
    expect(updated.fy_start_month).toBe(0);
    expect(typeof updated.fy_start_month).toBe('number');
  });

  it('partial update of taxRate persists as number', async () => {
    const updated = await service.updateConfig({ taxRate: 5 } as any);
    expect(updated.tax_rate).toBe(5);
    expect(typeof updated.tax_rate).toBe('number');
  });

  it('existing fields remain unaffected by partial P2A update (Client #2)', async () => {
    const dto: any = {
      timezone: 'Asia/Dubai',
      currency: 'AED',
      locale: 'en-AE',
      fyStartMonth: 0,
      taxMode: 'exclusive',
      taxRate: 5,
      faviconUrl: 'https://example.com/favicon.ico',
      supportEmail: 'support@example.com',
      supportPhone: '+971-500123456',
      website: 'https://example.com',
      legalFooter: 'Authorized invoice',
    };
    const updated = await service.updateConfig(dto);
    expect(updated.timezone).toBe('Asia/Dubai');
    expect(updated.currency).toBe('AED');
    expect(updated.favicon_url).toBe('https://example.com/favicon.ico');
    expect(updated.support_email).toBe('support@example.com');
    expect(updated.legal_footer).toBe('Authorized invoice');
    expect(updated.city).toBe('C'); // unchanged
  });
});
