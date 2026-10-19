/*
 * Deployment-scoped session policy — single vs concurrent sessions.
 *
 * Why this file exists:
 *   - Normal/client LMS deployments enforce ONE active session per user
 *     (a new login replaces the previous one). The sales-demo deployment
 *     uses a shared student account and needs MANY concurrent sessions.
 *   - This knob is generic deployment configuration, not demo logic: it
 *     carries no demo account IDs, no tenant IDs, no DEMO_MODE branches.
 *
 * Contract:
 *   - SESSION_POLICY=single → today's behavior, byte-for-byte.
 *   - SESSION_POLICY=multi  → concurrent independent sessions per user.
 *   - unset/empty           → 'single' (backward compatible safe default).
 *   - anything else         → throw: the API must fail fast at startup
 *     instead of silently running the wrong policy. Never default an
 *     invalid value to 'multi'.
 */

export const SESSION_POLICY_VALUES = ['single', 'multi'] as const;

export type SessionPolicy = (typeof SESSION_POLICY_VALUES)[number];

export function resolveSessionPolicy(raw: unknown): SessionPolicy {
  if (raw === undefined || raw === null || raw === '') {
    return 'single';
  }

  if (raw === 'single' || raw === 'multi') {
    return raw;
  }

  throw new Error(
    `Invalid SESSION_POLICY ${JSON.stringify(String(raw))} — allowed values are 'single' or 'multi'. ` +
      `Unset defaults to 'single'. Refusing to start with an unknown session policy.`,
  );
}
