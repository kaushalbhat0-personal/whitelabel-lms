'use client';

import { useEffect, useRef } from 'react';
import {
  getSessionCache,
  setSessionCache,
  clearSessionCache,
  clearAuthCookies,
} from '@/lib/auth';
import { useAuthStore } from '@/stores/auth.store';
import {
  startBackgroundValidation,
  stopBackgroundValidation,
  setupMultiTabSync,
  setupOfflineDetection,
  broadcastLogin,
} from '@/lib/session-manager';
import { startHeartbeat, stopHeartbeat } from '@/lib/session-heartbeat';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const AUTH_TIMEOUT_MS = 5_000;

function log(...args: unknown[]) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[AuthProvider]', ...args);
  }
}

function logTransition(from: string, to: string, detail?: string) {
  log(`STATE: ${from} → ${to}${detail ? ` (${detail})` : ''}`);
}

async function fetchWithLogging(
  url: string,
  options: RequestInit,
  label: string,
): Promise<{ ok: boolean; status: number; body: unknown; headers: Record<string, string>; cookiePresent: boolean }> {
  const token = (options.headers as Record<string, string>)?.['Authorization']?.replace('Bearer ', '');
  const cookiePresent = typeof document !== 'undefined' && document.cookie.includes('access_token=');

  log(`[NET:${label}] URL: ${url}`);
  log(`[NET:${label}] Method: ${options.method || 'GET'}`);
  log(`[NET:${label}] Authorization header: ${token ? `Bearer ${token.slice(0, 12)}...` : 'MISSING'}`);
  log(`[NET:${label}] Cookie (access_token): ${cookiePresent ? 'YES' : 'NO'}`);

  let res: Response;
  try {
    res = await fetch(url, options);
    log(`[NET:${label}] Status: ${res.status} ${res.statusText}`);
  } catch (err) {
    log(`[NET:${label}] NETWORK ERROR:`, err);
    return { ok: false, status: 0, body: { error: 'Network error', message: String(err) }, headers: {}, cookiePresent };
  }

  let body: unknown;
  try {
    body = await res.json();
    log(`[NET:${label}] Response body:`, JSON.stringify(body).slice(0, 500));
  } catch {
    body = { error: 'Failed to parse JSON response' };
    log(`[NET:${label}] Response body: (non-JSON)`);
  }

  return { ok: res.ok, status: res.status, body, headers: Object.fromEntries(res.headers.entries()), cookiePresent };
}

