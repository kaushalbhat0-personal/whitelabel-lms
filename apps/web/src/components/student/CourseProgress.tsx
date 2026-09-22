'use client';

import { useEffect, useState } from 'react';
import { getMyVideos, getMyVideosGrouped } from '@/lib/api/videos';
import { CheckCircle2, Play } from 'lucide-react';
import type { StudentVideo, StudentBatchRecordings } from '@/lib/api/videos';

interface CourseProgressProps {
  courseId?: string;
  batchIds?: string[];
  compact?: boolean;
}

export function CourseProgress({ courseId, batchIds, compact }: CourseProgressProps) {
  const [recordings, setRecordings] = useState<StudentVideo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (batchIds && batchIds.length > 0) {
          const grouped = await getMyVideosGrouped();
          if (cancelled) return;
          const flat = grouped
            .filter((g) => batchIds.includes(g.batchId))
            .flatMap((g) => g.sections)
            .flatMap((s) => s.recordings);
          const dedup = [...new Map(flat.map((r: any) => [r.id, r] as const)).values()];
          setRecordings(dedup as any);
        } else {
          const all = await getMyVideos();
          if (cancelled) return;
          setRecordings(all);
        }
      } catch {
        if (!cancelled) setRecordings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [batchIds]);

  if (loading || recordings.length === 0) return null;

  const completed = recordings.filter((r) => r.progress?.completed).length;
  const started = recordings.filter((r) => (r.progress?.watched_seconds || 0) > 0).length;
  const progressPct = Math.round((completed / recordings.length) * 100);
  const barSegments = 30;
  const filledSegments = Math.round((progressPct / 100) * barSegments);

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-text-primary">Course Progress</span>
          <span className="text-text-muted">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-navy transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-text-muted">
          {completed} / {recordings.length} recordings completed
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-text-primary">Course Progress</h3>
        <span className="text-sm font-bold text-brand-navy">{progressPct}%</span>
      </div>

      <div className="font-mono text-xs sm:text-base tracking-tight sm:tracking-wider mb-4 text-text-primary overflow-hidden whitespace-nowrap leading-none" aria-hidden="true" style={{ letterSpacing: '0.02em' }}>
        {Array.from({ length: barSegments }).map((_, i) => (
          <span key={i} className={i < filledSegments ? 'text-brand-navy' : 'text-surface-border'}>
            █
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <div>
            <p className="text-xs font-medium text-emerald-700">{completed} Completed</p>
            <p className="text-2xs text-emerald-500">{completed > 0 ? Math.round((completed / recordings.length) * 100) : 0}%</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-brand-50 p-3">
          <Play className="h-4 w-4 text-brand-600 shrink-0" fill="currentColor" />
          <div>
            <p className="text-xs font-medium text-brand-700">{started - completed} In Progress</p>
            <p className="text-2xs text-brand-500">{recordings.length - completed} Remaining</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
        <span>Total recordings: {recordings.length}</span>
      </div>
    </div>
  );
}