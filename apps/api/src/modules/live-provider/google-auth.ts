/*
 * Google authentication for the reusable Meet live-provider.
 *
 * Why this file exists:
 *   - Google Meet/Calendar access must use the CLIENT's own Google identity,
 *     never a central MicroNest account. Deployment isolation is by
 *     infrastructure (this deployment's env), not by tenant rows.
 *   - Two legitimate deployment patterns exist:
 *       A. Google Workspace: service account + domain-wide delegation (DWD)
 *          impersonating a designated organizer account. Implemented here.
 *       B. Personal Gmail: per-user OAuth consent + encrypted refresh-token
 *          storage. NOT implemented: the repo has no encrypted secret store
 *          (no encrypt/decrypt utilities anywhere in apps/api/src), and the
 *          phase explicitly forbids insecure plaintext token persistence.
 *   - GoogleAuthProvider is the seam for both: a future OAuthRefreshAuth can
 *     implement getAccessToken() once an approved encrypted store exists,
 *     without touching GoogleMeetLiveProvider.
 *
 * MVP (Pattern A) flow per call (no token persistence anywhere):
 *   service-account JSON (env) + organizer email (env, DWD "sub")
 *     → local RS256 JWT assertion (node:crypto, in-memory only)
 *     → POST https://oauth2.googleapis.com/token (jwt-bearer grant)
 *     → short-lived access token (in-memory only, never logged/stored)
 *
 * Secrets live ONLY in process env on the client's own deployment.
 * Nothing here reads BusinessConfig, logs tokens/keys, or returns
 * credentials to callers.
 */

import axios from 'axios';
import * as crypto from 'crypto';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Minimum Phase-1 scope. No Drive/Meet-artifact scopes (recording = Phase 2). */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export interface GoogleMeetEnv {
  serviceAccountJson: string | undefined;
  organizerEmail: string | undefined;
  calendarId: string | undefined;
}

export interface ValidatedGoogleMeetConfig {
  serviceAccount: GoogleServiceAccount;
  organizerEmail: string;
  /** Calendar that receives LMS-created events. Defaults to the organizer's primary. */
  calendarId: string;
}

/**
 * Fail-fast startup validation. Called by LiveProviderModule ONLY when
 * LIVE_PROVIDER=google-meet is selected — Zoom/recorded-only deployments
 * boot with no Google env at all. Throws a plain Error with an actionable
 * message (Nest DI init fails → API refuses to start misconfigured).
 */
export function validateGoogleMeetConfig(env: GoogleMeetEnv): ValidatedGoogleMeetConfig {
  if (!env.serviceAccountJson) {
    throw new Error(
      'LIVE_PROVIDER=google-meet requires GOOGLE_MEET_SERVICE_ACCOUNT_JSON to be set. ' +
        'Create a service account in the CLIENT\'S OWN Google Cloud project, grant domain-wide ' +
        'delegation for the Calendar scope, and paste the JSON key here. Never use a shared MicroNest account.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.serviceAccountJson);
  } catch {
    throw new Error(
      'GOOGLE_MEET_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the service-account key file contents verbatim (single line).',
    );
  }
  const sa = parsed as Partial<GoogleServiceAccount>;
  if (!sa.client_email || typeof sa.client_email !== 'string') {
    throw new Error('GOOGLE_MEET_SERVICE_ACCOUNT_JSON is missing "client_email".');
  }
  if (!sa.private_key || typeof sa.private_key !== 'string') {
    throw new Error('GOOGLE_MEET_SERVICE_ACCOUNT_JSON is missing "private_key".');
  }
  if (!env.organizerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.organizerEmail)) {
    throw new Error(
      'LIVE_PROVIDER=google-meet requires GOOGLE_MEET_ORGANIZER_EMAIL to be set to the client Workspace ' +
        'user the service account impersonates via domain-wide delegation (e.g. teacher@client-domain.com).',
    );
  }
  return {
    serviceAccount: {
      client_email: sa.client_email,
      private_key: sa.private_key,
      private_key_id: typeof sa.private_key_id === 'string' ? sa.private_key_id : undefined,
    },
    organizerEmail: env.organizerEmail,
    calendarId: env.calendarId && env.calendarId.trim() !== '' ? env.calendarId : 'primary',
  };
}

/** Seam for Pattern A (implemented) and Pattern B / OAuth (follow-up). */
export interface GoogleAuthProvider {
  getAccessToken(scopes: string[]): Promise<string>;
}

/**
 * Pattern A: Workspace service account + domain-wide delegation.
 * Stateless — signs a fresh JWT assertion per call, exchanges it, returns
 * the access token. No persistence, no shared state, safe for concurrent use.
 */
export class ServiceAccountAuth implements GoogleAuthProvider {
  constructor(
    private readonly serviceAccount: GoogleServiceAccount,
    private readonly impersonateEmail: string,
  ) {}

  async getAccessToken(scopes: string[]): Promise<string> {
    let assertion: string;
    try {
      assertion = this.buildAssertion(scopes);
    } catch {
      // Bad key material, etc. — never propagate OpenSSL internals or key text.
      throw new Error('Google authentication failed: invalid service-account key material');
    }
    let data: any;
    try {
      const res = await axios.request({
        method: 'POST',
        url: GOOGLE_TOKEN_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      });
      data = res.data;
    } catch (error: any) {
      const detail =
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message ||
        'unknown token error';
      // Never include the assertion/key/email in the thrown message.
      throw new Error(`Google authentication failed: ${detail}`);
    }
    if (!data?.access_token || typeof data.access_token !== 'string') {
      throw new Error('Google authentication failed: token endpoint returned no access token');
    }
    return data.access_token;
  }

  private buildAssertion(scopes: string[]): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
    if (this.serviceAccount.private_key_id) {
      header.kid = this.serviceAccount.private_key_id;
    }
    const claims = {
      iss: this.serviceAccount.client_email,
      scope: scopes.join(' '),
      aud: GOOGLE_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      sub: this.impersonateEmail,
    };
    const input =
      `${Buffer.from(JSON.stringify(header)).toString('base64url')}.` +
      `${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(input);
    signer.end();
    // Throws here (bad key material) surfaces as an auth failure upstream —
    // key text itself is never propagated.
    const signature = signer.sign(this.serviceAccount.private_key).toString('base64url');
    return `${input}.${signature}`;
  }
}
