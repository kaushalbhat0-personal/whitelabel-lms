import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBusinessConfigDto } from './update-business-config.dto';

async function validateDto(payload: Record<string, any>) {
  const dto = plainToInstance(UpdateBusinessConfigDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('ThemeJson DTO — COMM-01B-A', () => {
  it('accepts valid GSA theme #2563EB #1E3A8A #60A5FA', async () => {
    const errors = await validateDto({
      themeJson: { primary: '#2563EB', sidebarBg: '#1E3A8A', accent: '#60A5FA' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts uppercase and lowercase hex', async () => {
    const errorsLower = await validateDto({ themeJson: { primary: '#2563eb' } });
    expect(errorsLower).toHaveLength(0);
    const errorsUpper = await validateDto({ themeJson: { primary: '#2563EB' } });
    expect(errorsUpper).toHaveLength(0);
    const errorsMixed = await validateDto({ themeJson: { primary: '#aBcDeF' } });
    expect(errorsMixed).toHaveLength(0);
  });

  it('accepts empty themeJson (all optional) and undefined', async () => {
    expect((await validateDto({ themeJson: {} })).length).toBe(0);
    expect((await validateDto({})).length).toBe(0);
  });

  it('accepts partial theme (single field)', async () => {
    expect((await validateDto({ themeJson: { primary: '#10b981' } })).length).toBe(0);
    expect((await validateDto({ themeJson: { accent: '#f59e0b' } })).length).toBe(0);
  });

  for (const bad of [
    'rgb(0,0,0)',
    'rgba(0,0,0,0.5)',
    'hsl(0, 0%, 0%)',
    'url(https://evil)',
    '#12345',
    '#1234567',
    'red',
    '#GGGGGG',
    'var(--brand-primary)',
    'linear-gradient(red, blue)',
    '<script>',
    '#10b981;',
    '#10b981()',
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, async () => {
      const errors = await validateDto({ themeJson: { primary: bad as any } });
      expect(errors.length).toBeGreaterThan(0);
      // Nested validation: error inside themeJson
      const hasThemeError = errors.some((e) => e.property === 'themeJson');
      expect(hasThemeError).toBe(true);
    });
  }

  it('rejects short hex #fff and #123', async () => {
    // Must be exactly #RRGGBB, not #RGB
    const e1 = await validateDto({ themeJson: { primary: '#fff' } });
    expect(e1.length).toBeGreaterThan(0);
    const e2 = await validateDto({ themeJson: { primary: '#123' } });
    expect(e2.length).toBeGreaterThan(0);
  });

  it('rejects unknown keys (forbidNonWhitelisted)', async () => {
    const errors = await validateDto({
      themeJson: { primary: '#10b981', evil: 'red', unknownKey: '#ffffff' } as any,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects values containing <, ;, (, ) via hex validation', async () => {
    for (const v of ['#10b98<', '#10b981;', '#10b981(', '#10b981)']) {
      const errors = await validateDto({ themeJson: { primary: v as any } });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects non-string theme values', async () => {
    const errors = await validateDto({ themeJson: { primary: 123 as any } });
    expect(errors.length).toBeGreaterThan(0);
  });
});
