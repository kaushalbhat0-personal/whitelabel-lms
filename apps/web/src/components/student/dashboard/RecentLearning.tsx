'use client';

import Link from 'next/link';
import { Clock, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { StudentVideo } from '@/lib/api/videos';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function RecentLearning({ recordings }: { recordings: StudentVideo[] }) {
  const items = [...recordings]
    .filter((r) => (r.progress.watched_seconds ?? 0) > 0)
    .sort((a, b) => {
      const at = a.progress.last_watched_at ? new Date(a.progress.last_watched_at).getTime() : 0;
      const bt = b.progress.last_watched_at ? new Date(b.progress.last_watched_at).getTime() : 0;
      return bt - at;
    })
    .slice(0, 3);

  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-primary">Recently Watched</h2>
        <Link href="/student/videos" className="text-xs font-medium text-brand-600 hover:text-brand-700 min-h-[44px] flex items-center">
          View all
        </Link>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const pct = (item as any).duration_seconds ? Math.round(((item.progress.watched_seconds ?? 0) / (item as any).duration_seconds) * 100) : undefined;
          return (
            <Link
              key={item.id}
              href={`/student/videos/${item.id}`}
              className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-3 hover:border-brand-200 hover:bg-surface-muted/30 transition-colors"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <Play className="h-4 w-4 text-brand-600" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{item.title}</p>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                  <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{pct != null ? `${pct}%` : `${Math.floor((item.progress.watched_seconds ?? 0) / 60)}m`} watched</span>
                  {item.progress.last_watched_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{timeAgo(item.progress.last_watched_at)}</span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
