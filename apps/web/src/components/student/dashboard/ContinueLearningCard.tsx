'use client';

import Link from 'next/link';
import { Play, Clock, PlayCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface ContinueItem {
  id: string;
  title: string;
  watchedSeconds: number;
  durationSeconds?: number;
  lastWatchedAt?: string | null;
}

function formatDuration(s: number) {
  if (!isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function ContinueLearningCard({ item }: { item: ContinueItem | null }) {
  if (!item) {
    return (
      <Card padding="lg">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
            <PlayCircle className="h-5 w-5 text-brand-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">Start Learning</p>
            <p className="text-xs text-text-muted">Pick a recording to begin</p>
          </div>
        </div>
        <Link href="/student/videos" className="mt-4 inline-flex">
          <Button size="sm">Browse Videos</Button>
        </Link>
      </Card>
    );
  }

  const pct = item.durationSeconds && item.durationSeconds > 0 ? Math.min(100, Math.round((item.watchedSeconds / item.durationSeconds) * 100)) : 0;

  return (
    <Card padding="lg" className="border-brand-200 shadow-card hover:shadow-card-hover hover:-translate-y-[1px] transition-all motion-safe:duration-200">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Continue Learning</p>
        {pct > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{pct}%</span>}
      </div>
      <h3 className="mt-2 line-clamp-2 text-base font-bold leading-tight text-text-primary">{item.title}</h3>
      <div className="mt-3">
        {pct > 0 ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-brand-600 motion-safe:transition-all motion-safe:duration-700" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <div className="h-1.5 rounded-full bg-surface-muted" />
        )}
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          <Clock className="h-3 w-3 shrink-0" />
          <span>
            {item.watchedSeconds > 0 ? `${formatDuration(item.watchedSeconds)} watched` : 'Not started'}
            {item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)} total` : ''}
          </span>
        </div>
      </div>
      <Link href={`/student/videos/${item.id}`} className="mt-4 inline-flex">
        <Button size="md" icon={<Play className="h-4 w-4" />} className="shadow-sm">
          {item.watchedSeconds > 0 ? 'Continue Learning' : 'Start Learning'}
        </Button>
      </Link>
    </Card>
  );
}
