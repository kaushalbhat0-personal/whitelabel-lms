'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  UserCheck,
  Send,
  Sparkles,
  Megaphone,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  getReviewQueue,
  assignForReview,
  submitReview,
  autoGradeAttempt,
  publishResults,
} from '@/lib/api/assessments';
import { cn, formatDate } from '@/lib/utils';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_review: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-green-100 text-green-700',
};

const statusIcons: Record<string, any> = {
  pending: Clock,
  in_review: AlertCircle,
  reviewed: CheckCircle2,
};

export default function AdminReviewQueuePage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [testFilter, setTestFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewMarks, setReviewMarks] = useState<Record<string, string>>({});
  const [reviewFeedback, setReviewFeedback] = useState<Record<string, string>>({});
  const [debouncedTestFilter, setDebouncedTestFilter] = useState('');
  const filterTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => {
      setDebouncedTestFilter(testFilter);
    }, 400);
    return () => { if (filterTimerRef.current) clearTimeout(filterTimerRef.current); };
  }, [testFilter]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getReviewQueue({
        status: statusFilter || undefined,
        testId: debouncedTestFilter || undefined,
      });
      setItems(result.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedTestFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleAssign = async (reviewId: string) => {
    setActionLoading(reviewId);
    try {
      await assignForReview(reviewId);
      toast.success('Assigned for review');
      fetchItems();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign for review');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmitReview = async (reviewId: string) => {
    const marks = Number(reviewMarks[reviewId]);
    if (isNaN(marks)) return;
    setActionLoading(reviewId);
    try {
      await submitReview(reviewId, {
        marksAwarded: marks,
        feedback: reviewFeedback[reviewId] || undefined,
      });
      toast.success('Review submitted');
      fetchItems();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit review');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAutoGrade = async (attemptId: string) => {
    setActionLoading(attemptId);
    try {
      await autoGradeAttempt(attemptId);
      toast.success('Auto-grading complete');
      fetchItems();
    } catch (err: any) {
      toast.error(err?.message || 'Auto-grading failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePublish = async (attemptId: string) => {
    setActionLoading(attemptId);
    try {
      await publishResults(attemptId);
      toast.success('Results published');
      fetchItems();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to publish results');
    } finally {
      setActionLoading(null);
    }
  };

  const maxMarks = (item: any) => item.test?.total_marks || 100;

  const studentName = (item: any) =>
    item.test_attempts?.profiles?.name ||
    item.test_attempts?.user_id ||
    'Unknown Student';

  const testTitle = (item: any) => item.test_id || 'Test';

  const questionText = (item: any) =>
    item.test_answers?.question_bank?.question_text || 'Question not available';

  const answerText = (item: any) =>
    item.test_answers?.answer ?? item.answer ?? 'No answer provided';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Review Queue</h1>
        <p className="mt-1 text-sm text-text-muted">Review student test submissions manually</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-surface-border bg-surface-card py-2.5 px-4 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_review">In Review</option>
          <option value="reviewed">Reviewed</option>
        </select>
        <input
          value={testFilter}
          onChange={(e) => setTestFilter(e.target.value)}
          placeholder="Filter by test ID..."
          className="rounded-xl border border-surface-border bg-surface-card py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-surface-border border-t-brand-navy" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardCheck className="mb-3 h-12 w-12 text-text-muted" />
          <h3 className="text-lg font-semibold text-text-primary">No reviews pending</h3>
          <p className="mt-1 text-sm text-text-muted">
            All submissions have been reviewed or there are no submissions yet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item: any) => {
            const isExpanded = expandedId === item.id;
            const StatusIcon = statusIcons[item.status] || Clock;
            const marksValue = reviewMarks[item.id] ?? '';
            const feedbackValue = reviewFeedback[item.id] ?? '';
            const maxM = maxMarks(item);

            return (
              <div
                key={item.id}
                className="rounded-xl border border-surface-border bg-surface-card overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-surface-muted/50 transition-colors"
                >
                  <StatusIcon className={cn(
                    'h-5 w-5 flex-shrink-0',
                    item.status === 'pending' && 'text-yellow-500',
                    item.status === 'in_review' && 'text-blue-500',
                    item.status === 'reviewed' && 'text-green-500',
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {studentName(item)}
                    </p>
                    <p className="text-xs text-text-muted truncate mt-0.5">
                      {testTitle(item)} — {questionText(item)}
                    </p>
                  </div>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                    statusColors[item.status] || 'bg-gray-100 text-gray-700',
                  )}>
                    {item.status?.replace('_', ' ')}
                  </span>
                  {item.assigned_to && (
                    <span className="text-xs text-text-muted flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5" />
                      {item.assigned_to}
                    </span>
                  )}
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-surface-border px-6 py-4 space-y-4">
                    <div>
                      <p className="text-sm font-medium text-text-primary mb-1">Question:</p>
                      <p className="text-sm text-text-secondary bg-surface-muted rounded-xl p-3">
                        {questionText(item)}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-text-primary mb-1">Student&apos;s Answer:</p>
                      <p className="text-sm text-text-secondary bg-surface-muted rounded-xl p-3">
                        {answerText(item)}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-text-secondary">Marks (0-{maxM})</label>
                        <input
                          type="number"
                          min="0"
                          max={maxM}
                          step="0.5"
                          value={marksValue}
                          onChange={(e) => setReviewMarks({ ...reviewMarks, [item.id]: e.target.value })}
                          className="w-24 rounded-xl border border-surface-border bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
                          disabled={item.status === 'reviewed'}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-text-secondary">Feedback</label>
                        <input
                          value={feedbackValue}
                          onChange={(e) => setReviewFeedback({ ...reviewFeedback, [item.id]: e.target.value })}
                          className="w-full rounded-xl border border-surface-border bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
                          placeholder="Optional feedback..."
                          disabled={item.status === 'reviewed'}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {item.status === 'pending' && !item.assigned_to && (
                        <button
                          onClick={() => handleAssign(item.id)}
                          disabled={actionLoading === item.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-medium text-white hover:bg-brand-navy-dark disabled:opacity-60"
                        >
                          {actionLoading === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UserCheck className="h-3.5 w-3.5" />
                          )}
                          Assign to me
                        </button>
                      )}

                      {(item.status === 'in_review' || (item.status === 'pending' && item.assigned_to)) && (
                        <button
                          onClick={() => handleSubmitReview(item.id)}
                          disabled={actionLoading === item.id || !marksValue}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                        >
                          {actionLoading === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          Submit Review
                        </button>
                      )}

                      {item.attempt_id && (
                        <button
                          onClick={() => handleAutoGrade(item.attempt_id)}
                          disabled={actionLoading === item.attempt_id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-60"
                        >
                          {actionLoading === item.attempt_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          Auto-grade
                        </button>
                      )}

                      {item.attempt_id && (
                        <button
                          onClick={() => handlePublish(item.attempt_id)}
                          disabled={actionLoading === item.attempt_id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-medium text-white hover:bg-brand-navy-dark disabled:opacity-60"
                        >
                          {actionLoading === item.attempt_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Megaphone className="h-3.5 w-3.5" />
                          )}
                          Publish Results
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
