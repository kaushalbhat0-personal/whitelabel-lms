'use client';

/*
 * Instant demo access page — sales-demo deployment only.
 *
 * Prospect flow: generate one temporary demo account (≈30 min), show the
 * credentials ONCE in React state, then hand off to /login. Credentials are
 * never stored (no localStorage/sessionStorage/cookies/URL), never logged,
 * and never sent to analytics. A client-side countdown is display-only —
 * server-side expiry remains authoritative.
 *
 * Duplicate-click protection: the CTA is disabled while a request is in
 * flight, but a deliberate second click after completion issues a fresh
 * independent account (replacing the displayed credentials).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { fetchApi, ApiError } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { getPublicBusinessConfig } from '@/lib/api/business-config';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

interface DemoCredentials {
  loginUrl: string;
  username: string;
  password: string;
  expiresAt: string;
}

function formatRemaining(expiresAt: string, now: number): string {
  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return 'Demo access is not available on this deployment.';
    }
    if (err.status === 503 || err.status === 429) {
      return 'Demo access is temporarily unavailable. Please try again later.';
    }
  }
  return 'Could not generate demo access right now. Please try again.';
}

export default function DemoAccessPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('LMS Platform');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<DemoCredentials | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    getPublicBusinessConfig()
      .then((cfg) => {
        if (cfg.business_name) setBusinessName(cfg.business_name);
      })
      .catch(() => {});
  }, []);

  // Display-only countdown. Server-side expiry is authoritative — a manipulated
  // browser clock can never extend access.
  useEffect(() => {
    if (!credentials) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [credentials]);

  const handleGenerate = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    setCopiedField(null);
    try {
      // No request body: the server hardcodes role/student and expiry.
      // fetchApi uses cache: 'no-store'; the API also sends Cache-Control: no-store.
      const result = await fetchApi<DemoCredentials>('/demo/access', {
        method: 'POST',
      });
      setCredentials(result);
      setNow(Date.now());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }, []);

  const handleCopy = useCallback(async (field: 'username' | 'password', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
    } catch {
      // Clipboard unavailable — the value remains visible for manual copy.
    }
  }, []);

  const expired = credentials
    ? new Date(credentials.expiresAt).getTime() <= now
    : false;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-8">
      {/* Credentials must never be exfiltrated via Referer on outbound navigation. */}
      <meta name="referrer" content="no-referrer" />
      <div className="w-full max-w-md rounded-card-lg bg-surface-card p-6 shadow-modal md:p-8">
        <h1 className="mb-2 text-2xl font-bold text-text-primary">{businessName}</h1>
        <p className="mb-1 text-sm font-semibold text-text-primary">Get instant demo access</p>
        <p className="mb-6 text-sm text-text-secondary">
          Generate a temporary demo account and explore the LMS yourself. Access lasts about
          30 minutes, credentials are shown once, and password reset is unavailable in this
          demonstration environment.
        </p>

        {error && <Alert variant="error" className="mb-4">{error}</Alert>}

        {!credentials ? (
          <Button
            type="button"
            onClick={handleGenerate}
            loading={loading}
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Generating...' : 'Generate Demo Access'}
          </Button>
        ) : (
          <div className="space-y-4">
            {expired ? (
              <Alert variant="warning">
                This demo account has expired. Generate a new one to continue exploring.
              </Alert>
            ) : (
              <p className="text-sm text-text-secondary">
                Time remaining: <span className="font-semibold text-text-primary">{formatRemaining(credentials.expiresAt, now)}</span>
              </p>
            )}

            <div>
              <label className="input-label">Demo login</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={credentials.username}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Demo username"
                  className="input-field font-mono"
                />
                <button
                  type="button"
                  onClick={() => handleCopy('username', credentials.username)}
                  aria-label="Copy demo username"
                  className="rounded-lg border border-gray-200 p-2 text-text-secondary hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {copiedField === 'username' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="input-label">Password</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  type="password"
                  value={credentials.password}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Demo password"
                  className="input-field font-mono"
                />
                <button
                  type="button"
                  onClick={() => handleCopy('password', credentials.password)}
                  aria-label="Copy demo password"
                  className="rounded-lg border border-gray-200 p-2 text-text-secondary hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {copiedField === 'password' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <p className="text-xs text-text-secondary">
              These credentials are shown once. If you leave this page, generate a new demo account.
            </p>

            <Button
              type="button"
              onClick={() => router.push(ROUTES.LOGIN)}
              disabled={expired}
              className="w-full"
            >
              Open Live Demo
            </Button>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 px-2 text-sm text-brand-600 hover:text-brand-700 min-h-[44px] disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              {loading ? 'Generating...' : 'Generate a new demo account'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
