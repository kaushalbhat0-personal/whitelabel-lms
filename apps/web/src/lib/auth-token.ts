export async function getAccessToken(): Promise<string | undefined> {
  if (typeof window === 'undefined') {
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = cookies();
      return cookieStore.get('access_token')?.value;
    } catch {
      return undefined;
    }
  }
  const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]*)/);
  if (match) return match[1];
  // The server sets access_token as httpOnly, which document.cookie cannot read.
  // Fall back to the persisted session cache so authenticated API calls still work.
  try {
    const raw = localStorage.getItem('session_persistence');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.token) return parsed.token;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function getAccessTokenSync(): string | null {
  if (typeof window === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]*)/);
  if (match) return match[1];
  try {
    const raw = localStorage.getItem('session_persistence');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.token) return parsed.token;
    }
  } catch {
    // ignore
  }
  return null;
}
