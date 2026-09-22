'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceBadge {
  label: string;
  variant: 'active' | 'inactive' | 'draft' | 'info' | 'warning';
}

interface WorkspaceContext {
  label: string;
  value: string;
  href?: string;
}

interface AdminWorkspaceHeaderProps {
  title: string;
  subtitle?: string;
  backHref: string;
  badges?: WorkspaceBadge[];
  context?: WorkspaceContext[];
  actions?: React.ReactNode;
}

// UX-1A: badgeColors is a compatibility alias — canonical is <Badge variant>.
// Keep mapping for AdminWorkspaceHeader-only variants (active/inactive/draft) that extend Badge.
const badgeColors: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-gray-100 text-gray-500 border-gray-200',
  draft: 'bg-purple-50 text-purple-700 border-purple-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function AdminWorkspaceHeader({
  title,
  subtitle,
  backHref,
  badges,
  context,
  actions,
}: AdminWorkspaceHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        {/* Back link */}
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        {/* Title row */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-text-primary sm:text-2xl">{title}</h1>
          {badges?.map((badge) => (
            <span
              key={badge.label}
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                badgeColors[badge.variant] ?? badgeColors.info,
              )}
            >
              {badge.label}
            </span>
          ))}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <p className="text-sm text-text-muted">{subtitle}</p>
        )}

        {/* Context chips */}
        {context && context.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {context.map((ctx) => (
              <span key={ctx.label} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1 text-xs text-text-secondary">
                <span className="font-medium text-text-muted">{ctx.label}:</span>
                {ctx.href ? (
                  <Link href={ctx.href} className="text-brand-600 hover:text-brand-700 font-medium inline-flex items-center gap-1">
                    {ctx.value}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-text-primary">{ctx.value}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
