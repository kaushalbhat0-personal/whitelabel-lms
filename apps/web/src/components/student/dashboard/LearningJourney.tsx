'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, CheckCircle2, Circle, PlayCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StudentBatchRecordings } from '@/lib/api/videos';

export function LearningJourney({ data }: { data: StudentBatchRecordings[] }) {
  const findCurrent = () => {
    for (const batch of data) {
      for (const section of batch.sections) {
        const sInProgress = section.recordings.filter((r) => !r.progress.completed && r.progress.watchedSeconds > 0).length;
        const sCompleted = section.recordings.filter((r) => r.progress.completed).length;
        const state = sCompleted === section.recordings.length && section.recordings.length > 0 ? 'completed' : sInProgress > 0 ? 'inprogress' : 'notstarted';
        if (state === 'inprogress') return { batchId: batch.batchId, sectionKey: `${batch.batchId}-${section.sectionName}` };
      }
    }
    // fallback: first notstarted with unwatched
    for (const batch of data) {
      for (const section of batch.sections) {
        const hasUnstarted = section.recordings.some((r) => !r.progress.completed && r.progress.watchedSeconds === 0);
        if (hasUnstarted) return { batchId: batch.batchId, sectionKey: `${batch.batchId}-${section.sectionName}` };
      }
    }
    return { batchId: data[0]?.batchId ?? null, sectionKey: null as string | null };
  };
  const initial = findCurrent();
  const [openBatch, setOpenBatch] = useState<string | null>(initial.batchId);
  const [openSection, setOpenSection] = useState<string | null>(initial.sectionKey);

  if (!data || data.length === 0) {
    return (
      <div className="rounded-card border border-surface-border bg-surface-card p-6 text-center">
        <p className="text-sm text-text-secondary">No curriculum yet</p>
        <p className="text-xs text-text-muted mt-1">Your batch curriculum will appear here</p>
        <Link href="/student/videos" className="mt-3 inline-flex text-xs font-medium text-brand-600 hover:text-brand-700">
          Browse videos
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((batch) => {
        const isOpen = openBatch === batch.batchId;
        const totalRecordings = batch.sections.reduce((a, s) => a + s.recordings.length, 0);
        const completed = batch.sections.reduce((a, s) => a + s.recordings.filter((r) => r.progress.completed).length, 0);
        return (
          <div key={batch.batchId} className="rounded-card border border-surface-border bg-surface-card overflow-hidden">
            <button
              onClick={() => setOpenBatch(isOpen ? null : batch.batchId)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-muted/50 transition-colors touch-target"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">{batch.batchName}</p>
                <p className="text-xs text-text-muted">
                  {completed}/{totalRecordings} completed · {batch.sections.length} section{batch.sections.length !== 1 ? 's' : ''}
                </p>
              </div>
              <ChevronDown className={cn('h-4 w-4 text-text-muted motion-safe:transition-transform motion-safe:duration-200', isOpen && 'rotate-180')} />
            </button>

            <div className={cn('grid motion-safe:transition-all motion-safe:duration-200', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
              <div className="overflow-hidden">
                <div className="border-t border-surface-border divide-y divide-surface-border">
                  {batch.sections.map((section) => {
                    const sKey = `${batch.batchId}-${section.sectionName}`;
                    const sOpen = openSection === sKey;
                    const sCompleted = section.recordings.filter((r) => r.progress.completed).length;
                    const sInProgress = section.recordings.filter((r) => !r.progress.completed && r.progress.watchedSeconds > 0).length;
                    const sState = sCompleted === section.recordings.length && section.recordings.length > 0 ? 'completed' : sInProgress > 0 ? 'inprogress' : 'notstarted';
                    const isCurrentSection = sState === 'inprogress';
                    return (
                      <div key={sKey} className={cn(isCurrentSection && 'bg-brand-50/40')}>
                        <button
                          onClick={() => setOpenSection(sOpen ? null : sKey)}
                          aria-expanded={sOpen}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted/30 focus-visible:bg-surface-muted/50 focus-visible:outline-none transition-colors touch-target"
                        >
                          {sState === 'completed' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 motion-safe:animate-[scaleIn_0.3s_ease-out]" />
                          ) : sState === 'inprogress' ? (
                            <PlayCircle className="h-4 w-4 text-brand-600 shrink-0" />
                          ) : (
                            <Circle className="h-4 w-4 text-text-muted shrink-0" />
                          )}
                          <span className="flex-1 truncate text-sm font-medium text-text-primary">{section.sectionName ?? 'General'}</span>
                          {isCurrentSection && <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-2xs font-semibold text-brand-700">Current</span>}
                          <span className="text-xs text-text-muted shrink-0">
                            {sCompleted}/{section.recordings.length}
                          </span>
                          <ChevronDown className={cn('h-3.5 w-3.5 text-text-muted motion-safe:transition-transform motion-safe:duration-200', sOpen && 'rotate-180')} />
                        </button>
                        <div className={cn('grid motion-safe:transition-all motion-safe:duration-200', sOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                          <div className="overflow-hidden">
                            <div className="bg-surface-muted/30 px-4 pb-3 pt-1 space-y-1">
                              {section.recordings.map((rec) => {
                                const isCompleted = rec.progress.completed;
                                const isStarted = rec.progress.watchedSeconds > 0;
                                const isCurrentLesson = isStarted && !isCompleted;
                                return (
                                  <Link
                                    key={rec.id}
                                    href={`/student/videos/${rec.id}`}
                                    className={cn(
                                      'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
                                      isCurrentLesson ? 'bg-brand-50 border-brand-200' : 'bg-surface-card border-surface-border hover:border-brand-200',
                                    )}
                                  >
                                    {isCompleted ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                    ) : isStarted ? (
                                      <Clock className="h-4 w-4 text-brand-600 shrink-0" />
                                    ) : (
                                      <Circle className="h-4 w-4 text-text-muted shrink-0" />
                                    )}
                                    <span className="flex-1 truncate text-sm text-text-primary">{rec.title}</span>
                                    {isStarted && !isCompleted && rec.durationSeconds && (
                                      <span className="text-2xs font-medium text-brand-600">{Math.round((rec.progress.watchedSeconds / rec.durationSeconds) * 100)}%</span>
                                    )}
                                    {isStarted && !isCompleted && !rec.durationSeconds && (
                                      <span className="text-2xs text-text-muted">{Math.floor(rec.progress.watchedSeconds / 60)}m watched</span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
