import Link from 'next/link';
import { siteConfig } from '@/site.config';

/** Text wordmark — no legacy logo asset reused (MKT-01 decision). */
export function Wordmark() {
  return (
    <Link href="/" className="text-xl font-bold tracking-tight text-ink" aria-label={`${siteConfig.brandName} home`}>
      {siteConfig.brandName}
    </Link>
  );
}
