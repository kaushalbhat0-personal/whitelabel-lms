'use client';

import Link from 'next/link';
import { PlayCircle, Clock, Film } from 'lucide-react';
import { type StudentVideo } from '@/lib/api/videos';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

interface Props {
  recordings: StudentVideo[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function RecordingsList({ recordings }: Props) {
  if (recordings.length === 0) {
    return (
      <EmptyState
        icon={<Film className="h-12 w-12" />}
        title="No recordings yet"
        description="Your batch recordings will appear here after they are published."
      />
    );
  }

  // Group by topic
  const grouped = recordings.reduce<Record<string, StudentVideo[]>>(
    (acc, rec) => {
      const topic = rec.topics?.name || 'Uncategorized';
      if (!acc[topic]) acc[topic] = [];
      acc[topic].push(rec);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([topicName, recs]) => (
        <div key={topicName}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {topicName}
          </h3>
          <div className="space-y-2">
            {recs.map((rec) => (
              <Link
                key={rec.id}
                href={`/student/videos/${rec.id}`}
                className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3 transition-colors hover:bg-surface-muted"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand-navy/10">
                  <PlayCircle className="h-6 w-6 text-brand-navy" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {rec.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                    <span>{formatDate(rec.created_at)}</span>
                    {rec.progress.watched_seconds > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {Math.floor(rec.progress.watched_seconds / 60)}m
                        </span>
                      </>
                    )}
                  </div>
                  {rec.progress.completed && (
                    <span className="mt-0.5 inline-block text-[10px] font-medium text-status-success">
                      Completed
                    </span>
                  )}
                </div>
                <PlayCircle className="h-5 w-5 shrink-0 text-text-muted" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
