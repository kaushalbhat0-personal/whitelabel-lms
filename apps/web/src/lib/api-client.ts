import { getAccessToken } from './auth-token';
import { validateTokenOnServer } from './auth-validation';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string, data?: unknown) {
    super(message, 401, data);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string, data?: unknown) {
    super(message, 403, data);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, data?: unknown) {
    super(message, 404, data);
    this.name = 'NotFoundError';
  }
}

export class ServerError extends ApiError {
  constructor(message: string, status: number, data?: unknown) {
    super(message, status, data);
    this.name = 'ServerError';
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TIMEOUT_MS = 30_000;
const isDev = process.env.NODE_ENV === 'development';

const AUTH_ENDPOINTS = new Set(['/auth/login', '/auth/validate-session']);

async function validateSession(): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;
  return validateTokenOnServer(token);
}

function createApiError(status: number, body: any): ApiError {
  const message = body?.message || `Request failed with status ${status}`;
  switch (status) {
    case 401:
      return new UnauthorizedError(message, body);
    case 403:
      return new ForbiddenError(message, body);
    case 404:
      return new NotFoundError(message, body);
    default:
      return status >= 500
        ? new ServerError(message, status, body)
        : new ApiError(message, status, body);
  }
}

export async function fetchApi<T = unknown>(
  endpoint: string,
  options?: RequestInit & { skipAuthRedirect?: boolean },
): Promise<T> {
  const start = performance.now();
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const url = `${API_URL}${endpoint}`;
      const token = await getAccessToken();

      const isFormData = options?.body instanceof FormData;
      const headers: Record<string, string> = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options?.headers as Record<string, string>),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (isDev) {
        console.group(`[API] ${options?.method || 'GET'} ${endpoint}`);
        console.log('Status:', response.status);
        console.log('Duration:', `${(performance.now() - start).toFixed(0)}ms`);
        console.groupEnd();
      }

      if (response.status === 401 && attempt === 1 && !AUTH_ENDPOINTS.has(endpoint)) {
        const shouldRedirect = !(options as any)?.skipAuthRedirect;
        if (!shouldRedirect) {
          throw new UnauthorizedError('Session expired');
        }
        // If explicit logout is in flight, suppress hard expiry redirect — caller already navigating
        try {
          const { isLogoutInFlight } = await import('@/hooks/useSession');
          if (isLogoutInFlight?.() === true) {
            throw new UnauthorizedError('Session expired');
          }
        } catch (e) {
          if (e instanceof UnauthorizedError) throw e;
        }
        const sessionValid = await validateSession();
        if (sessionValid) {
          continue;
        }
        // Re-check after async validate — logout may have started during validation
        try {
          const { isLogoutInFlight: checkAgain } = await import('@/hooks/useSession');
          if (checkAgain?.() === true) {
            throw new UnauthorizedError('Session expired');
          }
        } catch (e) {
          if (e instanceof UnauthorizedError) throw e;
        }
        if (typeof window !== 'undefined') {
          // Single-device takeover or expiry: clear all local auth state,
          // stop heartbeat/validation, broadcast to same-browser tabs, then redirect.
          // This mirrors handleExpiredSession/handleTakeover without importing
          // session-manager statically (avoids circular deps in some bundles).
          try {
            const { clearSessionCache, clearAuthCookies } = await import('./auth');
            clearSessionCache();
            clearAuthCookies();
          } catch {}
          try {
            const { stopBackgroundValidation } = await import('./session-manager');
            stopBackgroundValidation();
          } catch {}
          try {
            const { stopHeartbeat } = await import('./session-heartbeat');
            stopHeartbeat();
          } catch {}
          try {
            const { useAuthStore } = await import('@/stores/auth.store');
            // Mark expired — overlay/guard will show correct UX before hard redirect
            useAuthStore.getState().setStatus('expired');
            useAuthStore.getState().setError('Session expired. Please log in again.');
          } catch {}
          try {
            const { broadcastExpired } = await import('./session-manager');
            broadcastExpired();
          } catch {
            try {
              const bc = new BroadcastChannel('mct-auth-channel');
              bc.postMessage({ type: 'auth:expired' });
              bc.close();
            } catch {}
          }
          document.cookie = 'access_token=; path=/; max-age=0; secure; samesite=lax';
          window.location.href = '/login';
        }
        throw new UnauthorizedError('Session expired');
      }

      if (!response.ok) {
        let body: any;
        try {
          body = await response.json();
        } catch {
          body = { message: response.statusText };
        }
        throw createApiError(response.status, body);
      }

      const data = await response.json();
      if (
        data &&
        typeof data === 'object' &&
        'success' in data &&
        'data' in data
      ) {
        return data.data as T;
      }
      return data as T;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ApiError(`Request timed out after ${TIMEOUT_MS / 1000}s`, 408);
      }
      throw new ApiError((err as Error).message || 'Network error', 0);
    }
  }

  throw new ApiError('Unexpected error', 0);
}
