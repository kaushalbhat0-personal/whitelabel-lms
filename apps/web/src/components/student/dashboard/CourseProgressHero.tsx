'use client';

import Link from 'next/link';
import { BookOpen, CheckCircle2, Play, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';

interface Props {
  total: number;
  completed: number;
  inProgress: number;
  courseName?: string | null;
  batchName?: string | null;
}

export function CourseProgressHero({ total, completed, inProgress, courseName, batchName }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const remaining = Math.max(0, total - completed - inProgress);

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

  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <Card padding="lg" className="overflow-hidden transition-shadow hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Course Progress</p>
          {courseName && <p className="mt-1 text-sm font-medium text-text-primary truncate">{courseName}</p>}
          {batchName && <p className="text-xs text-text-muted">{batchName}</p>}
        </div>
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64" aria-hidden>
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

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-brand-600 motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-text-muted">{completed} / {total} completed · {inProgress} in progress · {remaining} remaining</p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 py-2">
          <div className="flex items-center justify-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /><span className="text-xs font-semibold">{completed}</span></div>
          <p className="text-2xs text-emerald-600">Completed</p>
        </div>
        <div className="rounded-lg bg-brand-50 py-2">
          <div className="flex items-center justify-center gap-1 text-brand-700"><Play className="h-3.5 w-3.5" /><span className="text-xs font-semibold">{inProgress}</span></div>
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
