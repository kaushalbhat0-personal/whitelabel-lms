'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, type AuthUser, type SessionStatus } from '@/stores/auth.store';
import { fetchApi, ApiError } from '@/lib/api-client';
import { API_ROUTES, ROUTES } from '@/lib/constants';
import {
  setSessionCache,
  clearSessionCacheIfNotNewer,
  clearAuthCookies,
  setMustChangePassword,
  getSessionCache,
} from '@/lib/auth';
import {
  startBackgroundValidation,
  stopBackgroundValidation,
  broadcastLogin,
  broadcastLogout,
} from '@/lib/session-manager';
import { startHeartbeat, stopHeartbeat } from '@/lib/session-heartbeat';
import type { DeviceFingerprint } from '@/lib/hooks/useDeviceFingerprint';

let globalLogoutInFlight = false;
let globalLogoutResetTimer: ReturnType<typeof setTimeout> | null = null;

export function isLogoutInFlight(): boolean {
  return globalLogoutInFlight;
}

interface UseSessionReturn {
  user: AuthUser | null;
  token: string | null;
  status: SessionStatus;
  error: string | null;
  mustChangePassword: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  isExpired: boolean;
  isTakeover: boolean;
  isOffline: boolean;
  isLoggingOut: boolean;
  login: (email: string, password: string, device?: DeviceFingerprint) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

export function useSession(): UseSessionReturn {
  const store = useAuthStore();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const login = useCallback(
    async (email: string, password: string, device?: DeviceFingerprint) => {
      const storeState = useAuthStore.getState();
      storeState.setStatus('loading');
      storeState.setError(null);

      try {
        const body: Record<string, unknown> = { email, password };
        if (device) body.device = device;
        const result: any = await fetchApi(API_ROUTES.AUTH.LOGIN, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        const { token, user } = result;

        // Set cookies
        document.cookie =
          'access_token=' + token + '; path=/; max-age=86400; secure; samesite=lax';
        document.cookie =
          'must_change_password=' + (user.mustChangePassword ? 'true' : 'false') +
          '; path=/; max-age=86400; secure; samesite=lax';

        const authUser: AuthUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };

        // Hydrate store first (increments sessionCount)
        storeState.setAuth(authUser, token, user.mustChangePassword);

        // Persist to localStorage with current sessionCount
        setSessionCache({
          user: authUser,
          token,
          mustChangePassword: user.mustChangePassword ?? false,
          sessionCount: useAuthStore.getState().sessionCount,
        });

        // Broadcast to other tabs
        broadcastLogin(authUser, token, user.mustChangePassword ?? false);

        // Start background validation + heartbeat
        startBackgroundValidation();
        startHeartbeat();

        // Must change password check
        if (user.mustChangePassword) {
          setMustChangePassword(true);
          router.push(ROUTES.CHANGE_PASSWORD);
        } else if (user.role === 'student') {
          router.push(ROUTES.STUDENT.HOME);
        } else {
          router.push(ROUTES.ADMIN.HOME);
        }
      } catch (err) {
        storeState.setStatus('idle');
        if (err instanceof ApiError) {
          storeState.setError(err.message);
        } else {
          storeState.setError('An unexpected error occurred');
        }
        throw err;
      }
    },
    [router],
  );

  const logout = useCallback(() => {
    if (globalLogoutInFlight) return;
    globalLogoutInFlight = true;
    setIsLoggingOut(true);
    if (globalLogoutResetTimer) {
      clearTimeout(globalLogoutResetTimer);
      globalLogoutResetTimer = null;
    }
    // Bounded fallback — navigation unmounts this component, but guard must not stay stuck if push fails
    globalLogoutResetTimer = setTimeout(() => {
      globalLogoutInFlight = false;
      globalLogoutResetTimer = null;
    }, 5000);

    const storeState = useAuthStore.getState();
    console.log('[AUTH LOGOUT] Called — status:', storeState.status, 'user:', storeState.user?.id);
    const startCount = storeState.sessionCount;
    const currentStatus = storeState.status;
    const shouldPostLogout = currentStatus === 'authenticated';

    // Server-side session invalidation (best-effort, fire-and-forget) — ensures
    // next login does NOT hit SESSION_REPLACED from a stale Redis user_session.
    // Local state is cleared immediately so UX is not blocked by network.
    // `fetchApi` failure is swallowed — session may already be expired.
    // Skip POST for already-expired/takeover/offline/idle sessions.
    if (shouldPostLogout) {
      fetchApi(API_ROUTES.AUTH.LOGOUT, {
        method: 'POST',
        skipAuthRedirect: true,
      } as any).catch(() => {});
    }

    // Guarded local cleanup — never delete a newer session written after startCount
    const preClearCache = getSessionCache();
    const hasNewerCacheBeforeClear = !!preClearCache && typeof preClearCache.sessionCount === 'number' && preClearCache.sessionCount > startCount;
    const cleared = clearSessionCacheIfNotNewer(startCount);
    // Only clear cookies if no newer session was detected before clear and count not advanced
    if (!hasNewerCacheBeforeClear && cleared) {
      const currentCount = useAuthStore.getState().sessionCount;
      if (currentCount <= startCount) {
        clearAuthCookies();
      }
    } else if (hasNewerCacheBeforeClear || !cleared) {
      // Newer session detected — preserve its cookies/storage
    }
    stopBackgroundValidation();
    stopHeartbeat();
    broadcastLogout(startCount);

    storeState.logout();

    router.push(ROUTES.LOGIN);
  }, [router]);

  const clearError = useCallback(() => {
    useAuthStore.getState().setError(null);
  }, []);

  return {
    user: store.user,
    token: store.token,
    status: store.status,
    error: store.error,
    mustChangePassword: store.mustChangePassword,
    isLoading: store.status === 'loading',
    isAuthenticated: store.status === 'authenticated',
    isExpired: store.status === 'expired',
    isTakeover: store.status === 'takeover',
    isOffline: store.status === 'offline',
    isLoggingOut,
    login,
    logout,
    clearError,
  };
}
