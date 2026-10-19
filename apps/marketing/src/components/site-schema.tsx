import { siteConfig } from '@/site.config';

/**
 * Single coherent JSON-LD graph (MKT-03B: SCHEMA-01/02/03).
 *
 * Server-rendered static markup — zero client JS. Every URL derives from
 * siteConfig.siteUrl (NEXT_PUBLIC_SITE_URL), so a future custom domain
 * migrates with environment configuration, not source rewrites.
 *
 * Only verified first-party facts: brand/product names from site.config,
 * the public support email, the real /icon.svg asset, visible positioning
 * condensed, and the exact commercial offer (120000 INR, one-time).
 * Deliberately absent: address, telephone, sameAs, ratings, reviews,
 * availability, SKU/GTIN, priceValidUntil, "first 10" scarcity (visible
 * copy only — no Schema.org property models it correctly), and any
 * legal-entity suffix (MicroNest Services is not a registered company).
 */
export function SiteSchema() {
  const base = siteConfig.siteUrl.replace(/\/$/, '');
  const organizationId = `${base}/#organization`;

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: 'MicroNest Services',
        url: base,
        logo: `${base}/icon.svg`,
        email: siteConfig.email,
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        name: 'MicroNest LMS',
        url: base,
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'Product',
        '@id': `${base}/#product`,
        name: 'MicroNest LMS',
        description:
          'Finished white-label LMS for coaching institutes and academies — branded, configured, and deployed on infrastructure the client owns. One-time deployment, not SaaS.',
        brand: { '@id': organizationId },
        url: base,
        offers: {
          '@type': 'Offer',
          price: 120000,
          priceCurrency: 'INR',
          url: `${base}/#pricing`,
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
