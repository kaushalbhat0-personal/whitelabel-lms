/*
 * Demo-access error classification — sales-demo deployment only.
 *
 * Pure module (no imports, no React): maps transport/HTTP failures from
 * POST /demo/access to fixed user-facing copy. Tested with `tsx --test`
 * (see demo-access-errors.test.ts). The page renders `title` + `message`;
 * NOTHING from the raw response (message/statusText/URLs) is ever shown.
 *
 * Copy contract:
 * - cold start (first-visit Render wake-up): friendly "waking up" state.
 * - rate limit (HTTP 429): wait-before-retry state. Never expose quotas.
 * - disabled (HTTP 404): deployment has no demo. No config details.
 * - anything else: generic unavailable. No internals, no provider names.
 */

export type DemoAccessErrorKind = 'cold-start' | 'rate-limit' | 'disabled' | 'unavailable';

export interface DemoAccessErrorCopy {
  kind: DemoAccessErrorKind;
  /** Rendered as a heading when present (cold-start only). */
  title?: string;
  message: string;
}

export const DEMO_COLD_START_TITLE = 'Getting the demo ready…';
export const DEMO_COLD_START_BODY =
  'Our demo environment is waking up. This can take a few moments on the first visit.';
export const DEMO_COLD_START_ACTION = 'Try again';
export const DEMO_RATE_LIMIT_BODY =
  "You've generated a few demo accounts recently. Please wait a little while before trying again.";
export const DEMO_DISABLED_BODY = 'Demo access is not available on this deployment.';
export const DEMO_UNAVAILABLE_BODY = 'Demo access is unavailable right now. Please try again later.';

/**
 * Neutral message the API returns for its own 503s (rate-limit AND creation
 * failure share it by design). A 503 carrying any OTHER body almost certainly
 * came from the hosting proxy during startup — that is the cold-start case.
 */
const API_NEUTRAL_503 = 'Demo access is temporarily unavailable. Please try again later.';

/**
 * @param status HTTP status, 0 for transport/timeout/parse failures, null when unknown.
 * @param apiMessage response message when the API produced one (never rendered).
 */
export function classifyDemoAccessError(status: number | null, apiMessage?: string): DemoAccessErrorCopy {
  if (status === 404) {
    return { kind: 'disabled', message: DEMO_DISABLED_BODY };
  }
  if (status === 429) {
    return { kind: 'rate-limit', message: DEMO_RATE_LIMIT_BODY };
  }
  if (status === 503) {
    // Own-API 503 (known neutral body) → generic unavailable, so a
    // rate-limited prospect is told to wait rather than hammer Try again.
    if (apiMessage === API_NEUTRAL_503) {
      return { kind: 'unavailable', message: DEMO_UNAVAILABLE_BODY };
    }
    return {
      kind: 'cold-start',
      title: DEMO_COLD_START_TITLE,
      message: DEMO_COLD_START_BODY,
    };
  }
  if (status === null || status === 0 || status === 408 || status === 502 || status === 504) {
    return {
      kind: 'cold-start',
      title: DEMO_COLD_START_TITLE,
      message: DEMO_COLD_START_BODY,
    };
  }
  return { kind: 'unavailable', message: DEMO_UNAVAILABLE_BODY };
}
