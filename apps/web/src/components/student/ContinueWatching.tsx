'use client';

import Link from 'next/link';
import { Play, Clock } from 'lucide-react';

export interface Watchable {
  id: string;
  title: string;
  duration_seconds?: number;
  durationSeconds?: number;
  progress: {
    watched_seconds?: number;
    watchedSeconds?: number;
    completed?: boolean;
    last_watched_at?: string | null;
    lastWatchedAt?: string | null;
  };
}

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

interface ContinueWatchingItem {
  id: string;
  title: string;
  watchedSeconds: number;
  totalDuration: number;
  completed: boolean;
  lastWatchedAt: string | null;
}

export function ContinueWatching({ recordings }: { recordings: Watchable[] }) {
  const items: ContinueWatchingItem[] = recordings
    .map((v) => ({
      id: v.id,
      title: v.title,
      watchedSeconds: v.progress?.watched_seconds ?? v.progress?.watchedSeconds ?? 0,
      totalDuration: v.duration_seconds ?? v.durationSeconds ?? 0,
      completed: v.progress?.completed ?? false,
      lastWatchedAt: v.progress?.last_watched_at ?? v.progress?.lastWatchedAt ?? null,
    }))
    .filter((v) => v.watchedSeconds > 30 && !v.completed)
    .sort((a, b) => {
      if (!a.lastWatchedAt) return 1;
      if (!b.lastWatchedAt) return -1;
      return (
        new Date(b.lastWatchedAt).getTime() -
        new Date(a.lastWatchedAt).getTime()
      );
    })
    .slice(0, 5);

  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-bold text-text-primary">
        Continue Watching
      </h2>
      <div className="space-y-3">
        {items.map((item) => {
          const progressPct =
            item.totalDuration > 0
              ? Math.min(100, (item.watchedSeconds / item.totalDuration) * 100)
              : 0;
          return (
            <Link
              key={item.id}
              href={`/student/videos/${item.id}`}
              className="group flex items-center gap-4 rounded-xl border border-surface-border bg-surface-card p-4 transition-all hover:border-brand-navy/30 hover:shadow-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-navy/10 text-brand-navy group-hover:bg-brand-navy group-hover:text-white transition-colors">
                <Play className="h-5 w-5" fill="currentColor" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-text-primary truncate">
                  {item.title}
                </h3>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-navy transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-muted tabular-nums shrink-0">
                    {formatDuration(item.watchedSeconds)} / {formatDuration(item.totalDuration)}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-xs font-medium text-brand-navy opacity-0 group-hover:opacity-100 transition-opacity">
                Resume &rarr;
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}