'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Play } from 'lucide-react';
import { getMyVideos } from '@/lib/api/videos';
import type { StudentVideo } from '@/lib/api/videos';

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

export function RecentlyWatched() {
  const [items, setItems] = useState<StudentVideo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMyVideos()
      .then((videos) => {
        if (cancelled) return;
        const sorted = [...videos]
          .filter((v) => v.progress?.watched_seconds > 0)
          .sort((a, b) => {
            if (!a.progress?.last_watched_at) return 1;
            if (!b.progress?.last_watched_at) return -1;
            return new Date(b.progress.last_watched_at).getTime() - new Date(a.progress.last_watched_at).getTime();
          })
          .slice(0, 5);
        setItems(sorted);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading || items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-bold text-text-primary">Recently Watched</h2>
      <div className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/student/videos/${item.id}`}
            className="flex items-center gap-4 rounded-xl border border-surface-border bg-surface-card p-4 transition-all hover:border-brand-navy/30 hover:shadow-sm group"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-navy/10">
              <Play className="h-4 w-4 text-brand-navy ml-0.5" fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary truncate group-hover:text-brand-navy transition-colors">
                {item.title}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <Clock className="h-3 w-3" />
                <span>{formatDuration(item.progress.watched_seconds)} watched</span>
                {item.progress.last_watched_at && (
                  <>
                    <span>·</span>
                    <span>{timeAgo(item.progress.last_watched_at)}</span>
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 text-xs font-medium text-brand-navy opacity-0 group-hover:opacity-100 transition-opacity">
              Resume &rarr;
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}