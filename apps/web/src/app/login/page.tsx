'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, ApiError } from '@/lib/api-client';
import { ROUTES, API_ROUTES } from '@/lib/constants';
import { useSession } from '@/hooks/useSession';
import { useDeviceFingerprint } from '@/lib/hooks/useDeviceFingerprint';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReplaced, setSessionReplaced] = useState(false);
  const { login } = useSession();
  const fingerprint = useDeviceFingerprint();

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSessionReplaced(false);
    setLoading(true);

    try {
      await login(email, password, fingerprint ?? undefined);
    } catch (err) {
      const apiErr = err as ApiError;
      const data = (apiErr?.data as any) || {};
      // Code may be top-level (after HttpExceptionFilter fix) or nested inside message object
      const code = data?.code ?? (typeof data?.message === 'object' ? (data.message as any)?.code : undefined);
      const serverMessage =
        typeof data?.message === 'string' ? data.message : (data?.message as any)?.message ?? data?.message;
      const isReplaced = apiErr?.status === 409 && code === 'SESSION_REPLACED';
      if (isReplaced) {
        setSessionReplaced(true);
        setError(
          serverMessage ||
            'Your account was logged in on another device. We have logged out the previous device for security. Please log in again to continue.',
        );
        // Ensure no stale session remains on this device
        try {
          document.cookie = 'access_token=; path=/; max-age=0; secure; samesite=lax';
          localStorage.removeItem('session_persistence');
        } catch {}
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    try {
      await fetchApi(API_ROUTES.AUTH.FORGOT_PASSWORD, {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail }),
      });
      setResetSent(true);
    } catch {
      setResetSent(true);
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-8">
      <div className="w-full max-w-md rounded-card-lg bg-surface-card p-6 shadow-modal md:p-8">
        <h1 className="mb-2 text-2xl font-bold text-text-primary">MCT Learn</h1>
        <p className="mb-6 text-sm text-text-secondary">Sign in to your account</p>

        {sessionReplaced ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center" role="alert">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <span aria-hidden>🔐</span>
            </div>
            <h2 className="text-sm font-semibold text-amber-900">Account Already Active</h2>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              Your account was logged in on another device.
              <br />
              We have logged out the previous device for security.
            </p>
            <p className="mt-2 text-xs font-medium text-amber-900">Please log in again to continue.</p>
            <button
              type="button"
              onClick={() => {
                setSessionReplaced(false);
                setError('');
              }}
              className="mt-3 inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Log In Again
            </button>
          </div>
        ) : (
          error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )
        )}

        {!showForgotPassword ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="input-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="input-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Reset Password</h2>
              <p className="mt-1 text-xs text-gray-500">
                Enter your email to receive a reset link.
              </p>

              {resetSent ? (
                <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                  If an account exists with this email, a reset link has been sent.
                  Check your inbox.
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="mt-4 space-y-3">
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {resetLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetSent(false);
                  setResetEmail('');
                }}
                className="mt-3 text-sm text-gray-500 hover:text-gray-700"
              >
                &larr; Back to login
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
