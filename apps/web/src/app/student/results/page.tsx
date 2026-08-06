'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, FileText, Eye } from 'lucide-react';
import { getMyResults } from '@/lib/api/assessments';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn } from '@/lib/utils';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const data = await getMyResults();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  const handleView = (attemptId: string) => {
    router.push(`/student/tests/result/${attemptId}`);
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Results" />
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
        title="Results"
        subtitle={`${results.length} result${results.length !== 1 ? 's' : ''}`}
      />
      <div className="space-y-2 px-4 md:px-0">
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <BarChart3 className="h-10 w-10 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">No results yet</p>
            <p className="text-xs text-text-secondary">
              Your test results will appear here once you complete a test.
            </p>
          </div>
        ) : (
          results.map((result: any) => {
            const totalMarks = result.total_marks ?? result.totalMarks ?? 0;
            const obtainedMarks = result.obtained_marks ?? result.score ?? result.marksAwarded ?? 0;
            const passed = result.passed ?? (obtainedMarks >= totalMarks);
            const percentage = totalMarks > 0
              ? Math.round((obtainedMarks / totalMarks) * 100)
              : (result.percentage ?? 0);

            return (
              <div
                key={result.id}
                className="flex cursor-pointer items-center gap-3 rounded-card border border-surface-border bg-surface-card p-4 transition-colors hover:bg-surface-muted"
                onClick={() => handleView(result.attempt_id ?? result.attemptId ?? result.id)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-navy/10">
                  <FileText className="h-5 w-5 text-brand-navy" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {result.test_title ?? result.testTitle ?? result.title ?? 'Test'}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                    <span>{percentage}%</span>
                    <span>·</span>
                    <span>Rank #{result.rank ?? '—'}</span>
                    <span>·</span>
                    <span>{formatDate(result.published_at ?? result.submittedAt ?? result.created_at ?? new Date().toISOString())}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                    passed ? 'text-status-success bg-status-success/10' : 'text-status-live bg-status-live/10',
                  )}>
                    {passed ? 'Passed' : 'Failed'}
                  </span>
                </div>
                <Eye className="h-5 w-5 shrink-0 text-text-muted" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
