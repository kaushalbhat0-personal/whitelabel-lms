'use client';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: React.ReactNode;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  className?: string;
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  sublabel,
  icon,
  iconColor = 'bg-brand-50 text-brand-600',
  trend,
  className,
  onClick,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-surface-border bg-surface-card p-5 transition-all duration-200',
        onClick && 'cursor-pointer hover:border-brand-200 hover:shadow-card-hover',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-muted">{label}</p>
          <p className="text-2xl font-bold tabular-nums text-text-primary">{value}</p>
          {sublabel && <p className="text-xs text-text-muted">{sublabel}</p>}
          {trend && (
            <div
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                trend.positive ? 'text-status-success' : 'text-status-error',
              )}
            >
              {trend.positive ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>{trend.positive ? '↑' : '↓'} {trend.value}%</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconColor)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
