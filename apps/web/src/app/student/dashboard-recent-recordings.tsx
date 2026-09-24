'use client';

import Link from 'next/link';
import { PlayCircle, Clock } from 'lucide-react';
import { type StudentVideo } from '@/lib/api/videos';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

interface Props {
  recordings: StudentVideo[];
}

function secondsToMinutes(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m}m`;
}

export function DashboardRecentRecordings({ recordings }: Props) {
  const { locale, timezone } = useBusinessConfig();
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(locale, { timeZone: timezone, day: 'numeric', month: 'short' });
  };
  const recent = recordings.slice(0, 4);

  if (recent.length === 0) return null;

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Recent Recordings
        </h3>
        {recordings.length > 4 && (
          <Link
            href="/student/videos"
            className="text-xs font-medium text-brand-navy hover:underline"
          >
            See all &rarr;
          </Link>
        )}
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {recent.map((rec) => (
          <Link
            key={rec.id}
            href={`/student/videos/${rec.id}`}
            className="shrink-0"
          >
            <div className="flex w-32 flex-col rounded-lg border border-surface-border bg-surface-muted">
              <div className="flex aspect-video items-center justify-center rounded-t-lg bg-brand-navy/10">
                <PlayCircle className="h-8 w-8 text-brand-navy/40" />
              </div>
              <div className="space-y-1 px-2 py-2">
                <p className="truncate text-xs font-medium text-text-primary">
                  {rec.title}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-text-muted">
                  <span>{formatDate(rec.created_at)}</span>
                  {rec.progress.watched_seconds > 0 && (
                    <>
                      <span>·</span>
                      <Clock className="h-3 w-3" />
                      <span>{secondsToMinutes(rec.progress.watched_seconds)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
