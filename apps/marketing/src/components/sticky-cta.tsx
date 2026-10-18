'use client';

import Link from 'next/link';
import { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Mobile-only sticky CTA bar. Dismissible, safe-area aware, keyboard
 * friendly, and motion-free (no slide-in animation by design).
 */
export function StickyMobileCta() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur-sm md:hidden">
      <div
        className="flex items-center gap-3 px-5 py-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">Ready to launch your LMS?</p>
        <Link
          href="/contact"
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-cta bg-clay px-5 py-2.5 text-base font-semibold text-white"
        >
          Get Started
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-cta text-ink-soft"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
