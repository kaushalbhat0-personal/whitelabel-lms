'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, showBack, action }: PageHeaderProps) {
  const router = useRouter();
  const { businessName, logoUrl } = useBusinessConfig();

  return (
    <header className="sticky top-0 z-10 border-b border-surface-border bg-white md:static md:border-0 md:bg-transparent">
      <div className="flex h-12 items-center gap-3 px-4 md:h-auto md:px-0 md:pb-6 md:pt-0">
        {showBack ? (
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center rounded-lg p-2 text-text-secondary hover:bg-surface-muted md:hidden min-h-[44px] min-w-[44px]"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : logoUrl ? (
          <img
            src={logoUrl}
            alt={businessName}
            className="flex h-9 w-9 shrink-0 rounded-md object-contain bg-white p-1 md:hidden"
          />
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-700 text-xs font-bold text-white md:hidden"
            aria-hidden="true"
            title={businessName}
          >
            {businessName.trim()[0]?.toUpperCase() ?? 'L'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-base font-semibold text-text-primary md:text-2xl md:font-bold">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-text-secondary md:mt-1 md:text-sm">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
