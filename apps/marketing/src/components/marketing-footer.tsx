import Link from 'next/link';
import { siteConfig } from '@/site.config';
import { Wordmark } from './wordmark';

/** Footer shell — conservative wording, no entity/registration claims. Visual polish only (MKT-02B). */
export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-ink bg-paper">
      <div className="mx-auto grid w-full max-w-content gap-10 px-5 py-14 sm:px-8 md:grid-cols-3">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-base leading-relaxed text-ink-soft">
            {siteConfig.tagline} {siteConfig.descriptor} for {siteConfig.audience.toLowerCase()} — deployed on
            infrastructure your institute owns.
          </p>
        </div>
        <nav aria-label="Product">
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-soft">Product</p>
          <ul className="mt-4 space-y-3">
            {siteConfig.footerProduct.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="text-base text-ink-soft transition-colors hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/demo" className="text-base text-ink-soft transition-colors hover:text-ink">
                Live demo
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-soft">Contact</p>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            For deployment enquiries:
            <br />
            <a href={`mailto:${siteConfig.email}`} className="font-semibold text-clay-dark underline-offset-4 hover:underline">
              {siteConfig.email}
            </a>
          </p>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-content flex-col gap-2 px-5 py-6 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} {siteConfig.brandName} Services. All rights reserved.</p>
          <p>Branded LMS deployments for education businesses.</p>
        </div>
      </div>
    </footer>
  );
}