function validateProfileShape(data: unknown): { valid: boolean; missing: string[]; shape: string } {
  const missing: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, missing: ['entire response is not an object'], shape: typeof data };
  }
  const obj = data as Record<string, unknown>;
  if (!obj.id) missing.push('id');
  if (!obj.email) missing.push('email');
  if (!obj.role) missing.push('role');
  const keys = Object.keys(obj).sort().join(', ');
  return { valid: missing.length === 0, missing, shape: `{ ${keys} }` };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialised = useRef(false);
  const cleanupRef = useRef<(() => void)[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const store = useAuthStore.getState();
    logTransition('(mount)', store.status, `store initial state: ${store.status}`);

    // If already authenticated (set by login page), just start lifecycle and skip hydration
    if (store.status === 'authenticated' && store.user && store.token) {
      log('[AUTH BOOTSTRAP] Store already authenticated — starting lifecycle directly (login page set cache + store)');
      startLifecycle();
      return;
    }

    if (initialised.current) return;
    initialised.current = true;

    function clearTimeoutGuard() {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    function startTimeoutGuard() {
      clearTimeoutGuard();
      timeoutRef.current = setTimeout(() => {
        const current = useAuthStore.getState();
        if (current.status === 'loading' || current.status === 'idle') {
          log('[AUTH BOOTSTRAP] TIMEOUT — 5s elapsed. Status still:', current.status);
          log('[AUTH BOOTSTRAP] Calling clearAuthCookies + setAuthFailed — terminal transition');
          clearAuthCookies();
          current.setAuthFailed('Authentication timed out. Please refresh the page.');
        }
      }, AUTH_TIMEOUT_MS);
    }

    function startLifecycle() {
      log('[AUTH BOOTSTRAP] Starting lifecycle (multi-tab sync, offline detection, validation, heartbeat)');
      cleanupRef.current.push(setupMultiTabSync());
      cleanupRef.current.push(setupOfflineDetection());
      startBackgroundValidation();
      startHeartbeat();
    }

    async function hydrate() {
      const cached = getSessionCache();

      // ── Phase 1: Try localStorage cache ──
      if (cached) {
        const timeLeft = cached.expiresAt - Date.now();
        log(`Phase 1: cache found — expiresAt=${cached.expiresAt}, timeLeft=${timeLeft}ms`);

        if (timeLeft > 0) {
          log('Phase 1: cache hit, hydrating immediately');
          logTransition(store.status, 'authenticated', 'Phase 1 cache hit');
          store.hydrate(cached.user, cached.token, cached.mustChangePassword);
          startLifecycle();
          return;
        }

        log('Phase 1: cache expired, validating token');
        logTransition(store.status, 'loading', 'Phase 1 cache expired');
        store.setStatus('loading');
        startTimeoutGuard();

        const result = await fetchWithLogging(
          `${API_URL}/auth/validate-session`,
          { headers: { Authorization: `Bearer ${cached.token}` }, credentials: 'include' },
          'validate-session (Phase 1)',
        );
        clearTimeoutGuard();

        if (result.ok) {
          log('Phase 1: token valid, hydrating from cache');
          logTransition(store.status, 'authenticated', 'Phase 1 token valid');
          store.hydrate(cached.user, cached.token, cached.mustChangePassword);
          startLifecycle();
          return;
        }

        log('Phase 1: token invalid, clearing session');
        logTransition(store.status, 'expired', 'Phase 1 token invalid');
        clearSessionCache();
        clearAuthCookies();
        store.setStatus('expired');
        store.setError('Session expired. Please login again.');
        return;
      }

      log('Phase 1: no cache found');

      // ── Phase 2: No cache — check cookie ──
      const cookieMatch = document.cookie.match(/(?:^|;\s*)access_token=([^;]*)/);
      if (!cookieMatch) {
        log('Phase 2: no cookie detected — staying idle');
        logTransition(store.status, 'idle', 'Phase 2 no cookie');
        store.setStatus('idle');
        return;
      }

      const token = cookieMatch[1];
      log(`Phase 2: cookie found — token=${token.slice(0, 12)}...`);

      logTransition(store.status, 'loading', 'Phase 2 cookie found');
      store.setStatus('loading');
      startTimeoutGuard();

      const validateResult = await fetchWithLogging(
        `${API_URL}/auth/validate-session`,
        { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' },
        'validate-session (Phase 2)',
      );
      clearTimeoutGuard();

      if (!validateResult.ok) {
        log('Phase 2: token invalid via validate-session');
        logTransition(store.status, 'expired', 'Phase 2 validate-session failed');
        clearAuthCookies();
        store.setStatus('expired');
        store.setError('Session expired. Please login again.');
        return;
      }

      // ── Fetch full profile from /auth/me ──
      log('Phase 2: token valid, fetching profile');
      logTransition(store.status, 'loading', 'Phase 2 fetching /auth/me');
      store.setStatus('loading');
      startTimeoutGuard();

      const profileResult = await fetchWithLogging(
        `${API_URL}/auth/me`,
        { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' },
        '/auth/me',
      );
      clearTimeoutGuard();

      if (!profileResult.ok) {
        log(`Phase 2: /auth/me returned status ${profileResult.status}`);
        logTransition(store.status, 'error', `/auth/me HTTP ${profileResult.status}`);
        store.setAuthFailed(
          `Profile fetch failed (HTTP ${profileResult.status}). Please try refreshing.`
        );
        return;
      }

      // ── Validate response shape ──
      const body = profileResult.body as Record<string, unknown>;
      const data = ((body && typeof body === 'object' && 'data' in body) ? body.data : body) as Record<string, unknown>;

      const shapeCheck = validateProfileShape(data);
      if (!shapeCheck.valid) {
        log(`Phase 2: /auth/me response shape INVALID — missing: [${shapeCheck.missing.join(', ')}], shape: ${shapeCheck.shape}`);
        logTransition(store.status, 'error', `/auth/me shape invalid: ${shapeCheck.missing.join(', ')}`);
        store.setAuthFailed(
          `Invalid profile response (missing: ${shapeCheck.missing.join(', ')}). Please try refreshing.`
        );
        return;
      }

      const user = {
        id: data.id as string,
        name: data.name as string | undefined,
        email: data.email as string,
        role: data.role as string,
      };

      log(`Phase 2: profile fetched — id=${user.id}, email=${user.email}, role=${user.role}`);
      logTransition(store.status, 'authenticated', 'Phase 2 /auth/me success');
      store.hydrate(user, token);
      store.setStatus('authenticated');

      setSessionCache({
        user,
        token,
        mustChangePassword: false,
        sessionCount: useAuthStore.getState().sessionCount,
      });

      try {
        broadcastLogin(user, token, false);
      } catch { /* best-effort */ }

      startLifecycle();
    }

    hydrate();

    return () => {
      clearTimeoutGuard();
      stopBackgroundValidation();
      stopHeartbeat();
      cleanupRef.current.forEach((fn) => fn());
      cleanupRef.current = [];
    };
  }, []);

  return <>{children}</>;
}
