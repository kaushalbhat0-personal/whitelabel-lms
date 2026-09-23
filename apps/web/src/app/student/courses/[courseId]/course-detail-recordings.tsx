'use client';

import Link from 'next/link';
import { PlayCircle, Clock, Film } from 'lucide-react';
import type { GroupedRecording } from '@/lib/api/videos';

interface Props {
  videos: GroupedRecording[];
  hideHeader?: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

export function CourseDetailRecordings({ videos, hideHeader }: Props) {
  if (videos.length === 0) {
    if (hideHeader) {
      return (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Film className="h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">No recordings in this section yet.</p>
        </div>
      );
    }
    return (
      <div className="rounded-card border border-surface-border bg-surface-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Recordings
        </h3>
        <div className="mt-4 flex flex-col items-center gap-2 py-4 text-center">
          <Film className="h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">
            No recordings available yet.
          </p>
        </div>
      </div>
    );
  }

  if (hideHeader) {
    return (
      <div className="space-y-2">
        {videos.map((video) => (
          <Link
            key={video.id}
            href={`/student/videos/${video.id}`}
            className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface-muted p-3 transition-colors hover:bg-brand-navy/5 min-h-[44px]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-navy/10">
              <PlayCircle className="h-4 w-4 text-brand-navy" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">
                {video.title}
              </p>
              {video.description?.trim() ? (
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-text-secondary">
                  {video.description.trim()}
                </p>
              ) : null}
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <span>{formatDate(video.createdAt)}</span>
                {video.durationSeconds ? (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Math.floor(video.durationSeconds / 60)}m
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <PlayCircle className="h-5 w-5 shrink-0 text-text-muted" />
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Recordings
      </h3>
      <div className="mt-3 space-y-2">
        {videos.map((video) => (
          <Link
            key={video.id}
            href={`/student/videos/${video.id}`}
            className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface-muted p-3 transition-colors hover:bg-brand-navy/5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-navy/10">
              <PlayCircle className="h-4 w-4 text-brand-navy" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">
                {video.title}
              </p>
              {video.description?.trim() ? (
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-text-secondary">
                  {video.description.trim()}
                </p>
              ) : null}
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <span>{formatDate(video.createdAt)}</span>
                {video.durationSeconds ? (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Math.floor(video.durationSeconds / 60)}m
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <PlayCircle className="h-5 w-5 shrink-0 text-text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
