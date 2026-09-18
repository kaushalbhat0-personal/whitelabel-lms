import { getSessionCache, extendSessionCache, clearSessionCache, clearAuthCookies } from './auth';
import { validateTokenOnServer } from './auth-validation';
import { useAuthStore } from '@/stores/auth.store';
import { stopHeartbeat } from './session-heartbeat';

const VALIDATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const EXPIRY_GRACE_MS = 2 * 60 * 1000; // 2-minute grace before showing overlay
const CHANNEL_NAME = 'mct-auth-channel';

let validatorTimer: ReturnType<typeof setInterval> | null = null;
let channel: BroadcastChannel | null = null;
let isOffline = false;

export async function runSessionValidation(): Promise<void> {
  if (isOffline) {
    console.log('[AUTH VALIDATION] Skipping — offline');
    return;
  }

  const store = useAuthStore.getState();
  if (store.status !== 'authenticated') {
    console.log('[AUTH VALIDATION] Skipping — status is', store.status);
    return;
  }

  const cache = getSessionCache();
  if (!cache) {
    console.log('[AUTH VALIDATION] No session cache — calling handleExpiredSession');
    handleExpiredSession();
    return;
  }

  const timeUntilExpiry = cache.expiresAt - Date.now();
  console.log(`[AUTH VALIDATION] Cache expires in ${Math.round(timeUntilExpiry / 1000)}s`);

  // If cache is still fresh, just extend and return
  if (timeUntilExpiry > EXPIRY_GRACE_MS) {
    console.log('[AUTH VALIDATION] Cache still fresh — extending');
    extendSessionCache();
    return;
  }

  // Cache is near/at expiry — validate against server
  console.log('[AUTH VALIDATION] Cache near expiry — validating against server');
  const valid = await validateTokenOnServer(cache.token);
  if (valid) {
    console.log('[AUTH VALIDATION] Server validation passed — extending cache');
    extendSessionCache();
    store.setStatus('authenticated');
    store.setError(null);
  } else {
    console.log('[AUTH VALIDATION] Server validation FAILED — calling handleExpiredSession');
    handleExpiredSession();
  }
}

export function handleExpiredSession(): void {
  const store = useAuthStore.getState();
  console.group('[AUTH EVENT] handleExpiredSession');
  console.trace();
  console.log('previous status:', store.status);
  console.log('user id:', store.user?.id);
  console.log('timestamp:', new Date().toISOString());
  console.groupEnd();
  store.setStatus('expired');
  store.setError('Session expired. Please login again.');
  clearSessionCache();
  clearAuthCookies();
  stopBackgroundValidation();
  stopHeartbeat();
}

export function handleTakeover(): void {
  const store = useAuthStore.getState();
  console.group('[AUTH EVENT] handleTakeover');
  console.trace();
  console.log('previous status:', store.status);
  console.log('user id:', store.user?.id);
  console.log('timestamp:', new Date().toISOString());
  console.groupEnd();
  store.setStatus('takeover');
  store.setError('Your session was taken over. You have been logged out on this device.');
  clearSessionCache();
  clearAuthCookies();
  stopBackgroundValidation();
  stopHeartbeat();
}

export function startBackgroundValidation(): void {
  stopBackgroundValidation();
  // Run immediately
  runSessionValidation();
  validatorTimer = setInterval(runSessionValidation, VALIDATION_INTERVAL_MS);
}

export function stopBackgroundValidation(): void {
  if (validatorTimer !== null) {
    clearInterval(validatorTimer);
    validatorTimer = null;
  }
}

// --- Multi-tab sync ---

export function setupMultiTabSync(): () => void {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return () => {};
  }

  const store = useAuthStore.getState();

  const handleMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'auth:login': {
        const currentStore = useAuthStore.getState();
        if (msg.sessionCount > currentStore.sessionCount) {
          useAuthStore.getState().hydrate(msg.user, msg.token, msg.mustChangePassword);
          startBackgroundValidation();
        }
        break;
      }
      case 'auth:logout': {
        useAuthStore.getState().logout();
        clearSessionCache();
        clearAuthCookies();
        stopBackgroundValidation();
        stopHeartbeat();
        break;
      }
      case 'auth:takeover': {
        handleTakeover();
        break;
      }
      case 'auth:expired': {
        handleExpiredSession();
        break;
      }
    }
  };

  channel.addEventListener('message', handleMessage);
  return () => {
    channel?.removeEventListener('message', handleMessage);
    channel?.close();
    channel = null;
  };
}

export function broadcastLogin(user: { id: string; email: string; role: string }, token: string, mustChangePassword: boolean): void {
  const sessionCount = useAuthStore.getState().sessionCount;
  channel?.postMessage({ type: 'auth:login', user, token, mustChangePassword, sessionCount });
}

export function broadcastLogout(): void {
  channel?.postMessage({ type: 'auth:logout' });
}

export function broadcastTakeover(): void {
  try {
    // Use existing channel if available, otherwise create ephemeral one (fetchApi has no channel ref)
    if (channel) {
      channel.postMessage({ type: 'auth:takeover' });
    } else {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage({ type: 'auth:takeover' });
      bc.close();
    }
  } catch {}
}

export function broadcastExpired(): void {
  try {
    // Generic expiry — frontend cannot distinguish takeover vs plain expiry
    // without a backend discriminator, so broadcast expired to avoid false
    // "another device" claims in other tabs.
    if (channel) {
      channel.postMessage({ type: 'auth:expired' });
    } else {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage({ type: 'auth:expired' });
      bc.close();
    }
  } catch {}
}

// --- Offline handling ---

export function setupOfflineDetection(): () => void {
  const handleOnline = () => {
    isOffline = false;
    const store = useAuthStore.getState();
    if (store.status === 'offline') {
      store.setStatus('idle');
    }
    runSessionValidation();
  };

  const handleOffline = () => {
    isOffline = true;
    const store = useAuthStore.getState();
    if (store.status === 'authenticated') {
      store.setStatus('offline');
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  if (!navigator.onLine) {
    isOffline = true;
    const store = useAuthStore.getState();
    if (store.status === 'authenticated') {
      store.setStatus('offline');
    }
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
