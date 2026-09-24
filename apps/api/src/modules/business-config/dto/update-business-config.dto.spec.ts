import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBusinessConfigDto } from './update-business-config.dto';

describe('UpdateBusinessConfigDto — P2A fields', () => {
  async function validateDto(payload: Record<string, any>) {
    const dto = plainToInstance(UpdateBusinessConfigDto, payload);
    return validate(dto);
  }

  it('accepts valid P2A configuration', async () => {
    const errors = await validateDto({
      timezone: 'Asia/Dubai',
      currency: 'AED',
      locale: 'en-AE',
      fyStartMonth: 0,
      taxMode: 'zero',
      taxRate: 0,
      faviconUrl: 'https://example.com/favicon.ico',
      supportEmail: 'support@example.com',
      supportPhone: '+971-500123456',
      website: 'https://example.com',
      legalFooter: 'Authorized invoice',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts empty object (all optional)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid fy_start_month out of range', async () => {
    for (const v of [-1, 12, 99]) {
      const errors = await validateDto({ fyStartMonth: v });
      expect(errors.some((e) => e.property === 'fyStartMonth')).toBe(true);
    }
  });

  it('rejects non-integer fy_start_month', async () => {
    const errors = await validateDto({ fyStartMonth: 3.5 as any });
    expect(errors.some((e) => e.property === 'fyStartMonth')).toBe(true);
  });

  it('rejects invalid tax_mode', async () => {
    const errors = await validateDto({ taxMode: 'invalid' as any });
    expect(errors.some((e) => e.property === 'taxMode')).toBe(true);
  });

  it('accepts valid tax_mode values', async () => {
    for (const mode of ['inclusive', 'exclusive', 'zero']) {
      const errors = await validateDto({ taxMode: mode });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects tax_rate outside 0-100', async () => {
    for (const v of [-1, 101]) {
      const errors = await validateDto({ taxRate: v });
      expect(errors.some((e) => e.property === 'taxRate')).toBe(true);
    }
  });

  it('accepts tax_rate at boundaries', async () => {
    for (const v of [0, 18, 100]) {
      const errors = await validateDto({ taxRate: v });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects invalid faviconUrl and website', async () => {
    const fav = await validateDto({ faviconUrl: 'not-a-url' });
    expect(fav.some((e) => e.property === 'faviconUrl')).toBe(true);
    const site = await validateDto({ website: 'not-a-url' });
    expect(site.some((e) => e.property === 'website')).toBe(true);
  });

  it('rejects invalid supportEmail', async () => {
    const errors = await validateDto({ supportEmail: 'not-an-email' });
    expect(errors.some((e) => e.property === 'supportEmail')).toBe(true);
  });

  it('handles optional fields correctly (null/undefined omitted)', async () => {
    // legalFooter optional string, empty is allowed? MinLength not set, so empty string passes IsString check
    // faviconUrl undefined should not trigger IsUrl
    const errors = await validateDto({ faviconUrl: undefined, supportEmail: undefined });
    expect(errors).toHaveLength(0);
  });
});
