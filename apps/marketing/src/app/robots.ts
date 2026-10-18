import type { MetadataRoute } from 'next';
import { siteConfig } from '@/site.config';

/** Allow public marketing pages; reference the sitemap. No private routes exist. */
export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.siteUrl.replace(/\/$/, '');
  return {
    rules: [{ userAgent: '*', allow: ['/', '/demo', '/contact'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
