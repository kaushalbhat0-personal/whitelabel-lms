/**
 * Centralized marketing site configuration (MKT-01A, extended MKT-01H).
 *
 * Single source for brand, contact, canonical URL, navigation, and the
 * demo-LMS destination. No secrets here — only public contact information
 * and public navigation targets.
 *
 * SITE_URL: set NEXT_PUBLIC_SITE_URL in production to the final marketing
 * domain. The localhost fallback is intentional: no permanent domain has
 * been finalized, and no placeholder domain is invented here.
 *
 * DEMO_URL: set NEXT_PUBLIC_DEMO_URL in production to the demo LMS location
 * (bare https origin preferred, e.g. https://demo.<marketing-domain>). A value
 * with a path — including a trailing `/login` — is tolerated and normalized
 * to its origin so the launch link can never duplicate to `/login/login`.
 * Resolved once here — components must use siteConfig.demoUrl /
 * siteConfig.demoLoginUrl, never read the environment variable directly
 * and never hardcode a demo deployment URL.
 */

/**
 * Normalize the demo LMS location to a bare https origin (MKT-01H, hardened DEMO-07).
 *
 * Contract: NEXT_PUBLIC_DEMO_URL names WHERE the demo LMS lives, not a full
 * login URL. A bare origin is expected, but a value with a path — notably a
 * trailing `/login` — is tolerated and reduced to its origin so the launch
 * link can never become `/login/login`.
 *
 * Returns undefined for anything unusable (empty, non-https, unparsable), in
 * which case demo-launch UI degrades to the request-access flow.
 */
export function normalizeDemoUrl(raw: string): string | undefined {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  return url.origin;
}

/**
 * Resolve the demo LMS origin (MKT-01H).
 *
 * - Production: requires NEXT_PUBLIC_DEMO_URL (https). When absent
 *   or invalid, returns undefined so demo-launch UI degrades to the
 *   request-access flow instead of linking somewhere wrong. The prebuild
 *   env check (scripts/check-marketing-env.mjs) makes this loud in logs.
 * - Development/test: falls back to the CURRENT demo deployment so local
 *   work can exercise the CTA end to end. This is explicitly NOT the
 *   permanent production architecture (see ENVIRONMENT.md); do not treat
 *   the fallback URL as canonical and do not copy it elsewhere.
 */
function resolveDemoUrl(): string | undefined {
  const normalized = normalizeDemoUrl(process.env.NEXT_PUBLIC_DEMO_URL ?? '');
  if (normalized) return normalized;
  const raw = (process.env.NEXT_PUBLIC_DEMO_URL ?? '').trim();
  if (raw.length > 0) {
    console.warn(
      `[marketing] NEXT_PUBLIC_DEMO_URL must be an https URL for the demo LMS; ignoring invalid value.`,
    );
  }
  if (process.env.NODE_ENV === 'production') return undefined;
  return 'https://whitelabel-lms-opal.vercel.app';
}

const demoUrl = resolveDemoUrl();

export const siteConfig = {
  brandName: 'MicroNest',
  productName: 'MicroNest LMS',
  tagline: 'Your Own LMS, Ready to Launch.',
  descriptor: 'Branded LMS Deployment',
  audience: 'Coaching Institutes & Academies',
  email: 'info.micronest@gmail.com',
  siteUrl:
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002',
  /** Demo LMS origin (https), or undefined when not configured. */
  demoUrl,
  /** Demo LMS login entry point, or undefined when demo is not configured. */
  demoLoginUrl: demoUrl ? `${demoUrl}/login` : undefined,
  nav: [
    { label: 'Product', href: '/#product' },
    { label: 'Features', href: '/#features' },
    { label: 'Demo', href: '/demo' },
    { label: 'Pricing', href: '/#pricing' },
  ] as Array<{ label: string; href: string }>,
  footerProduct: [
    { label: 'Product', href: '/#product' },
    { label: 'Features', href: '/#features' },
    { label: 'How deployment works', href: '/#how-it-works' },
    { label: 'Pricing', href: '/#pricing' },
  ],
} as const;
