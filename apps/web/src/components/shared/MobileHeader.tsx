'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Menu, ChevronLeft } from 'lucide-react';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onMenuClick?: () => void;
}

export function MobileHeader({ title, showBack, onBack, onMenuClick }: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-white md:hidden">
      <div className="flex h-12 items-center gap-2 px-3">
        {showBack ? (
          <button
            onClick={onBack}
            className="flex items-center justify-center rounded-lg p-1.5 text-text-secondary hover:bg-surface-muted"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : onMenuClick ? (
          <button
            onClick={onMenuClick}
            className="flex items-center justify-center rounded-lg p-1.5 text-text-secondary hover:bg-surface-muted"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">
            <Image
              src="/mct-logo.png"
              alt="MCT Learn"
              width={28}
              height={28}
              className="h-7 w-7 object-contain rounded-md"
            />
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
