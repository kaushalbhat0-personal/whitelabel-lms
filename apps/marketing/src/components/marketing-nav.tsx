'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { siteConfig } from '@/site.config';
import { Wordmark } from './wordmark';

/**
 * Marketing navigation shell. Only interactive island on the foundation —
 * everything else is a static server component.
 */
export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open ]);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-cream/90 backdrop-blur-sm">
      <nav aria-label="Primary" className="mx-auto flex w-full max-w-content items-center justify-between px-5 py-4 sm:px-8">
        <Wordmark />
        <ul className="hidden items-center gap-8 md:flex">
          {siteConfig.nav.map((item) => (
            <li key={item.label}>
              <Link href={item.href} className="text-base font-medium text-ink-soft transition-colors hover:text-ink">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <Link
            href="/contact"
            className="inline-flex min-h-[44px] items-center rounded-cta bg-clay px-5 py-2.5 text-base font-semibold text-white transition-opacity hover:opacity-90"
          >
            Talk to Us
          </Link>
        </div>
        <button
          type="button"
          ref={toggleRef}
          className="inline-flex items-center justify-center rounded-cta p-2 text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>
      </nav>
      {open ? (
        <div id="mobile-menu" className="border-t border-line bg-cream px-5 pb-6 pt-2 md:hidden">
          <ul className="flex flex-col gap-1">
            {siteConfig.nav.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-cta px-3 py-3 text-lg font-medium text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="pt-3">
              <Link
                href="/contact"
                onClick={() => setOpen(false)}
                className="block rounded-cta bg-clay px-3 py-4 text-center text-lg font-semibold text-white"
              >
                Talk to Us
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  );
}
