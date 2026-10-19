import { resolveZoomEnabled } from './zoom-enabled.constant';

describe('resolveZoomEnabled', () => {
  it.each([undefined, null, ''])('unset/empty (%p) defaults to enabled (backward compatible)', (raw) => {
    expect(resolveZoomEnabled(raw)).toBe('enabled');
  });

  it('accepts the allowed values verbatim', () => {
    expect(resolveZoomEnabled('enabled')).toBe('enabled');
    expect(resolveZoomEnabled('disabled')).toBe('disabled');
  });

  it.each(['foo', 'ENABLED', 'Disabled', ' enabled', 'disabled ', '0', 'true', 'yes', 0, 1, true, {}, []])(
    'rejects invalid value %p (must fail fast, never silently coerce)',
    (raw) => {
      expect(() => resolveZoomEnabled(raw)).toThrow(/ZOOM_ENABLED/);
    },
  );
});
