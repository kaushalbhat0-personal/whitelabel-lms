/**
 * Centralized marketing site configuration (MKT-01A).
 *
 * Single source for brand, contact, canonical URL, and navigation.
 * No secrets here — only public contact information.
 *
 * SITE_URL: set NEXT_PUBLIC_SITE_URL in production to the final marketing
 * domain. The localhost fallback is intentional: no permanent domain has
 * been finalized, and no placeholder domain is invented here.
 */

export const siteConfig = {
  brandName: 'MicroNest',
  productName: 'MicroNest LMS',
  tagline: 'Your Own LMS, Ready to Launch.',
  descriptor: 'Branded LMS Deployment',
  audience: 'Coaching Institutes & Academies',
  email: 'info.micronest@gmail.com',
  siteUrl:
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002',
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
