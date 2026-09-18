const SESSION_KEY = 'session_persistence';
const SCHEMA_VERSION = 1;
const MUST_CHANGE_PASSWORD_KEY = 'must_change_password';

export interface SessionCache {
  version: number;
  user: { id: string; name?: string; email: string; role: string };
  token: string;
  mustChangePassword: boolean;
  sessionCount: number;
  expiresAt: number;
  updatedAt: number;
}

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

// --- Session persistence ---

export function getSessionCache(): SessionCache | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCache;
    if (parsed.version !== SCHEMA_VERSION) {
      clearSessionCache();
      return null;
    }
    return parsed;
  } catch {
    clearSessionCache();
    return null;
  }
}

export function setSessionCache(cache: Omit<SessionCache, 'version' | 'expiresAt' | 'updatedAt'>): void {
  const entry: SessionCache = {
    ...cache,
    version: SCHEMA_VERSION,
    expiresAt: Date.now() + SESSION_DURATION_MS,
    updatedAt: Date.now(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(entry));
}

export function extendSessionCache(): void {
  const existing = getSessionCache();
  if (!existing) return;
  existing.expiresAt = Date.now() + SESSION_DURATION_MS;
  existing.updatedAt = Date.now();
  localStorage.setItem(SESSION_KEY, JSON.stringify(existing));
}

export function clearSessionCache(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function clearSessionCacheIfNotNewer(maxCountToDelete: number): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as SessionCache;
    if (typeof parsed?.sessionCount === 'number' && parsed.sessionCount > maxCountToDelete) {
      return false;
    }
    localStorage.removeItem(SESSION_KEY);
    return true;
  } catch {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    return true;
  }
}

// --- Must-change-password helpers ---

export function getMustChangePassword(): boolean {
  return localStorage.getItem(MUST_CHANGE_PASSWORD_KEY) === 'true';
}

export function setMustChangePassword(value: boolean): void {
  localStorage.setItem(MUST_CHANGE_PASSWORD_KEY, String(value));
}

export function clearMustChangePassword(): void {
  localStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
}

// --- Cookie helpers ---

export function clearAuthCookies(): void {
  if (typeof window !== 'undefined') {
    console.group('[AUTH EVENT] clearAuthCookies');
    console.trace();
    console.log('timestamp:', new Date().toISOString());
    console.groupEnd();
  }
  document.cookie = 'access_token=; path=/; max-age=0; secure; samesite=lax';
  document.cookie = 'must_change_password=; path=/; max-age=0; secure; samesite=lax';
}
