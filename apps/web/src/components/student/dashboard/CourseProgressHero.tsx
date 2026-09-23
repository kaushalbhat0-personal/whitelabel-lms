'use client';

import Link from 'next/link';
import { BookOpen, CheckCircle2, Play, ChevronRight, TrendingUp, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { StudentBatchRecordings } from '@/lib/api/videos';

interface Props {
  total: number;
  completed: number;
  inProgress: number;
  courseName?: string | null;
  batchName?: string | null;
  grouped?: StudentBatchRecordings[];
}

export function CourseProgressHero({ total, completed, inProgress, courseName, batchName, grouped }: Props) {
  const pctCourse = total > 0 ? Math.round((completed / total) * 100) : 0;
  const remainingCourse = Math.max(0, total - completed - inProgress);

  if (total === 0) {
    return (
      <Card padding="lg">
        <div className="text-center py-4">
          <BookOpen className="mx-auto h-8 w-8 text-text-muted" />
          <p className="mt-2 text-sm font-medium text-text-primary">Your learning journey starts here</p>
          <p className="text-xs text-text-muted mt-1">Enroll in a batch to track progress</p>
          <Link href="/student/courses" className="mt-3 inline-flex text-xs font-medium text-brand-600 hover:text-brand-700">
            Browse courses <ChevronRight className="ml-1 h-3 w-3" />
          </Link>
        </div>
      </Card>
    );
  }

  // Primary batch — Hero must represent ONE coherent batch
  const primaryBatch = (() => {
    if (!grouped || grouped.length === 0) return null;
    const byName = batchName ? grouped.find((b) => b.batchName === batchName) : null;
    return byName ?? grouped[0];
  })();
  const sections = primaryBatch?.sections ?? [];
  const hasSections = sections.length > 0;

  // Ordered recordings in curriculum order (Phase A guarantees sort_order)
  const orderedRecordings = hasSections ? sections.flatMap((s) => s.recordings) : [];

  // Scoped progress — totals must reflect primary batch only (fix 8/0% leakage)
  const scoped = (() => {
    if (!hasSections) return { total, completed, inProgress, remaining: remainingCourse, pct: pctCourse };
    const t = orderedRecordings.length;
    const c = orderedRecordings.filter((r) => r.progress.completed).length;
    const ip = orderedRecordings.filter((r) => !r.progress.completed && r.progress.watchedSeconds > 0).length;
    const rem = Math.max(0, t - c - ip);
    const p = t > 0 ? Math.round((c / t) * 100) : 0;
    return { total: t, completed: c, inProgress: ip, remaining: rem, pct: p };
  })();
  const pct = hasSections ? scoped.pct : pctCourse;
  const remaining = hasSections ? scoped.remaining : remainingCourse;
  const displayTotal = hasSections ? scoped.total : total;
  const displayCompleted = hasSections ? scoped.completed : completed;
  const displayInProgress = hasSections ? scoped.inProgress : inProgress;

  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (pct / 100) * circumference;

  // Section-level fallback for current/next when no recording (kept for compatibility)
  const currentIdxSection = hasSections
    ? (() => {
        let idx = sections.findIndex((s) => s.recordings.some((r) => !r.progress.completed && r.progress.watchedSeconds > 0));
        if (idx === -1) idx = sections.findIndex((s) => s.recordings.some((r) => !r.progress.completed));
        return idx;
      })()
    : -1;
  const currentSection = currentIdxSection !== -1 ? sections[currentIdxSection] : null;

  const nextIdxSection = hasSections
    ? sections.findIndex((s, idx) => {
        const prevDone = sections.slice(0, idx).every((ps) => ps.recordings.every((r) => r.progress.completed));
        return !s.recordings.every((r) => r.progress.completed) && prevDone && s !== currentSection;
      })
    : -1;
  const nextSection = nextIdxSection !== -1 ? sections[nextIdxSection] : null;

  // Recording-aware Current/Next
  const currentRecording =
    orderedRecordings.find((r) => !r.progress.completed && r.progress.watchedSeconds > 0) ??
    orderedRecordings.find((r) => !r.progress.completed) ??
    null;
  const currentLabel =
    currentRecording?.title ??
    currentSection?.sectionName ??
    (inProgress > 0 ? 'In progress' : remaining > 0 ? 'Not started' : 'Completed');

  const nextRecording = (() => {
    if (!currentRecording) return null;
    const curIdx = orderedRecordings.findIndex((r) => r.id === currentRecording.id);
    if (curIdx === -1) return null;
    return orderedRecordings.slice(curIdx + 1).find((r) => !r.progress.completed) ?? null;
  })();
  const nextLabel =
    nextRecording?.title ??
    nextSection?.sectionName ??
    (remaining > 1 ? `${remaining} remaining` : remaining === 1 ? '1 remaining' : null);

  const currentCategory = currentRecording
    ? sections.find((s) => s.recordings.some((r) => r.id === currentRecording.id))?.sectionName
    : null;

  return (
    <Card padding="lg" className="overflow-hidden transition-shadow hover:shadow-card-hover">
      {/* Header: Learning Momentum */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Learning Momentum</p>
          </div>
          <p className="mt-1 text-[11px] leading-none text-text-muted">Your learning is moving forward.</p>
          {courseName && <p className="mt-2 text-sm font-medium text-text-primary truncate">{courseName}</p>}
          {batchName && <p className="text-xs text-text-muted truncate">{batchName}</p>}
        </div>
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center" aria-hidden>
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" strokeWidth="4" className="fill-none stroke-brand-100" />
            <circle
              cx="32"
              cy="32"
              r="28"
              strokeWidth="4"
              className="fill-none stroke-brand-600 motion-safe:transition-all motion-safe:duration-[900ms] motion-safe:ease-out"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span className="absolute text-sm font-bold text-brand-700">{pct}%</span>
        </div>
      </div>

      {/* Progress bar — compact, full-width, accessible */}
      <div
        className="mt-4"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Course progress: ${pct}% — ${displayCompleted} of ${displayTotal} completed`}
      >
        <div className="h-2 rounded-full bg-surface-muted">
          <div
            className="h-2 rounded-full bg-brand-600 motion-safe:transition-all motion-safe:duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="sr-only">{pct}% complete. {displayCompleted} of {displayTotal} completed.</p>
      </div>

      <p className="mt-2 text-xs text-text-muted">
        <span className="font-medium text-text-primary">{displayCompleted} / {displayTotal}</span> completed · {displayInProgress} in progress · {remaining} remaining
        <span className="ml-1.5 hidden sm:inline text-brand-600">• {pct}% complete</span>
      </p>

      {/* Current / Next — recording-aware, stack on mobile */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-3 border border-surface-border">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none">Current position</p>
            <p className="mt-1 text-xs font-medium text-text-primary break-words" title={currentLabel ?? undefined}>
              {currentLabel}
            </p>
            {currentCategory && currentRecording && (
              <p className="mt-1 truncate text-[10px] leading-none text-text-muted">{currentCategory}</p>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-3 border border-surface-border">
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none">Next up</p>
            <p className="mt-1 text-xs font-medium text-text-primary break-words" title={nextLabel ?? undefined}>
              {nextLabel ?? '—'}
            </p>
          </div>
        </div>
      </div>

      <p className="sr-only">
        {displayCompleted} of {displayTotal} completed, {displayInProgress} in progress, {remaining} not started. Current position {currentLabel}
        {nextLabel ? `, next up ${nextLabel}` : ''}.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 py-2">
          <div className="flex items-center justify-center gap-1 text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold">{displayCompleted}</span>
          </div>
          <p className="text-2xs text-emerald-600">Completed</p>
        </div>
        <div className="rounded-lg bg-brand-50 py-2">
          <div className="flex items-center justify-center gap-1 text-brand-700">
            <Play className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold">{displayInProgress}</span>
          </div>
          <p className="text-2xs text-brand-600">In Progress</p>
        </div>
        <div className="rounded-lg bg-surface-muted py-2">
          <span className="text-xs font-semibold text-text-secondary">{remaining}</span>
          <p className="text-2xs text-text-muted">Not Started</p>
        </div>
      </div>
    </Card>
  );
}
