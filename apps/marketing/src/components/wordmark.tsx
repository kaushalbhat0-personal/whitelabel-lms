import Link from 'next/link';
import { siteConfig } from '@/site.config';

/** Text wordmark — editorial serif, no legacy logo asset reused (MKT-01 decision). */
export function Wordmark() {
  return (
    <Link
      href="/"
      className="font-display text-[1.35rem] font-semibold tracking-tight text-ink"
      aria-label={`${siteConfig.brandName} home`}
    >
      {siteConfig.brandName}
    </Link>
  );
}
