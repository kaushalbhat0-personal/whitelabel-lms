import type { MetadataRoute } from 'next';
import { siteConfig } from '@/site.config';

/** Public marketing routes only — never LMS application routes. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.siteUrl.replace(/\/$/, '');
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/demo`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
