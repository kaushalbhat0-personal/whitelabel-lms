'use client';
import { cn } from '@/lib/utils';

// UX-1A: Badge is the source of truth for status pills.
// .badge-* utilities in globals.css and badgeColors mappings elsewhere are compat aliases — new code MUST use <Badge variant>.
interface BadgeProps {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-2xs',
  md: 'px-2.5 py-0.5 text-xs',
};

const variantClasses: Record<string, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
  neutral: 'badge-neutral',
};

export function Badge({ variant = 'info', size = 'md', children, className }: BadgeProps) {
  return (
    <span className={cn('badge', variantClasses[variant], sizeClasses[size], className)}>
      {children}
    </span>
  );
}
