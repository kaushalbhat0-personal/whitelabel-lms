'use client';

import { cn } from '@/lib/utils';

export function AdminTableSkeleton({ rows = 5, cols = 4, showBulk = false }: { rows?: number; cols?: number; showBulk?: boolean }) {
  const effectiveCols = showBulk ? cols + 1 : cols;
  return (
    <div className="overflow-x-auto rounded-xl border border-surface-border bg-surface-card">
      <table className="w-full">
        <thead>
          <tr className="bg-surface-muted">
            {Array.from({ length: effectiveCols }).map((_, i) => (
              <th key={i} className="px-4 py-3">
                <div className="h-4 rounded bg-surface-border motion-safe:animate-pulse w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: effectiveCols }).map((_, c) => (
                <td key={c} className="px-4 py-3">
                  <div className="h-4 rounded bg-surface-muted motion-safe:animate-pulse" style={{ width: `${60 + Math.floor(Math.random() * 30)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminCardSkeleton({ count = 3, cols = 3 }: { count?: number; cols?: number }) {
  return (
    <div className={cn('grid gap-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4')}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-surface-border bg-surface-card p-5 space-y-3">
          <div className="h-3 rounded bg-surface-muted motion-safe:animate-pulse w-1/3" />
          <div className="h-7 rounded bg-surface-muted motion-safe:animate-pulse w-1/2" />
          <div className="h-3 rounded bg-surface-muted motion-safe:animate-pulse w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function AdminDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 rounded bg-surface-muted motion-safe:animate-pulse w-1/3" />
        <div className="h-4 rounded bg-surface-muted motion-safe:animate-pulse w-1/2" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-surface-border bg-surface-card p-5 space-y-2">
            <div className="h-3 rounded bg-surface-muted motion-safe:animate-pulse w-1/3" />
            <div className="h-7 rounded bg-surface-muted motion-safe:animate-pulse w-1/2" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-surface-border bg-surface-card p-6 space-y-3">
        <div className="h-4 rounded bg-surface-muted motion-safe:animate-pulse w-1/4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 rounded bg-surface-muted motion-safe:animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
