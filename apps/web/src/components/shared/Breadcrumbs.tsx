'use client';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 max-w-full overflow-x-auto scrollbar-thin">
      <ol className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap max-w-full">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} className="flex items-center gap-1 min-w-0">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-text-primary hover:underline truncate max-w-[160px] md:max-w-none">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className={`${isLast ? 'font-medium text-text-primary' : ''} truncate max-w-[160px] md:max-w-none`}>
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
