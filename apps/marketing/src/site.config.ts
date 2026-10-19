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
 * DEMO_URL: set NEXT_PUBLIC_DEMO_URL in production to the demo LMS origin
 * (e.g. https://demo.<marketing-domain>). Resolved once here — components
 * must use siteConfig.demoUrl / siteConfig.demoLoginUrl, never read the
 * environment variable directly and never hardcode a demo deployment URL.
 */

/**
 * Resolve the demo LMS origin (MKT-01H).
 *
 * - Production: requires NEXT_PUBLIC_DEMO_URL (https origin). When absent
 *   or invalid, returns undefined so demo-launch UI degrades to the
 *   request-access flow instead of linking somewhere wrong. The prebuild
 *   env check (scripts/check-marketing-env.mjs) makes this loud in logs.
 * - Development/test: falls back to the CURRENT demo deployment so local
 *   work can exercise the CTA end to end. This is explicitly NOT the
 *   permanent production architecture (see ENVIRONMENT.md); do not treat
 *   the fallback URL as canonical and do not copy it elsewhere.
 */
function resolveDemoUrl(): string | undefined {
  const raw = (process.env.NEXT_PUBLIC_DEMO_URL ?? '').trim().replace(/\/+$/, '');
  if (raw.length > 0) {
    if (raw.startsWith('https://')) return raw;
    console.warn(
      `[marketing] NEXT_PUBLIC_DEMO_URL must be an https origin; ignoring invalid value.`,
    );
    return undefined;
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
