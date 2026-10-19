/**
 * Marketing prebuild environment check (MKT-01H).
 *
 * Warns loudly — never fails — when production URL configuration is
 * missing or malformed. Marketing must never silently ship localhost
 * canonical URLs or a missing demo entry point to production.
 *
 * Required Vercel project settings (Root Directory: apps/marketing):
 *   NEXT_PUBLIC_SITE_URL=https://<production-marketing-domain>
 *   NEXT_PUBLIC_DEMO_URL=https://demo.<production-marketing-domain>
 *
 * These are public navigation targets, NOT secrets. Never put LMS API
 * keys, Supabase keys, Render credentials, or demo usernames/passwords
 * into marketing environment variables.
 */
const isProd = process.env.NODE_ENV === 'production';
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
const demoUrl = (process.env.NEXT_PUBLIC_DEMO_URL ?? '').trim();

let problems = 0;
function warn(message) {
  problems += 1;
  console.warn(`[marketing env] WARNING: ${message}`);
}

if (!siteUrl) {
  warn(
    `NEXT_PUBLIC_SITE_URL is not set — canonical URLs, sitemap, and Open Graph ` +
      `will fall back to http://localhost:3002. Set it to the production marketing domain.`,
  );
} else if (!/^https:\/\//.test(siteUrl)) {
  warn(`NEXT_PUBLIC_SITE_URL should be an https URL; got ${JSON.stringify(siteUrl)}.`);
}

if (!demoUrl) {
  warn(
    `NEXT_PUBLIC_DEMO_URL is not set — the demo page will show the guided-access ` +
      `flow instead of a "Launch Live Demo" button. Set it to the demo LMS origin ` +
      `(e.g. https://demo.<marketing-domain>).` + (isProd ? '' : ' Local builds fall back to the current demo deployment for testing only.'),
  );
} else if (!/^https:\/\/[^/]+$/.test(demoUrl)) {
  warn(
    `NEXT_PUBLIC_DEMO_URL should be a bare https origin (no path, no trailing slash); ` +
      `got ${JSON.stringify(demoUrl)}. A trailing /login path is tolerated and normalized, ` +
      `but please store the bare origin to keep the contract obvious.`,
  );
}

if (problems > 0) {
  console.warn(`[marketing env] ${problems} configuration warning(s) above. See apps/marketing/ENVIRONMENT.md.`);
} else {
  console.log('[marketing env] production URL configuration OK.');
}
