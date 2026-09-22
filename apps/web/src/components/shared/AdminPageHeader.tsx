'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  actions?: React.ReactNode;
}

export function AdminPageHeader({ title, description, backHref, actions }: AdminPageHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          {backHref && (
            <button
              onClick={() => router.push(backHref)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-text-primary sm:text-2xl">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-text-muted">{description}</p>
            )}
          </div>
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
