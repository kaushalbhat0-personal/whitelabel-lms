'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  if (!items.length) return null;

  const needsCollapse = items.length > 3;
  const first = items[0];
  const lastTwo = items.slice(-2);
  const hidden = items.slice(1, -2);

  return (
    <nav aria-label="Breadcrumb" className="mb-4 max-w-full overflow-hidden">
      {/* UX-2: desktop — full trail with safe truncation; no horizontal scroll */}
      <ol className="hidden md:flex items-center gap-1 text-xs text-text-muted flex-wrap max-w-full">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} className="flex items-center gap-1 min-w-0">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-text-primary hover:underline truncate max-w-[220px] min-h-[28px] inline-flex items-center">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className={`${isLast ? 'font-medium text-text-primary' : ''} truncate max-w-[220px] inline-flex items-center min-h-[28px]`}>
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {/* UX-2: mobile — collapsed to first + ellipsis + last 2; prevents horizontal overflow at 375/390 */}
      {needsCollapse ? (
        <ol className="flex md:hidden items-center gap-1 text-xs text-text-muted flex-wrap max-w-full">
          <li className="flex items-center gap-1 min-w-0">
            {first.href ? (
              <Link href={first.href} className="hover:text-text-primary hover:underline truncate max-w-[100px] inline-flex items-center min-h-[28px] px-1 -mx-1 rounded">
                {first.label}
              </Link>
            ) : (
              <span className="truncate max-w-[100px] inline-flex items-center min-h-[28px]">{first.label}</span>
            )}
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          </li>
          <li className="relative flex items-center gap-1">
            <button
              onClick={() => setOverflowOpen(!overflowOpen)}
              aria-label={`Show ${hidden.length} hidden breadcrumb levels`}
              aria-expanded={overflowOpen}
              aria-haspopup="true"
              className="inline-flex items-center justify-center rounded-lg p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary transition-colors min-h-[28px] min-w-[28px]"
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {overflowOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setOverflowOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[160px] max-w-[calc(100vw-32px)] rounded-xl border border-surface-border bg-surface-card p-1 shadow-elevated motion-safe:animate-fade-in">
                  {hidden.map((item, i) => (
                    <Link
                      key={i}
                      href={item.href || '#'}
                      onClick={() => setOverflowOpen(false)}
                      className="block truncate rounded-lg px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted hover:text-text-primary min-h-[44px] flex items-center"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          </li>
          {lastTwo.map((item, idx) => {
            const isLast = idx === lastTwo.length - 1;
            const globalIdx = items.length - lastTwo.length + idx;
            return (
              <li key={globalIdx} className="flex items-center gap-1 min-w-0">
                {item.href && !isLast ? (
                  <Link href={item.href} className="hover:text-text-primary hover:underline truncate max-w-[110px] inline-flex items-center min-h-[28px] px-1 -mx-1 rounded">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? 'page' : undefined} className={`${isLast ? 'font-medium text-text-primary' : ''} truncate max-w-[110px] inline-flex items-center min-h-[28px]`}>
                    {item.label}
                  </span>
                )}
                {!isLast && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      ) : (
        <ol className="flex md:hidden items-center gap-1 text-xs text-text-muted flex-wrap max-w-full">
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            return (
              <li key={idx} className="flex items-center gap-1 min-w-0">
                {item.href && !isLast ? (
                  <Link href={item.href} className="hover:text-text-primary hover:underline truncate max-w-[120px] inline-flex items-center min-h-[28px] px-1 -mx-1 rounded">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? 'page' : undefined} className={`${isLast ? 'font-medium text-text-primary' : ''} truncate max-w-[120px] inline-flex items-center min-h-[28px]`}>
                    {item.label}
                  </span>
                )}
                {!isLast && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
