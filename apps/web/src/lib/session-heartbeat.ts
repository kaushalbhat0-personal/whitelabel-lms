import { useAuthStore } from '@/stores/auth.store';
import { validateTokenOnServer } from './auth-validation';
import { handleTakeover as sharedHandleTakeover } from './session-manager';

const HEARTBEAT_INTERVAL_MS = 30_000;
const LEADER_KEY = 'heartbeat_leader_ts';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function tryClaimLeadership(): boolean {
  const lastTs = parseInt(localStorage.getItem(LEADER_KEY) || '0', 10);
  if (Date.now() - lastTs > HEARTBEAT_INTERVAL_MS + 5000) {
    localStorage.setItem(LEADER_KEY, String(Date.now()));
    return true;
  }
  return false;
}

function releaseLeadership(): void {
  const ourTs = localStorage.getItem(LEADER_KEY);
  if (ourTs && Date.now() - parseInt(ourTs, 10) < HEARTBEAT_INTERVAL_MS) {
    localStorage.removeItem(LEADER_KEY);
  }
}

async function checkSession(): Promise<'valid' | 'invalid' | 'error'> {
  const token = useAuthStore.getState().token;
  if (!token) return 'invalid';
  try {
    const valid = await validateTokenOnServer(token);
    return valid ? 'valid' : 'invalid';
  } catch {
    return 'error';
  }
}

function handleTakeover(): void {
  sharedHandleTakeover();
  try {
    const bc = new BroadcastChannel('mct-auth-channel');
    bc.postMessage({ type: 'auth:takeover' });
    bc.close();
  } catch {}
}

async function runHeartbeat(): Promise<void> {
  if (!tryClaimLeadership()) return;

  localStorage.setItem(LEADER_KEY, String(Date.now()));

  const store = useAuthStore.getState();
  if (store.status !== 'authenticated') {
    console.log('[AUTH HEARTBEAT] Status not authenticated — stopping');
    stopHeartbeat();
    return;
  }

  const result = await checkSession();
  console.log(`[AUTH HEARTBEAT] checkSession result: ${result}, status: ${store.status}, user: ${store.user?.id}`);
  if (result === 'invalid') {
    console.log('[AUTH HEARTBEAT] Session invalid — calling handleTakeover');
    handleTakeover();
  }
}

export function startHeartbeat(): void {
  stopHeartbeat();
  runHeartbeat();
  heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  releaseLeadership();
}
