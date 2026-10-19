/**
 * Provider state probes (read-only, no account provisioning).
 *
 * Honesty rule: without a live backend signal the probe reports the DECLARED
 * state from the client config (what the operator selected). Live evidence
 * collected during verification (e.g. an upload attempt returning 503) is
 * attached as OBSERVED evidence and may upgrade a state to a confirmed one.
 * Never claim CONFIGURED/OPERATIONAL without evidence.
 */

import type { ClientConfig } from './types';

export type ProviderState =
  | 'READY' // declared + live evidence of operation
  | 'DECLARED' // selected in config, not yet proven live
  | 'DORMANT' // compiled in, intentionally off
  | 'STUB' // safe fallback mode (emails logged, not sent)
  | 'NOT_CONFIGURED' // explicitly off for this client
  | 'CONTRADICTION'; // declared one thing, observed another

export interface ProviderProbe {
  provider: 'bunny' | 'mux' | 'resend' | 'zoom';
  state: ProviderState;
  reason: string;
}

/** Optional live evidence (all fields optional; absence = declared-only report). */
export interface ProviderEvidence {
  /** Result of an upload attempt with an admin token (no file needed). */
  uploadProbeStatus?: number;
  /** True when the operator confirmed stub-mode log lines (Resend deferred). */
  emailStubObserved?: boolean;
  /** True when a welcome/test email actually delivered. */
  emailDelivered?: boolean;
}

export function probeProviders(config: ClientConfig, evidence: ProviderEvidence = {}): ProviderProbe[] {
  const out: ProviderProbe[] = [];
  const video = config.providers.video;

  if (video === 'bunny') {
    if (evidence.uploadProbeStatus === 503) {
      out.push({ provider: 'bunny', state: 'CONTRADICTION', reason: 'Declared bunny, but upload probe returned 503 (BUNNY_* missing/disabled). Fix Render ENV.' });
    } else if (evidence.uploadProbeStatus !== undefined && evidence.uploadProbeStatus !== 401 && evidence.uploadProbeStatus !== 403) {
      out.push({ provider: 'bunny', state: 'READY', reason: `Upload probe returned ${evidence.uploadProbeStatus} (route live past auth).` });
    } else {
      out.push({ provider: 'bunny', state: 'DECLARED', reason: 'Selected in config. Confirm uploads succeed post-deploy; 503 at upload time means BUNNY_* is wrong.' });
    }
  } else {
    out.push({ provider: 'bunny', state: video === 'none' ? 'NOT_CONFIGURED' : 'DORMANT', reason: video === 'none' ? 'Video uploads disabled for this client (503 fail-visible by design).' : 'Mux is the upload path; Bunny stays off.' });
  }

  if (video === 'mux') {
    out.push({ provider: 'mux', state: 'DECLARED', reason: 'Emergency-rollback path selected. Confirm Mux upload works before relying on it.' });
  } else {
    out.push({ provider: 'mux', state: 'DORMANT', reason: 'Compiled in, intentionally off. Enable only via VIDEO_UPLOAD_PROVIDER=mux rollback.' });
  }

  if (config.providers.email === 'resend') {
    if (evidence.emailDelivered) {
      out.push({ provider: 'resend', state: 'READY', reason: 'Test/welcome email delivered on a verified sender domain.' });
    } else {
      out.push({ provider: 'resend', state: 'DECLARED', reason: 'Selected in config. Verify sender domain + delivery before handoff; until then treat as unproven.' });
    }
  } else {
    out.push({
      provider: 'resend', state: evidence.emailStubObserved === false ? 'CONTRADICTION' : 'STUB',
      reason: 'Deferred for this client. App logs mail instead of sending; user creation never blocked.',
    });
  }

  out.push({
    provider: 'zoom', state: config.providers.zoom ? 'DECLARED' : 'NOT_CONFIGURED',
    reason: config.providers.zoom ? 'Selected in config. ZOOM_ENABLED=enabled emitted; endpoints throw loudly until credentials are set — test a call before handoff.' : 'Not purchased for this client (ZOOM_ENABLED=disabled emitted). Live operations reject with an intentional 503.',
  });

  return out;
}
