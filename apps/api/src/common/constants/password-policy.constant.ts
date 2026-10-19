/*
 * Deployment-scoped password-management policy.
 *
 * Why this file exists:
 *   - Normal/client LMS deployments keep full self-service password
 *     management (forgot/reset/change). The sales-demo deployment uses a
 *     shared student account, so one visitor rotating the credential would
 *     lock out every other concurrent prospect — the operator owns demo
 *     credentials instead.
 *   - This knob is generic deployment configuration, following the exact
 *     SESSION_POLICY convention: no DEMO_MODE, no tenant IDs, no demo
 *     account IDs, no demo branches.
 *
 * Contract:
 *   - PASSWORD_MANAGEMENT=enabled  → normal behavior (forgot/reset/change work).
 *   - PASSWORD_MANAGEMENT=disabled → self-service password flows are blocked
 *     server-side (forgot/change) and hidden in the web UI (forgot/change/
 *     reset pages). Admin/operator rotation paths are unaffected.
 *   - unset/empty                  → 'enabled' (backward compatible safe default).
 *   - anything else                → throw: fail fast at startup, never silently
 *     run with an unknown policy.
 */
export const PASSWORD_MANAGEMENT_VALUES = ['enabled', 'disabled'] as const;

export type PasswordManagementPolicy =
  (typeof PASSWORD_MANAGEMENT_VALUES)[number];

export function resolvePasswordPolicy(raw: unknown): PasswordManagementPolicy {
  if (raw === undefined || raw === null || raw === '') {
    return 'enabled';
  }

  if (raw === 'enabled' || raw === 'disabled') {
    return raw;
  }

  throw new Error(
    `Invalid PASSWORD_MANAGEMENT ${JSON.stringify(String(raw))} — allowed values are 'enabled' or 'disabled'. ` +
      `Unset defaults to 'enabled'. Refusing to start with an unknown password policy.`,
  );
}
