'use client';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

const variantClasses = {
  text: 'rounded-lg',
  circular: 'rounded-full',
  rectangular: 'rounded-lg',
};

export function LoadingSkeleton({
  className,
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  return (
    <div
      className={cn('motion-safe:animate-pulse bg-surface-border', variantClasses[variant], className)}
      style={{
        width: width ?? '100%',
        height: height ?? (variant === 'text' ? '1rem' : undefined),
      }}
    />
  );
}
