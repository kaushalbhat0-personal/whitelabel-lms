/*
 * Deployment-scoped live-class switch — recorded-only vs live + recorded.
 *
 * Why this file exists:
 *   - A client can run a fully recorded LMS with no Zoom account. Without an
 *     explicit switch, live calls fail with a generic 500 deep inside the
 *     Zoom client when credentials are absent — indistinguishable from an
 *     outage. This knob makes the deployment intent explicit and the failure
 *     intentional (503) at the live-operation boundary.
 *   - Like SESSION_POLICY / PASSWORD_MANAGEMENT / TEMP_DEMO_ACCESS, this is
 *     generic deployment configuration: no tenant IDs, no DEMO_MODE branches.
 *
 * Contract:
 *   - ZOOM_ENABLED=true    → live Zoom operations allowed (requires Zoom creds).
 *   - ZOOM_ENABLED=false   → recorded-only: live operations reject with 503.
 *   - unset/empty          → 'enabled' (backward compatible: preserves the
 *     exact behavior of every existing deployment, which attempted Zoom).
 *   - anything else        → throw: the API must fail fast at startup
 *     instead of silently running with an unknown live-class posture.
 */

export const ZOOM_ENABLED_VALUES = ['enabled', 'disabled'] as const;

export type ZoomEnabled = (typeof ZOOM_ENABLED_VALUES)[number];

export function resolveZoomEnabled(raw: unknown): ZoomEnabled {
  if (raw === undefined || raw === null || raw === '') {
    return 'enabled';
  }

  if (raw === 'enabled' || raw === 'disabled') {
    return raw;
  }

  throw new Error(
    `Invalid ZOOM_ENABLED ${JSON.stringify(String(raw))} — allowed values are 'enabled' or 'disabled'. ` +
      `Unset defaults to 'enabled'. Refusing to start with an unknown live-class posture.`,
  );
}
