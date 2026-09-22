'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CourseDetailRecordings } from './course-detail-recordings';
import type { StudentBatchRecordings } from '@/lib/api/videos';

interface Props {
  batches: StudentBatchRecordings[];
}

export function CollapsibleBatchList({ batches }: Props) {
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(() => {
    if (batches.length === 1) {
      return new Set([batches[0].batchId]);
    }
    return new Set();
  });

  const toggle = (batchId: string) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  if (batches.length === 0) {
    return (
      <div className="rounded-card border border-surface-border bg-surface-card p-8 text-center">
        <p className="text-sm text-text-secondary">No recordings available yet for your batches.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {batches.map((batch) => {
        const isExpanded = expandedBatchIds.has(batch.batchId);
        const totalInBatch = batch.sections.reduce((acc, s) => acc + s.recordings.length, 0);
        const contentId = `batch-content-${batch.batchId}`;
        return (
          <section
            key={batch.batchId}
            className="rounded-card border border-surface-border bg-surface-card"
          >
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={contentId}
              onClick={() => toggle(batch.batchId)}
              className="flex w-full items-center gap-3 p-4 text-left min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2 rounded-card"
            >
              {isExpanded ? (
                <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
              ) : (
                <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-text-primary truncate">{batch.batchName}</h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {totalInBatch} recording{totalInBatch !== 1 ? 's' : ''} · {batch.sections.length} section{batch.sections.length !== 1 ? 's' : ''}
                </p>
              </div>
            </button>
            {isExpanded && (
              <div id={contentId} className="px-4 pb-4 space-y-4">
                {batch.sections.map((section) => (
                  <div key={section.sectionName ?? '__uncategorized__'}>
                    {section.sectionName && (
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        {section.sectionName}
                      </h3>
                    )}
                    <CourseDetailRecordings videos={section.recordings as any} hideHeader />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
