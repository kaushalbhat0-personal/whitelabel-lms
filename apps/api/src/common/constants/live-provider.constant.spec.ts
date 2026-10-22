import { resolveLiveProvider } from './live-provider.constant';

describe('resolveLiveProvider', () => {
  it.each(['zoom', 'google-meet', 'none'] as const)(
    'accepts the allowed value %p verbatim',
    (raw) => {
      expect(resolveLiveProvider(raw)).toBe(raw);
    },
  );

  it.each(['foo', 'ZOOM', 'Zoom', ' zoom', 'zoom ', 'disabled', 'enabled', '0', 'true', 0, 1, true, {}, []])(
    'rejects invalid value %p (must fail fast, never silently coerce)',
    (raw) => {
      expect(() => resolveLiveProvider(raw)).toThrow(/LIVE_PROVIDER/);
    },
  );

  it.each([undefined, null, ''] as const)(
    'unset/empty (%p) defaults to zoom (backward compatible)',
    (raw) => {
      expect(resolveLiveProvider(raw)).toBe('zoom');
    },
  );

  it('unset with ZOOM_ENABLED=disabled resolves to none (recorded-only compat)', () => {
    expect(resolveLiveProvider(undefined, { zoomEnabled: 'disabled' })).toBe('none');
    expect(resolveLiveProvider('', { zoomEnabled: 'disabled' })).toBe('none');
  });

  it('unset with ZOOM_ENABLED=enabled resolves to zoom', () => {
    expect(resolveLiveProvider(undefined, { zoomEnabled: 'enabled' })).toBe('zoom');
  });

  it('explicit LIVE_PROVIDER takes precedence over ZOOM_ENABLED', () => {
    // Recorded-only operator intent is expressed via LIVE_PROVIDER=none.
    expect(resolveLiveProvider('none', { zoomEnabled: 'enabled' })).toBe('none');
    // Explicit zoom intent wins even if the legacy knob disagrees.
    expect(resolveLiveProvider('zoom', { zoomEnabled: 'disabled' })).toBe('zoom');
  });
});
