'use client';
import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';

// UX-1A: EmptyState + AdminEmptyState converge on icon → title → description → action pattern.
// AdminEmptyState is a preset wrapper (ring container + actionLabel/href). No API break in UX-1A.

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4', className)}>
      {icon ? (
        <div className="mb-4">{icon}</div>
      ) : (
        <div className="h-12 w-12 text-text-muted/50 mb-4">
          <Inbox className="h-12 w-12" />
        </div>
      )}
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      {description && (
        <p className="text-sm text-text-muted mt-1 max-w-sm text-center">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
