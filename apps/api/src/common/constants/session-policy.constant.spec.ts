import { resolveSessionPolicy } from './session-policy.constant';

describe('resolveSessionPolicy', () => {
  it.each([undefined, null, ''])('unset/empty (%p) defaults to single', (raw) => {
    expect(resolveSessionPolicy(raw)).toBe('single');
  });

  it('accepts the allowed values verbatim', () => {
    expect(resolveSessionPolicy('single')).toBe('single');
    expect(resolveSessionPolicy('multi')).toBe('multi');
  });

  it.each(['foo', 'MULTI', 'Single', 'SINGLE', ' multi', 'multi ', '0', 'true', 'all', 0, 1, true, {}, []])(
    'rejects invalid value %p (must fail fast, never silently coerce)',
    (raw) => {
      expect(() => resolveSessionPolicy(raw)).toThrow(/SESSION_POLICY/);
    },
  );
});
