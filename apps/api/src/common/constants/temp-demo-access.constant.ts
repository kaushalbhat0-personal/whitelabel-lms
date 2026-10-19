/*
 * Deployment-scoped temporary demo access capability.
 *
 * Why this file exists:
 *   - The sales-demo deployment needs per-prospect temporary demo accounts
 *     that expire automatically (≈30 minutes). Client deployments must never
 *     expose account issuance.
 *   - This knob is generic deployment configuration, following the exact
 *     SESSION_POLICY / PASSWORD_MANAGEMENT convention: no DEMO_MODE, no
 *     tenant IDs, no demo account IDs, no demo branches.
 *
 * Contract:
 *   - TEMP_DEMO_ACCESS=enabled  → POST /demo/access is exposed.
 *   - TEMP_DEMO_ACCESS=disabled → endpoint behaves as absent (404).
 *   - unset/empty               → 'disabled' (safe default; clients unaffected).
 *   - anything else             → throw: the API must fail fast at startup
 *     instead of silently enabling or disabling issuance.
 */

export const TEMP_DEMO_ACCESS_VALUES = ['enabled', 'disabled'] as const;

export type TempDemoAccessPolicy =
  (typeof TEMP_DEMO_ACCESS_VALUES)[number];

export function resolveTempDemoAccessPolicy(
  raw: unknown,
): TempDemoAccessPolicy {
  if (raw === undefined || raw === null || raw === '') {
    return 'disabled';
  }

  if (raw === 'enabled' || raw === 'disabled') {
    return raw;
  }

  throw new Error(
    `Invalid TEMP_DEMO_ACCESS ${JSON.stringify(String(raw))} — allowed values are 'enabled' or 'disabled'. ` +
      `Unset defaults to 'disabled'. Refusing to start with an unknown demo-access policy.`,
  );
}
