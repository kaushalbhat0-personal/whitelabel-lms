import { resolvePasswordPolicy } from './password-policy.constant';

describe('resolvePasswordPolicy', () => {
  it.each([undefined, null, ''])('unset/empty (%p) defaults to enabled', (raw) => {
    expect(resolvePasswordPolicy(raw)).toBe('enabled');
  });

  it('accepts the allowed values verbatim', () => {
    expect(resolvePasswordPolicy('enabled')).toBe('enabled');
    expect(resolvePasswordPolicy('disabled')).toBe('disabled');
  });

  it.each(['foo', 'DISABLED', 'Enabled', ' disabled', '0', 'true', 'all', 0, 1, true, {}, []])(
    'rejects invalid value %p (must fail fast, never silently coerce)',
    (raw) => {
      expect(() => resolvePasswordPolicy(raw)).toThrow(/PASSWORD_MANAGEMENT/);
    },
  );
});
