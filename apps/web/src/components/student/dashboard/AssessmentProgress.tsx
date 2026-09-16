'use client';

import Link from 'next/link';
import { ClipboardList, Trophy, BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface Props {
  availableCount: number;
  completedCount: number;
  latest?: Record<string, unknown> | null;
}

export function AssessmentProgress({ availableCount, completedCount, latest }: Props) {
  const pending = Math.max(0, availableCount - completedCount);

  if (availableCount === 0 && completedCount === 0) {
    return (
      <Card padding="md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted">
            <ClipboardList className="h-4 w-4 text-text-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">No tests yet</p>
            <p className="text-xs text-text-muted">Tests assigned to your batch will appear here</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-text-primary">Tests</h3>
        </div>
        <Link href="/student/tests" className="text-xs font-medium text-brand-600 hover:text-brand-700">
          View all
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface-muted py-2">
          <p className="text-lg font-bold text-text-primary">{completedCount}</p>
          <p className="text-2xs text-text-muted">Completed</p>
        </div>
        <div className="rounded-lg bg-amber-50 py-2">
          <p className="text-lg font-bold text-amber-700">{pending}</p>
          <p className="text-2xs text-amber-600">Pending</p>
        </div>
        <div className="rounded-lg bg-brand-50 py-2">
          <p className="text-lg font-bold text-brand-700">{availableCount}</p>
          <p className="text-2xs text-brand-600">Available</p>
        </div>
      </div>

      {latest && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-surface-border bg-surface-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-brand-600" />
            <span className="text-xs text-text-secondary">Latest</span>
            <span className="text-xs font-semibold text-text-primary truncate max-w-[120px]">
              {String((latest as any).test_title || (latest as any).title || 'Test')}
            </span>
          </div>
          <Badge variant={Number((latest as any).percentage || 0) >= 40 ? 'success' : 'error'} size="sm">
            {Number((latest as any).percentage || 0)}%
          </Badge>
        </div>
      )}
    </Card>
  );
}
