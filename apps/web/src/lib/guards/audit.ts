const isDev = process.env.NODE_ENV === 'development';

interface AuditEntry {
  type: 'auth:deny' | 'auth:expired' | 'role:deny';
  pathname: string;
  role: string | undefined;
  reason: string;
  timestamp: string;
  userAgent?: string;
}

function createEntry(
  type: AuditEntry['type'],
  pathname: string,
  role: string | undefined,
  reason: string,
): AuditEntry {
  return {
    type,
    pathname,
    role,
    reason,
    timestamp: new Date().toISOString(),
    userAgent:
      typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
  };
}

export function logAccessDenied(
  pathname: string,
  role: string | undefined,
  requiredRole: string,
): void {
  const entry = createEntry('role:deny', pathname, role, `Expected role ${requiredRole}`);
  logAudit(entry);
}

export function logAuthDenied(pathname: string): void {
  const entry = createEntry('auth:deny', pathname, undefined, 'No valid token');
  logAudit(entry);
}

export function logExpiredSession(pathname: string, role?: string): void {
  const entry = createEntry('auth:expired', pathname, role, 'Session expired');
  logAudit(entry);
}

function logAudit(entry: AuditEntry): void {
  if (isDev) {
    const log = typeof console.group === 'function' ? console.group : console.log;
    log(`[AUDIT] ${entry.type}`);
    console.log('Path:', entry.pathname);
    console.log('Role:', entry.role ?? 'none');
    console.log('Reason:', entry.reason);
    console.log('Time:', entry.timestamp);
    try { console.groupEnd?.(); } catch {}
    return;
  }

  // In production, fire-and-forget to an audit endpoint
  try {
    const payload = JSON.stringify(entry);
    if (typeof navigator !== 'undefined') {
      navigator.sendBeacon?.('/api/audit/log', payload);
    }
  } catch {
    // silent — audit is best-effort
  }
}
