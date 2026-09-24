'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, ApiError } from '@/lib/api-client';
import { API_ROUTES, ROUTES } from '@/lib/constants';
import { getAccessTokenSync } from '@/lib/auth-token';
import { clearMustChangePassword, getSessionCache } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth.store';
import { getPublicBusinessConfig } from '@/lib/api/business-config';
import { Button } from '@/components/ui/Button';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('LMS Platform');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  const submittingRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    const token = getAccessTokenSync();
    if (!token) {
      router.replace(ROUTES.LOGIN);
      return;
    }
    setInitialCheckDone(true);
  }, [router]);

  useEffect(() => {
    getPublicBusinessConfig()
      .then((cfg) => {
        if (cfg.business_name) setBusinessName(cfg.business_name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
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
      await fetchApi(API_ROUTES.AUTH.CHANGE_PASSWORD, {
        method: 'POST',
        body: JSON.stringify({ newPassword, confirmPassword }),
      });

      clearMustChangePassword();
      document.cookie =
        'must_change_password=; path=/; max-age=0; secure; samesite=lax';
      // Keep existing JWT/Redis session — do not delete access_token
      // Update persisted session cache and Zustand state so mustChangePassword=false
      try {
        const cached = getSessionCache();
        if (cached) {
          cached.mustChangePassword = false;
          localStorage.setItem('session_persistence', JSON.stringify(cached));
        }
      } catch {}
      try {
        useAuthStore.setState({ mustChangePassword: false });
      } catch {}
      if (!mountedRef.current) return;
      setSuccess(true);

      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
      redirectTimerRef.current = setTimeout(() => {
        router.push(ROUTES.STUDENT.HOME);
      }, 2000);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      submittingRef.current = false;
    }
  };

  if (!initialCheckDone) return null;

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
        <div
          className="w-full max-w-md rounded-xl bg-white p-6 sm:p-8 shadow-lg text-center"
          role="status"
          aria-live="polite"
        >
          <div className="mb-4 text-4xl" aria-hidden="true">
            &#9989;
          </div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">Password Set!</h1>
          <p className="text-sm text-gray-500">Password updated successfully. Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl bg-white p-6 sm:p-8 shadow-lg mx-4">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">{businessName}</h1>
        <p className="mb-6 text-sm text-gray-500">Set Your Password</p>

        <div className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          Welcome! Please set a permanent password to continue.
        </div>

        {error && (
          <div id="change-error" role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
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
              aria-describedby={error ? 'change-error' : undefined}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 min-h-[44px]"
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
              aria-describedby={error ? 'change-error' : undefined}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 min-h-[44px]"
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
            {loading ? 'Setting...' : 'Set Password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
