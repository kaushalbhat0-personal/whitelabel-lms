'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Clock, AlertTriangle, CheckCircle, BarChart3, Play, Eye } from 'lucide-react';
import { getMyTests, getMyAttempts } from '@/lib/api/assessments';
import type { TestResponse } from '@/lib/api/assessments';
import { ROUTES } from '@/lib/constants';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function getGlobalTestState(test: TestResponse, now: number): string {
  if (test.status === 'draft' || test.status === 'archived') return test.status;
  if (test.status === 'cancelled') return 'cancelled';
  if (!test.start_time) return test.status === 'published' ? 'published' : test.status;
  const start = new Date(test.start_time).getTime();
  const end = test.end_time ? new Date(test.end_time).getTime() : start + (test.duration_minutes ?? 60) * 60000;
  if (now < start) return 'scheduled';
  if (now > end) return 'ended';
  return 'published';
}

function isCompletedStatus(s: string) {
  return ['submitted', 'evaluated', 'published', 'partially_evaluated', 'graded', 'completed'].includes(s);
}

function getStudentDisplay(test: TestResponse, attemptsForTest: { status: string }[], now: number) {
  const completedAttempts = attemptsForTest.filter((a) => isCompletedStatus(a.status));
  const completedCount = completedAttempts.length;
  const maxAttempts = (test as any).max_attempts ?? 1;
  const hasReachedMax = maxAttempts > 0 && completedCount >= maxAttempts;

  const latestCompleted = completedAttempts[completedAttempts.length - 1] ?? completedAttempts[0] ?? null;

  const inProgress = attemptsForTest.find((a) => a.status === 'in_progress');
  if (inProgress) return { label: 'In Progress', variant: 'text-status-scheduled bg-status-scheduled/10', cta: 'Resume' as const, section: 'available' as const, completedCount, maxAttempts, hasReachedMax };

  // If we have any completed attempt, show Completed (View Result) — max attempts also maps to Completed
  if (completedCount > 0) {
    if (hasReachedMax) {
      return { label: 'Completed', variant: 'text-status-success bg-status-success/10', cta: 'View Result' as const, section: 'completed' as const, completedCount, maxAttempts, hasReachedMax };
    }
    // Not yet at max: CTA depends on whether another attempt is allowed
    // But primary CTA remains View Result; secondary start is handled in TestCard via hasReachedMax check
    return { label: 'Completed', variant: 'text-status-success bg-status-success/10', cta: 'View Result' as const, section: 'completed' as const, completedCount, maxAttempts, hasReachedMax };
  }

  const global = getGlobalTestState(test, now);
  if (global === 'scheduled') return { label: 'Scheduled', variant: 'text-status-scheduled bg-status-scheduled/10', cta: null, section: 'scheduled' as const, completedCount, maxAttempts, hasReachedMax };
  if (global === 'ended') return { label: 'Ended', variant: 'text-status-ended bg-status-ended/10', cta: null, section: 'ended' as const, completedCount, maxAttempts, hasReachedMax };
  if (global === 'draft') return { label: 'Draft', variant: 'text-text-muted bg-surface-muted', cta: null, section: 'scheduled' as const, completedCount, maxAttempts, hasReachedMax };
  return { label: 'Available', variant: 'text-status-success bg-status-success/10', cta: 'Start Test' as const, section: 'available' as const, completedCount, maxAttempts, hasReachedMax };
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'published': return 'Available';
    case 'scheduled': return 'Scheduled';
    case 'active': return 'Active';
    case 'closed': return 'Completed';
    case 'completed': return 'Completed';
    case 'ended': return 'Ended';
    default: return status;
  }
}

function getStatusVariant(status: string) {
  switch (status) {
    case 'published':
    case 'active':
    case 'completed': return 'text-status-success bg-status-success/10';
    case 'scheduled': return 'text-status-scheduled bg-status-scheduled/10';
    case 'closed':
    case 'ended': return 'text-status-ended bg-status-ended/10';
    default: return 'text-text-muted bg-surface-muted';
  }
}

interface TestCardProps {
  test: TestResponse;
  attempts: { testId: string; id: string; status: string }[];
  onStart: (testId: string) => void;
  onViewResult: (attemptId: string) => void;
}

