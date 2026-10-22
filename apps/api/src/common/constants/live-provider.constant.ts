/*
 * Canonical live-class provider selector — zoom | google-meet | none.
 *
 * Why this file exists:
 *   - LiveSessionsService depends on the LIVE_PROVIDER interface, but until
 *     this phase the LiveProviderModule hardcoded that token to
 *     ZoomLiveProvider. Deployments could only choose live-vs-recorded via
 *     ZOOM_ENABLED, never which provider backs live classes.
 *   - LIVE_PROVIDER is the single deployment-scoped knob that answers "which
 *     live-class provider backs this deployment". Like SESSION_POLICY /
 *     PASSWORD_MANAGEMENT / ZOOM_ENABLED, it is generic deployment
 *     configuration: no tenant IDs, no DEMO_MODE branches.
 *
 * Contract:
 *   - 'zoom'        → Zoom webinars via ZoomLiveProvider (existing behavior).
 *   - 'google-meet' → reserved for the future Google Meet adapter
 *                      (RCCF-LIVE-GMEET-04). The module fails fast when this
 *                      is selected until that phase lands — never silently
 *                      falls back to Zoom.
 *   - 'none'        → recorded-only: live operations reject with an
 *                      intentional 503 (DisabledLiveProvider).
 *   - unset/empty   → backward compatible: 'none' when ZOOM_ENABLED=disabled
 *                      (existing recorded-only deployments keep working),
 *                      otherwise 'zoom' (existing Zoom deployments keep
 *                      working exactly as before).
 *   - anything else → throw: the API must fail fast at startup instead of
 *                      silently running with an unknown provider posture.
 *
 * Precedence:
 *   - An explicitly set LIVE_PROVIDER wins over ZOOM_ENABLED. ZOOM_ENABLED
 *     is retained only as a backward-compatibility input (and is still
 *     fail-fast validated for shape in main.ts). New deployments should set
 *     LIVE_PROVIDER and treat ZOOM_* as Zoom-provider credentials, not as
 *     the live-availability switch.
 */

export const LIVE_PROVIDER_VALUES = ['zoom', 'google-meet', 'none'] as const;

export type LiveProviderName = (typeof LIVE_PROVIDER_VALUES)[number];

export function resolveLiveProvider(
  raw: unknown,
  opts?: { zoomEnabled?: unknown },
): LiveProviderName {
  if (raw === undefined || raw === null || raw === '') {
    // Backward compatibility for deployments created before the selector
    // existed: they only know ZOOM_ENABLED.
    if (opts?.zoomEnabled === 'disabled') {
      return 'none';
    }
    return 'zoom';
  }

  if (raw === 'zoom' || raw === 'google-meet' || raw === 'none') {
    return raw;
  }

  throw new Error(
    `Invalid LIVE_PROVIDER ${JSON.stringify(String(raw))} — allowed values are 'zoom', 'google-meet', or 'none'. ` +
      `Unset defaults to 'zoom' (or 'none' when ZOOM_ENABLED=disabled). Refusing to start with an unknown live-class provider.`,
  );
}
