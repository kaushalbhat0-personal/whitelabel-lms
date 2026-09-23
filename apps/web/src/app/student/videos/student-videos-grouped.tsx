'use client';

import Link from 'next/link';
import { PlayCircle, Clock, CheckCircle, Film } from 'lucide-react';
import type { StudentBatchRecordings, GroupedRecording } from '@/lib/api/videos';

interface Props {
  data: StudentBatchRecordings[];
}

function ProgressBar({ watchedSeconds, completed }: { watchedSeconds: number; completed: boolean }) {
  if (completed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-status-success">
        <CheckCircle className="h-3 w-3" />
        Completed
      </span>
    );
  }

  const pct = Math.min(100, watchedSeconds / 60);
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-brand-600 transition-all"
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

function RecordingCard({ rec }: { rec: GroupedRecording }) {
  return (
    <Link
      href={`/student/videos/${rec.id}`}
      className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3 transition-colors hover:bg-surface-muted"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand-50">
        <PlayCircle className="h-6 w-6 text-brand-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary truncate">
          {rec.title}
        </p>
        {rec.description?.trim() ? (
          <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-text-secondary">
            {rec.description.trim()}
          </p>
        ) : null}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
          {rec.durationSeconds && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {Math.floor(rec.durationSeconds / 60)}m
            </span>
          )}
        </div>
        <ProgressBar watchedSeconds={rec.progress.watchedSeconds} completed={rec.progress.completed} />
      </div>
      <PlayCircle className="h-5 w-5 shrink-0 text-text-muted" />
    </Link>
  );
}

export function StudentVideosGrouped({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Film className="h-10 w-10 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">
          No recordings available
        </p>
        <p className="text-xs text-text-secondary">
          Recordings will appear once your batches are assigned content.
        </p>
      </div>
    );
  }

  return (
    <>
      {data.map((batch) => (
        <div key={batch.batchId}>
          <h2 className="mb-3 text-sm font-semibold text-text-primary">
            {batch.batchName}
          </h2>
          {batch.sections.length === 0 ? (
            <p className="text-xs text-text-muted">No recordings in this batch.</p>
          ) : (
            batch.sections.map((section) => (
              <div key={section.sectionName ?? '__uncategorized__'} className="mb-4">
                {section.sectionName && (
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    {section.sectionName}
                  </h3>
                )}
                <div className="space-y-2">
                  {section.recordings.map((rec) => (
                    <RecordingCard key={rec.id} rec={rec} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </>
  );
}
