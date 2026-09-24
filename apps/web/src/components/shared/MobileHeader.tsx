'use client';

import { cn } from '@/lib/utils';
import { Menu, ChevronLeft } from 'lucide-react';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onMenuClick?: () => void;
}

export function MobileHeader({ title, showBack, onBack, onMenuClick }: MobileHeaderProps) {
  const { businessName, logoUrl } = useBusinessConfig();
  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-white md:hidden">
      <div className="flex h-12 items-center gap-2 px-3">
        {showBack ? (
          <button
            onClick={onBack}
            className="flex items-center justify-center rounded-lg p-2 text-text-secondary hover:bg-surface-muted min-h-[44px] min-w-[44px]"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : onMenuClick ? (
          <button
            onClick={onMenuClick}
            className="flex items-center justify-center rounded-lg p-2 text-text-secondary hover:bg-surface-muted min-h-[44px] min-w-[44px]"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : logoUrl ? (
          <img src={logoUrl} alt={businessName} className="h-9 w-9 shrink-0 rounded-md object-contain bg-white p-1" />
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-700 text-xs font-bold text-white"
            aria-hidden="true"
            title={businessName}
          >
            {businessName.trim()[0]?.toUpperCase() ?? 'L'}
          </div>
        )}

        <div className="flex-1 text-center">
          <h1 className="truncate text-sm font-semibold text-text-primary">{title}</h1>
        </div>

        {/* Right slot — empty for alignment */}
        <div className="w-9" />
      </div>
    </header>
  );
}
