'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useSession } from '@/hooks/useSession';
import { getRoleForPath, hasRequiredRole } from './permissions';
import { logAuthDenied, logAccessDenied } from './audit';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface GuardResult {
  allowed: boolean;
  isLoading: boolean;
  reason: 'authenticating' | 'wrong-role' | 'unauthenticated' | 'error' | null;
}

export function useGuard(): GuardResult {
  const { user, status } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated' && user) {
      if (!hasRequiredRole(user.role, pathname)) {
        logAccessDenied(pathname, user.role, pathname.split('/')[1] ?? 'unknown');
        if (user.role === 'student') {
          router.replace('/student');
        } else if (user.role === 'admin') {
          router.replace('/admin');
        } else if (user.role === 'teacher') {
          router.replace('/teacher');
        } else {
          router.replace('/login');
        }
      }
    }
  }, [status, user, pathname, router]);

  if (status === 'loading' || status === 'idle') {
    return { allowed: false, isLoading: true, reason: 'authenticating' };
  }

  if (status === 'error') {
    return { allowed: false, isLoading: false, reason: 'error' };
  }

  if (status === 'expired' || status === 'offline') {
    return { allowed: false, isLoading: false, reason: 'unauthenticated' };
  }

  if (status === 'takeover') {
    return { allowed: false, isLoading: false, reason: 'unauthenticated' };
  }

  if (status === 'authenticated' && user && !hasRequiredRole(user.role, pathname)) {
    return { allowed: false, isLoading: false, reason: 'wrong-role' };
  }

  return { allowed: true, isLoading: false, reason: null };
}

export function GuardRoute({ children }: { children: React.ReactNode }) {
  const { allowed, isLoading, reason } = useGuard();
  const { error, logout, isLoggingOut } = useSession();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (reason === 'error') {
    return (
      <AuthErrorScreen
        message={error || 'Authentication failed'}
        onRetry={() => {
          document.cookie = 'access_token=; path=/; max-age=0; secure; samesite=lax';
          window.location.href = '/login';
        }}
      />
    );
  }

  if (!allowed) {
    return (
      <UnauthorizedPage
        reason={reason}
        onLogin={logout}
        isLoggingOut={isLoggingOut}
      />
    );
  }

  return <>{children}</>;
}

// ── Guard UI Components ────────────────────────────────────────

function AuthLoadingScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-surface-page">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute h-16 w-16 animate-ping rounded-full bg-brand-500/20" />
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-secondary">Checking your session</p>
          <p className="mt-1 text-xs text-text-muted">Please wait a moment</p>
        </div>
      </div>
    </div>
  );
}

function AuthErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface-page">
      <div className="mx-4 w-full max-w-md rounded-card border border-surface-border bg-surface-card p-8 text-center shadow-modal">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-8 w-8 text-status-error" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-text-primary">Authentication Error</h2>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <RefreshCw className="h-4 w-4" />
            Return to Login
          </button>
        </div>
      </div>
    </div>
  );
}

function UnauthorizedPage({
  reason,
  onLogin,
  isLoggingOut,
}: {
  reason: GuardResult['reason'];
  onLogin: () => void;
  isLoggingOut?: boolean;
}) {
  const title =
    reason === 'wrong-role'
      ? 'Access Denied'
      : reason === 'unauthenticated'
        ? 'Session Expired'
        : 'Unauthorized';

  const description =
    reason === 'wrong-role'
      ? 'You do not have permission to view this page.'
      : reason === 'unauthenticated'
        ? 'Your session has expired or was taken over. Please login again.'
        : 'You need to be logged in to view this page.';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface-page">
      <div className="mx-4 w-full max-w-md rounded-card border border-surface-border bg-surface-card p-8 text-center shadow-modal">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
          <LogOut className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-text-primary">{title}</h2>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
        <Button
          onClick={onLogin}
          loading={!!isLoggingOut}
          className="mt-6 w-full rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 min-h-[44px]"
        >
          {isLoggingOut ? 'Signing out…' : 'Go to Login'}
        </Button>
      </div>
    </div>
  );
}
