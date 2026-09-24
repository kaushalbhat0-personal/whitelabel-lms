import { Test, TestingModule } from '@nestjs/testing';
import { BusinessConfigService } from './business-config.service';
import { SupabaseService } from '../../common/services/supabase.service';
import {
  DEFAULT_THEME_PRIMARY,
  DEFAULT_THEME_SIDEBAR_BG,
  DEFAULT_THEME_ACCENT,
} from '../../common/config/defaults';

const baseRow: any = {
  id: 'cfg-1',
  business_name: 'Demo Org',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  locale: 'en-IN',
  theme_json: null,
};

function makeClient(getRow: any = baseRow) {
  const client: any = {
    from: jest.fn((table: string) => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: getRow, error: null }),
        update: jest.fn((data: any) => ({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { ...getRow, ...data }, error: null }),
            }),
          }),
        })),
        eq: jest.fn().mockReturnThis(),
      };
      return chain;
    }),
  };
  return client;
}

describe('BusinessConfigService — theme_json COMM-01B-A', () => {
  let service: BusinessConfigService;

  async function createWithRow(row: any) {
    const client = makeClient(row);
    const module: TestingModule = await Test.createTestingModule({
      providers: [BusinessConfigService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(BusinessConfigService);
    return { service, client };
  }

  it('public config returns validated GSA theme_json', async () => {
    const { service } = await createWithRow({
      ...baseRow,
      theme_json: { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' },
    });
    const pub: any = await service.getPublicConfig();
    expect(pub.theme_json).toEqual({ primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' });
  });

  it('NULL theme_json returns safe fallback (DEFAULT_THEME_*)', async () => {
    const { service } = await createWithRow({ ...baseRow, theme_json: null });
    const pub: any = await service.getPublicConfig();
    expect(pub.theme_json.primary).toBe(DEFAULT_THEME_PRIMARY);
    expect(pub.theme_json.sidebarBg).toBe(DEFAULT_THEME_SIDEBAR_BG);
    expect(pub.theme_json.accent).toBe(DEFAULT_THEME_ACCENT);
  });

  it('undefined theme_json returns fallback', async () => {
    const { service } = await createWithRow({ ...baseRow, theme_json: undefined });
    const pub: any = await service.getPublicConfig();
    expect(pub.theme_json.primary).toBe(DEFAULT_THEME_PRIMARY);
  });

  it('partial theme values fall back independently', async () => {
    const { service } = await createWithRow({
      ...baseRow,
      theme_json: { primary: '#2563EB' }, // only primary
    });
    const pub: any = await service.getPublicConfig();
    expect(pub.theme_json.primary).toBe('#2563EB');
    expect(pub.theme_json.sidebarBg).toBe(DEFAULT_THEME_SIDEBAR_BG);
    expect(pub.theme_json.accent).toBe(DEFAULT_THEME_ACCENT);
  });

  it('partial with only accent falls back others', async () => {
    const { service } = await createWithRow({
      ...baseRow,
      theme_json: { accent: '#60A5FA' },
    });
    const pub: any = await service.getPublicConfig();
    expect(pub.theme_json.accent).toBe('#60A5FA');
    expect(pub.theme_json.primary).toBe(DEFAULT_THEME_PRIMARY);
  });

  it('invalid hex in DB falls back to defaults (never propagates)', async () => {
    const { service } = await createWithRow({
      ...baseRow,
      theme_json: { primary: 'rgb(0,0,0)', sidebarBg: '#1E3A8A', accent: 'evil' },
    });
    const pub: any = await service.getPublicConfig();
    expect(pub.theme_json.primary).toBe(DEFAULT_THEME_PRIMARY);
    expect(pub.theme_json.sidebarBg).toBe('#1E3A8A'); // valid stays
    expect(pub.theme_json.accent).toBe(DEFAULT_THEME_ACCENT);
  });

  it('public config never exposes GSTIN/PAN and still includes theme_json', async () => {
    const { service } = await createWithRow({
      ...baseRow,
      gstin: 'GST123',
      pan: 'PAN123',
      theme_json: { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' },
    });
    const pub: any = await service.getPublicConfig();
    expect(pub.gstin).toBeUndefined();
    expect(pub.pan).toBeUndefined();
    expect(pub.theme_json).toBeDefined();
  });

  it('updateConfig merges partial theme onto existing (preserves missing fields)', async () => {
    const existing = { ...baseRow, theme_json: { primary: '#111111', sidebarBg: '#222222', accent: '#333333' } };
    const client = makeClient(existing);
    const module: TestingModule = await Test.createTestingModule({
      providers: [BusinessConfigService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(BusinessConfigService);

    // Capture updateData
    let captured: any = null;
    const originalFrom = client.from;
    client.from = jest.fn((table: string) => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: existing, error: null }),
        update: jest.fn((data: any) => {
          captured = data;
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { ...existing, ...data }, error: null }),
              }),
            }),
          };
        }),
        eq: jest.fn().mockReturnThis(),
      };
      return chain;
    });

    await service.updateConfig({ themeJson: { primary: '#2563EB' } } as any);
    expect(captured.theme_json.primary).toBe('#2563EB');
    expect(captured.theme_json.sidebarBg).toBe('#222222');
    expect(captured.theme_json.accent).toBe('#333333');
  });
});
