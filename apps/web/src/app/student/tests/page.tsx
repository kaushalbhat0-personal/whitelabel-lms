'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Clock, AlertTriangle, CheckCircle, BarChart3, Play, Eye } from 'lucide-react';
import { getMyTests, getMyAttempts } from '@/lib/api/assessments';
import type { TestResponse } from '@/lib/api/assessments';
import { ROUTES } from '@/lib/constants';
import { PageHeader } from '@/components/shared/PageHeader';
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

function getStatusLabel(status: string) {
  switch (status) {
    case 'published': return 'Available';
    case 'scheduled': return 'Scheduled';
    case 'active': return 'Active';
    case 'closed': return 'Completed';
    default: return status;
  }
}

function getStatusVariant(status: string) {
  switch (status) {
    case 'published':
    case 'active': return 'text-status-success bg-status-success/10';
    case 'scheduled': return 'text-status-scheduled bg-status-scheduled/10';
    case 'closed': return 'text-status-ended bg-status-ended/10';
    default: return 'text-text-muted bg-surface-muted';
  }
}

interface TestCardProps {
  test: TestResponse;
  attempts: { testId: string; id: string; status: string }[];
  onStart: (testId: string) => void;
  onViewResult: (attemptId: string) => void;
}

function TestCard({ test, attempts, onStart, onViewResult }: TestCardProps) {
  const isAvailable = test.status === 'published' || test.status === 'scheduled' || test.status === 'active';
  const testAttempts = attempts.filter((a) => a.testId === test.id);
  const completedAttempt = testAttempts.find((a) => a.status === 'submitted' || a.status === 'graded');

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4 transition-colors hover:border-brand-navy/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">
              {test.title}
            </h3>
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', getStatusVariant(test.status))}>
              {getStatusLabel(test.status)}
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

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
            {test.start_time && <span>Start: {formatDate(test.start_time)}</span>}
            {test.end_time && <span>End: {formatDate(test.end_time)}</span>}
          </div>

          {testAttempts.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-text-secondary">
              <FileText className="h-3 w-3" />
              <span>{testAttempts.length} attempt{testAttempts.length !== 1 ? 's' : ''}</span>
              {testAttempts.some((a) => a.status === 'in_progress') && (
                <span className="text-status-scheduled">(In progress)</span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0">
          {isAvailable ? (
            completedAttempt ? (
              <button
                onClick={() => onViewResult(completedAttempt.id)}
                className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navyDark"
              >
                <Eye className="h-3.5 w-3.5" />
                View Result
              </button>
            ) : (
              <button
                onClick={() => onStart(test.id)}
                className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navyDark"
              >
                <Play className="h-3.5 w-3.5" />
                {testAttempts.some((a) => a.status === 'in_progress') ? 'Resume' : 'Start Test'}
              </button>
            )
          ) : completedAttempt ? (
            <button
              onClick={() => onViewResult(completedAttempt.id)}
              className="flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-muted"
            >
              <Eye className="h-3.5 w-3.5" />
              View Result
            </button>
          ) : null}
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

  const availableTests = tests.filter((t) => t.status === 'published' || t.status === 'scheduled' || t.status === 'active');
  const completedTests = tests.filter((t) => t.status === 'closed');

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
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-navy border-t-transparent" />
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
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">No tests available</p>
            <p className="text-xs text-text-secondary">
              Tests assigned to your batches will appear here.
            </p>
          </div>
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
