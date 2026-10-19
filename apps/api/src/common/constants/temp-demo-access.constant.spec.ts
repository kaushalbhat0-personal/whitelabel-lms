import { resolveTempDemoAccessPolicy } from './temp-demo-access.constant';

describe('resolveTempDemoAccessPolicy', () => {
  it.each([undefined, null, ''])('unset/empty (%p) defaults to disabled', (raw) => {
    expect(resolveTempDemoAccessPolicy(raw)).toBe('disabled');
  });

  it('accepts the allowed values verbatim', () => {
    expect(resolveTempDemoAccessPolicy('enabled')).toBe('enabled');
    expect(resolveTempDemoAccessPolicy('disabled')).toBe('disabled');
  });

  it.each(['foo', 'ENABLED', 'Enabled', ' enabled', 'enabled ', '1', 'true', 'on', 'all', 0, 1, true, {}, []])(
    'rejects invalid value %p (must fail fast, never silently coerce)',
    (raw) => {
      expect(() => resolveTempDemoAccessPolicy(raw)).toThrow(/TEMP_DEMO_ACCESS/);
    },
  );
});
