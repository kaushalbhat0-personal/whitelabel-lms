'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, ApiError } from '@/lib/api-client';
import { API_ROUTES, ROUTES } from '@/lib/constants';
import { getAccessTokenSync } from '@/lib/auth-token';
import { clearMustChangePassword, getSessionCache } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth.store';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  useEffect(() => {
    const token = getAccessTokenSync();
    if (!token) {
      router.replace(ROUTES.LOGIN);
      return;
    }
    setInitialCheckDone(true);
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
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
      setSuccess(true);

      setTimeout(() => {
        router.push(ROUTES.STUDENT.HOME);
      }, 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!initialCheckDone) return null;

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg text-center">
          <div className="mb-4 text-4xl">&#9989;</div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">Password Set!</h1>
          <p className="text-sm text-gray-500">
            Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">MCT Learn</h1>
        <p className="mb-6 text-sm text-gray-500">Set Your Password</p>

        <div className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          Welcome! Please set a permanent password to continue.
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              New Password
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Confirm Password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="••••••••"
            />
          </div>

          <p className="text-xs text-gray-500">
            Password must be 8+ characters, include uppercase, lowercase, and a number.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Setting...' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