function TestCard({ test, attempts, onStart, onViewResult, now }: TestCardProps & { now: number }) {
  const testAttempts = (attempts as any[]).filter((a: any) => a.testId === test.id);
  const completedAttempts = (testAttempts as any[]).filter((a: any) => isCompletedStatus(a.status));
  const completedAttempt = completedAttempts.length > 0 ? completedAttempts[completedAttempts.length - 1] : null;
  const inProgressAttempt = (testAttempts as any[]).find((a: any) => a.status === 'in_progress');
  const display = getStudentDisplay(test as any, testAttempts as any, now);
  const statusLabel = display.label;
  const statusVariant = display.variant;
  const hasReachedMax = (display as any).hasReachedMax;
  const canStartAnother = !hasReachedMax && completedAttempts.length > 0 && (test as any).max_attempts > completedAttempts.length;

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4 transition-colors hover:border-brand-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">
              {test.title}
            </h3>
            <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', statusVariant)}>
              {statusLabel}
            </span>
          </div>

          {test.description && (
            <p className="mt-1 text-xs text-text-secondary line-clamp-2">{test.description}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
            {test.duration_minutes && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {test.duration_minutes} min
              </span>
            )}
            <span className="flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              {test.total_marks} marks
            </span>
            {test.passing_marks > 0 && (
              <span>Pass: {test.passing_marks}</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {test.start_time && <span>Start: {formatDate(test.start_time)}</span>}
            {test.end_time && <span>End: {formatDate(test.end_time)}</span>}
          </div>

          {testAttempts.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
              <FileText className="h-3 w-3" />
              <span>{testAttempts.length} attempt{testAttempts.length !== 1 ? 's' : ''}</span>
              {testAttempts.some((a) => a.status === 'in_progress') && (
                <span className="text-status-scheduled">(In progress)</span>
              )}
              {!hasReachedMax && testAttempts.length > 0 && (test as any).max_attempts > 1 && (
                <span className="text-text-muted">· {testAttempts.length}/{ (test as any).max_attempts} used</span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col gap-1.5 items-end">
          {inProgressAttempt ? (
            <button
              onClick={() => onStart(test.id)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <Play className="h-4 w-4" />
              Resume
            </button>
          ) : hasReachedMax && completedAttempt ? (
            <button
              onClick={() => onViewResult(completedAttempt.id)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <Eye className="h-4 w-4" />
              View Result
            </button>
          ) : completedAttempt ? (
            <>
              <button
                onClick={() => onViewResult(completedAttempt.id)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <Eye className="h-4 w-4" />
                View Result
              </button>
              {canStartAnother && (
                <button
                  onClick={() => onStart(test.id)}
                  className="flex min-h-[44px] items-center gap-1 rounded-lg border border-brand-600 px-3 py-2 text-xs font-medium text-brand-600 hover:bg-brand-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Retake ({completedAttempts.length}/{ (test as any).max_attempts})
                </button>
              )}
            </>
          ) : display.cta === 'Start Test' ? (
            <button
              onClick={() => onStart(test.id)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <Play className="h-4 w-4" />
              Start Test
            </button>
          ) : display.cta ? (
            <button
              onClick={() => onStart(test.id)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <Play className="h-4 w-4" />
              {display.cta}
            </button>
          ) : null}
          {hasReachedMax && (
            <span className="text-xs text-text-muted">Max attempts reached</span>
          )}
          {(test as any).max_attempts === 0 && (
            <span className="text-xs text-text-muted">Unlimited attempts</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TestsPage() {
  const router = useRouter();
  const [tests, setTests] = useState<TestResponse[]>([]);
  const [attempts, setAttempts] = useState<{ testId: string; id: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [testsRes, attemptsRes] = await Promise.all([
          getMyTests(),
          getMyAttempts(),
        ]);
        setTests(testsRes.items ?? []);
        setAttempts((attemptsRes.items ?? []).map((a: any) => ({ testId: a.test_id ?? a.testId, id: a.id, status: a.status })));
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const availableTests = (tests as any[])
    .filter((t: any) => {
      const atts = (attempts as any[]).filter((a: any) => a.testId === t.id);
      const disp = getStudentDisplay(t as any, atts as any, now);
      return disp.section === 'available' || disp.section === 'scheduled';
    })
    .sort((a: any, b: any) => {
      const ae = a.end_time ? new Date(a.end_time).getTime() : a.start_time ? new Date(a.start_time).getTime() : Infinity;
      const be = b.end_time ? new Date(b.end_time).getTime() : b.start_time ? new Date(b.start_time).getTime() : Infinity;
      return ae - be;
    });
  const completedTests = (tests as any[]).filter((t: any) => {
    const atts = (attempts as any[]).filter((a: any) => a.testId === t.id);
    const disp = getStudentDisplay(t as any, atts as any, now);
    return disp.section === 'completed' || disp.section === 'ended';
  });

  const handleStart = (testId: string) => {
    router.push(`/student/tests/attempt/${testId}`);
  };

  const handleViewResult = (attemptId: string) => {
    router.push(`/student/tests/result/${attemptId}`);
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Tests" />
        <div className="px-4 md:px-0">
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 motion-safe:animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-label="Loading" role="status" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tests"
        subtitle={`${tests.length} test${tests.length !== 1 ? 's' : ''}`}
      />
      <div className="space-y-6 px-4 md:px-0">
        {tests.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-12 w-12" />}
            title="No tests available"
            description="You don't have any available tests right now. Tests assigned to your batches will appear here."
          />
        ) : (
          <>
            {availableTests.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Available Tests ({availableTests.length})
                </h3>
                <div className="space-y-2">
                  {availableTests.map((test) => (
                    <TestCard
                      key={test.id}
                      test={test}
                      attempts={attempts}
                      now={now}
                      onStart={handleStart}
                      onViewResult={handleViewResult}
                    />
                  ))}
                </div>
              </section>
            )}

            {completedTests.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Completed ({completedTests.length})
                </h3>
                <div className="space-y-2">
                  {completedTests.map((test) => (
                    <TestCard
                      key={test.id}
                      test={test}
                      attempts={attempts}
                      now={now}
                      onStart={handleStart}
                      onViewResult={handleViewResult}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
