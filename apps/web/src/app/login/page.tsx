'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { fetchApi, ApiError } from '@/lib/api-client';
import { ROUTES, API_ROUTES } from '@/lib/constants';
import { useSession } from '@/hooks/useSession';
import { useDeviceFingerprint } from '@/lib/hooks/useDeviceFingerprint';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReplaced, setSessionReplaced] = useState(false);
  const submittingRef = useRef(false);
  const forgotSubmittingRef = useRef(false);
  const { login } = useSession();
  const fingerprint = useDeviceFingerprint();

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submittingRef.current || loading) {
      return;
    }
    submittingRef.current = true;

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
            'An active session was found for this account. For security, the previous session has been signed out. Please log in again.',
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
      submittingRef.current = false;
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotSubmittingRef.current) return;
    forgotSubmittingRef.current = true;
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
      forgotSubmittingRef.current = false;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-8">
      <div className="w-full max-w-md rounded-card-lg bg-surface-card p-6 shadow-modal md:p-8">
        <h1 className="mb-2 text-2xl font-bold text-text-primary">MCT Learn</h1>
        <p className="mb-6 text-sm text-text-secondary">Sign in to your account</p>

        {sessionReplaced ? (
          <Alert variant="warning" title="Active Session Found" className="mb-4 text-center">
            <div className="space-y-1">
              <p>An active session was found for this account. For security, the previous session has been signed out.</p>
              <p className="font-medium">Please log in again to continue.</p>
            </div>
            <div className="mt-3 flex justify-center">
              <Button
                size="sm"
                onClick={() => {
                  setSessionReplaced(false);
                  setError('');
                }}
              >
                Log In Again
              </Button>
            </div>
          </Alert>
        ) : (
          error && <Alert variant="error" className="mb-4">{error}</Alert>
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
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-sm text-brand-600 hover:text-brand-700 min-h-[44px] inline-flex items-center px-2 -mr-2"
              >
                Forgot Password?
              </button>
            </div>

            <Button
              type="submit"
              loading={loading}
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
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
                  <label htmlFor="resetEmail" className="block text-xs font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    id="resetEmail"
                    type="email"
                    required
                    autoComplete="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <Button
                    type="submit"
                    loading={resetLoading}
                    disabled={resetLoading}
                    className="w-full"
                  >
                    {resetLoading ? 'Sending...' : 'Send Reset Link'}
                  </Button>
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
