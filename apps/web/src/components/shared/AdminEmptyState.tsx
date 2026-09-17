'use client';

import { AlertTriangle, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';

interface AdminEmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  actionLabel?: string;
  actionHref?: string;
}

export function AdminEmptyState({
  icon: Icon = AlertTriangle,
  title = 'Nothing here yet',
  description,
  action,
  actionLabel,
  actionHref,
}: AdminEmptyStateProps) {
  const iconNode = Icon ? (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-muted ring-1 ring-surface-border">
      <Icon className="h-8 w-8 text-text-muted" />
    </div>
  ) : undefined;

  const actionNode =
    action ??
    (actionLabel && actionHref ? (
      <Link
        href={actionHref}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors shadow-sm min-h-[44px]"
      >
        {actionLabel}
      </Link>
    ) : undefined);

  return (
    <EmptyState
      icon={iconNode}
      title={title}
      description={description}
      action={actionNode}
      className="py-20"
    />
  );
}
