'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ROUTES } from '@/lib/constants';
import { getPublicBusinessConfig } from '@/lib/api/business-config';
import { Button } from '@/components/ui/Button';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('LMS Platform');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const submittingRef = useRef(false);
  const readinessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Bounded fallback: prevent indefinite "Processing reset link..."
    readinessTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      // Only show error if we are still not ready and not already in an error/success state
      if (!ready && !readyError && !success) {
        setReadyError('This password reset link is invalid or has expired. Please request a new reset link.');
      }
    }, 7000);

    const clearReadinessTimeout = () => {
      if (readinessTimeoutRef.current) {
        clearTimeout(readinessTimeoutRef.current);
        readinessTimeoutRef.current = null;
      }
    };

    const markReady = () => {
      if (!mountedRef.current) return;
      clearReadinessTimeout();
      setReady(true);
      setReadyError(null);
    };

    // Subscribe to auth state changes — capture subscription for cleanup
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const result = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') {
          markReady();
        }
      });
      // Supabase v2 shape is { data: { subscription } }
      const maybeSubscription =
        (result as unknown as { data?: { subscription?: { unsubscribe: () => void } } })?.data?.subscription ??
        (result as unknown as { subscription?: { unsubscribe: () => void } })?.subscription ??
        null;
      if (maybeSubscription && typeof maybeSubscription.unsubscribe === 'function') {
        subscription = maybeSubscription;
      }
    } catch {
      // Ignore subscription setup errors — getSession fallback will handle
    }

    // If already signed in (token already processed), proceed — handle failures explicitly
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mountedRef.current) return;
        if (data.session) {
          markReady();
        }
      })
      .catch(() => {
        if (!mountedRef.current) return;
        clearReadinessTimeout();
        setReadyError('This password reset link is invalid or has expired. Please request a new reset link.');
      });

    return () => {
      mountedRef.current = false;
      clearReadinessTimeout();
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
      try {
        subscription?.unsubscribe();
      } catch {}
    };
    // supabase is memoized, so stable — effect runs once
  }, [supabase, ready, readyError, success]);

  useEffect(() => {
    getPublicBusinessConfig()
      .then((cfg) => {
        if (cfg.business_name) setBusinessName(cfg.business_name);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      submittingRef.current = false;
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      submittingRef.current = false;
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (!mountedRef.current) return;

      if (updateError) {
        if (updateError.message.toLowerCase().includes('expired')) {
          setError('This reset link has expired. Please request a new one.');
        } else {
          setError(updateError.message);
        }
        return;
      }

      setSuccess(true);

      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
      redirectTimeoutRef.current = setTimeout(async () => {
        try {
          await supabase.auth.signOut();
        } catch {}
        if (!mountedRef.current) return;
        router.push(ROUTES.LOGIN);
      }, 2000);
    } catch {
      if (!mountedRef.current) return;
      setError('An unexpected error occurred');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      submittingRef.current = false;
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div
          className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg text-center"
          role="status"
          aria-live="polite"
        >
          <div className="mb-4 text-4xl" aria-hidden="true">
            &#9989;
          </div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">Password Reset!</h1>
          <p className="text-sm text-gray-500">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">{businessName}</h1>
        <p className="mb-6 text-sm text-gray-500">Reset Your Password</p>

        {readyError ? (
          <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            <p>{readyError}</p>
            <div className="mt-3">
              <a
                href={ROUTES.LOGIN}
                className="inline-flex min-h-[44px] items-center text-brand-600 hover:text-brand-700 underline"
              >
                Go to login
              </a>
            </div>
          </div>
        ) : !ready ? (
          <div role="status" aria-live="polite" aria-busy="true" className="py-8 text-center text-sm text-gray-500">
            Processing reset link...
          </div>
        ) : (
          <>
            {error && (
              <div id="reset-error" role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
                {error.includes('expired') && (
                  <div className="mt-2">
                    <a href={ROUTES.LOGIN} className="text-brand-600 hover:text-brand-700 underline">
                      Go to login
                    </a>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                  New Password
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'reset-error' : undefined}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'reset-error' : undefined}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="••••••••"
                />
              </div>

              <p className="text-xs text-gray-500">
                Password must be 8+ characters, include uppercase, lowercase, and a number.
              </p>

              <Button
                type="submit"
                loading={loading}
                disabled={loading}
                className="w-full min-h-[44px]"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
