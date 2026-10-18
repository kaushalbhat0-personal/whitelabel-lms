import { createBrowserClient } from '@supabase/ssr';

const MISSING_ENV_MESSAGE =
  'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // During `next build`, client components are prerendered on the server,
    // where NEXT_PUBLIC_* values may not be baked in. Return a placeholder
    // client so static generation doesn't crash (effects don't run during
    // prerender, so no network calls are made). Real browser usage without
    // env vars still throws below.
    if (typeof window === 'undefined') {
      return createBrowserClient('https://placeholder.supabase.co', 'placeholder-anon-key');
    }
    throw new Error(MISSING_ENV_MESSAGE);
  }

  return createBrowserClient(url, anonKey);
}
