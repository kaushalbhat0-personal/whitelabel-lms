'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  BarChart3, Clock, CheckCircle, XCircle, HelpCircle, ArrowLeft,
  ChevronDown, ChevronUp, FileText, Award, Target,
} from 'lucide-react';
import { getStudentResult } from '@/lib/api/assessments';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn } from '@/lib/utils';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function safeParseAnswer(val: any): any {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ReviewQuestion {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, any> | null;
  correct_answer: string | null;
  student_answer: any;
  marks_awarded: number;
  marks: number;
  is_correct: boolean;
  is_manual_review?: boolean;
  teacher_feedback?: string | null;
  image_url?: string | null;
}

interface TopicBreakdown {
  topicName: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface ResultData {
  id: string;
  testTitle: string;
  score: number;
  totalMarks: number;
  passingMarks: number;
  percentage: number;
  passed: boolean;
  rank: number;
  accuracy: number;
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unansweredCount: number;
  timeTakenSeconds: number;
  submittedAt: string;
  questions: ReviewQuestion[];
  topicBreakdown: TopicBreakdown[];
  teacherFeedback?: string | null;
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-sm font-semibold text-text-primary">{value}</p>
      </div>
    </div>
  );
}

export default function TestResultPage() {
  const params = useParams();
  const router = useRouter();
  const attemptId = params.attemptId as string;

  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    async function fetch() {
      try {
        const raw: any = await getStudentResult(attemptId);
        if (raw.is_pending_review || raw.isPendingReview || raw.status === 'pending_review') {
          setPendingReview(true);
        }
        if (raw.pending_review_count != null) setPendingCount(raw.pending_review_count);
        const answers: any[] = Array.isArray(raw.answers) ? raw.answers : [];
        // Prefer server question_analysis if it has full data (published path), else fallback to answers
        const hasQuestionAnalysis = Array.isArray(raw.question_analysis) && raw.question_analysis.length > 0;
        const analysisForReview = hasQuestionAnalysis ? raw.question_analysis : null;
        const totalMarks = raw.totalMarks ?? raw.total_marks ?? 0;
        const score = raw.score ?? raw.marksAwarded ?? raw.obtained_marks ?? 0;
        const correctAnswers = raw.correctAnswers ?? raw.correct_answers ?? answers.filter((a) => a.is_correct === true).length;
        // API returns accuracy as a fraction (0..1); normalize to percent.
        const accuracyRaw = raw.accuracy ?? (answers.length > 0 ? correctAnswers / answers.length : 0);
        const accuracy = accuracyRaw > 1 ? accuracyRaw : Math.round(accuracyRaw * 100);
        // Build questions from question_analysis if available (has correct_answer/options), else from answers
        const questionsFromAnalysis = analysisForReview
          ? analysisForReview.map((qa: any) => ({
              id: qa.questionId ?? qa.id,
              question_text: qa.questionText ?? qa.question_text ?? null,
              question_type: qa.questionType ?? qa.question_type ?? null,
              options: qa.options ?? null,
              correct_answer: qa.correctAnswer ?? qa.correct_answer ?? null,
              student_answer: qa.userAnswer ?? qa.student_answer ?? qa.answer ?? null,
              marks_awarded: qa.marksAwarded ?? qa.marks_awarded ?? 0,
              marks: qa.marksPossible ?? qa.marks_possible ?? qa.marks ?? 0,
              is_correct: qa.isCorrect ?? qa.is_correct ?? false,
              is_manual_review: qa.isManualReview ?? qa.is_manual_review ?? false,
              teacher_feedback: qa.feedback ?? qa.teacher_feedback ?? null,
              image_url: qa.imageUrl ?? qa.image_url ?? null,
            }))
          : null;
        const r: ResultData = {
          id: raw.id,
          testTitle: raw.testTitle ?? raw.test?.title ?? raw.title ?? raw.test_title ?? 'Test',
          score,
          totalMarks,
          passingMarks: raw.passingMarks ?? raw.passing_marks ?? 0,
          percentage: raw.percentage ?? (totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0),
          passed: raw.passed ?? raw.isPassed ?? raw.status === 'passed',
          rank: raw.rank ?? 0,
          accuracy,
          totalQuestions: raw.totalQuestions ?? raw.total_questions ?? answers.length,
          correctAnswers,
          incorrectAnswers: raw.incorrectAnswers ?? raw.incorrect_answers ?? answers.filter((a) => a.is_correct === false).length,
          unansweredCount: raw.unansweredCount ?? raw.unanswered_count ?? raw.unansweredCount ?? answers.filter((a) => a.is_correct == null && a.is_manual_review !== true && (a.answer == null || a.answer === '' || (Array.isArray(a.answer) && a.answer.length === 0))).length,
          timeTakenSeconds: raw.timeTakenSeconds ?? raw.time_taken_seconds ?? raw.duration_seconds ?? 0,
          submittedAt: raw.submittedAt ?? raw.submitted_at ?? raw.published_at ?? raw.created_at ?? new Date().toISOString(),
          questions: Array.isArray(raw.questions ?? raw.questionReview ?? []) && (raw.questions ?? raw.questionReview ?? []).length > 0
            ? (raw.questions ?? raw.questionReview ?? []).map((q: any) => ({
                id: q.id,
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options,
                correct_answer: q.correct_answer,
                student_answer: q.student_answer ?? q.answer,
                marks_awarded: q.marks_awarded ?? q.marksAwarded ?? 0,
                marks: q.marks ?? q.totalMarks ?? q.marks_possible ?? 0,
                is_correct: q.is_correct ?? q.isCorrect ?? false,
                is_manual_review: q.is_manual_review ?? false,
                teacher_feedback: q.teacher_feedback ?? q.teacherFeedback ?? null,
                image_url: q.image_url,
              }))
            : questionsFromAnalysis ?? answers.map((a: any) => ({
                id: a.id ?? a.question_id,
                question_text: a.question_text ?? a.questionText ?? null,
                question_type: a.question_type ?? a.questionType ?? null,
                options: a.options ?? null,
                correct_answer: a.correct_answer ?? a.correctAnswer ?? null,
                student_answer: a.answer ?? a.student_answer ?? null,
                marks_awarded: a.marks_awarded ?? 0,
                marks: a.marks_possible ?? 0,
                is_correct: a.is_correct === true,
                is_manual_review: a.is_manual_review === true,
                teacher_feedback: a.feedback ?? a.teacher_feedback ?? null,
                image_url: a.image_url ?? null,
              })),
          topicBreakdown: Array.isArray(raw.topicBreakdown ?? raw.topic_breakdown ?? [])
            ? (raw.topicBreakdown ?? raw.topic_breakdown ?? []).map((t: any) => ({
                topicName: t.topicName ?? t.topic_name ?? t.name ?? 'Unknown',
                total: t.total ?? 0,
                correct: t.correct ?? 0,
                accuracy: t.accuracy ?? (t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0),
              }))
            : [],
          teacherFeedback: raw.teacherFeedback ?? raw.teacher_feedback ?? null,
        };
        setResult(r);
        if (raw.is_pending_review || raw.pending_review_count > 0) setPendingReview(true);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Result not found');
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, [attemptId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-page">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-navy border-t-transparent" />
      </div>
    );
  }

  if (!result) {
    const isInProgress = errorMsg?.toLowerCase().includes('in progress');
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-page px-4 text-center">
        <BarChart3 className="h-10 w-10 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">{isInProgress ? 'Attempt still in progress' : 'Result not found'}</p>
        <p className="text-xs text-text-muted">{errorMsg ?? 'This result may still be processing. Please refresh.'}</p>
        <button
          onClick={() => router.push('/student/tests')}
          className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navyDark"
        >
          Back to Tests
        </button>
      </div>
    );
  }

  const displayTopics = showAllTopics ? result.topicBreakdown : result.topicBreakdown.slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Test Result"
        showBack
        action={
          <button
            onClick={() => router.push('/student/tests')}
            className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navyDark"
          >
            Back to Tests
          </button>
        }
      />
      <div className="space-y-4 px-4 md:px-0">
        {/* Pending Review Banner */}
        {pendingReview && (
          <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-center">
            <p className="text-xs font-semibold text-amber-800">Result available — manual review pending ({pendingCount} pending)</p>
            <p className="mt-1 text-[11px] text-amber-700">Some answers require teacher review. Scores shown are interim and will update after review. Final result after publishing.</p>
          </div>
        )}

        {/* Score Header */}
        <div className="rounded-card border border-surface-border bg-surface-card p-6 text-center">
          <div className="mb-2 text-4xl font-bold text-text-primary">
            {result.percentage}%
          </div>
          <div className="mb-3 text-sm text-text-secondary">
            {result.score} / {result.totalMarks} marks
          </div>
          <div className="flex items-center justify-center gap-3">
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold',
              result.passed
                ? 'bg-status-success/10 text-status-success'
                : 'bg-status-live/10 text-status-live',
            )}>
              {result.passed ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {result.passed ? 'Passed' : 'Failed'}
            </span>
            {result.rank > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-navy/10 px-3 py-1 text-xs font-semibold text-brand-navy">
                <Award className="h-3.5 w-3.5" />
                Rank #{result.rank}
              </span>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <StatCard icon={Target} label="Accuracy" value={`${result.accuracy}%`} color="bg-brand-navy/10 text-brand-navy" />
          <StatCard icon={HelpCircle} label="Total Questions" value={String(result.totalQuestions)} color="bg-surface-muted text-text-secondary" />
          <StatCard icon={CheckCircle} label="Correct" value={String(result.correctAnswers)} color="bg-status-success/10 text-status-success" />
          <StatCard icon={XCircle} label="Incorrect" value={String(result.incorrectAnswers)} color="bg-status-live/10 text-status-live" />
          <StatCard icon={HelpCircle} label="Unanswered" value={String(result.unansweredCount)} color="bg-surface-muted text-text-muted" />
          {pendingReview && <StatCard icon={Clock} label="Pending Review" value={String(pendingCount)} color="bg-amber-100 text-amber-700" />}
          <StatCard icon={Clock} label="Time Taken" value={formatTime(result.timeTakenSeconds)} color="bg-surface-muted text-text-secondary" />
        </div>

        {/* Topic Analysis */}
        {result.topicBreakdown.length > 0 && (
          <div className="rounded-card border border-surface-border bg-surface-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Topic Analysis</h3>
            <div className="space-y-2">
              {displayTopics.map((topic) => (
                <div key={topic.topicName}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-text-secondary">{topic.topicName}</span>
                    <span className="font-medium text-text-primary">
                      {topic.correct}/{topic.total} ({topic.accuracy}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        topic.accuracy >= 80 ? 'bg-status-success' : topic.accuracy >= 40 ? 'bg-status-scheduled' : 'bg-status-live',
                      )}
                      style={{ width: `${topic.accuracy}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {result.topicBreakdown.length > 5 && (
              <button
                onClick={() => setShowAllTopics(!showAllTopics)}
                className="mt-3 flex w-full items-center justify-center gap-1 text-xs font-medium text-brand-navy"
              >
                {showAllTopics ? 'Show Less' : `Show All (${result.topicBreakdown.length})`}
                {showAllTopics ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        )}

        {/* Question Review */}
        {result.questions.length > 0 && (
          <div className="rounded-card border border-surface-border bg-surface-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Question Review</h3>
                    <div className="space-y-2">
              {result.questions.map((q, idx) => {
                const isExpanded = expandedQuestion === q.id;
                const options = q.options?.options ?? q.options?.choices ?? q.options ?? {};
                const optArr = Array.isArray(options) ? options : Object.entries(options).map(([k, v]) => ({ key: k, value: v as string }));

                const renderAnswer = (ans: any) => {
                  if (ans == null) return '—';
                  if (ans && typeof ans === 'object' && ans.url) {
                    const isPdf = ans.fileName?.toLowerCase().endsWith('.pdf') || ans.mimeType === 'application/pdf';
                    return isPdf ? `PDF: ${ans.fileName}` : `Image: ${ans.fileName}`;
                  }
                  if (Array.isArray(ans)) return ans.join(', ');
                  return String(ans);
                };

                return (
                  <div key={q.id} className="rounded-lg border border-surface-border">
                    <button
                      onClick={() => setExpandedQuestion(isExpanded ? null : q.id)}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-medium text-text-secondary">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text-primary line-clamp-2">{q.question_text ?? 'Question'}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                          {q.is_manual_review ? (
                            <span className="flex items-center gap-1 text-amber-600">
                              <Clock className="h-3 w-3" /> Pending Review
                            </span>
                          ) : q.teacher_feedback != null && ['short_answer','long_answer','image_upload','image_based'].includes(q.question_type) ? (
                            // Manual reviewed: derive badge from marks to avoid Incorrect·full marks confusion
                            q.marks_awarded === q.marks ? (
                              <span className="flex items-center gap-1 text-status-success">
                                <CheckCircle className="h-3 w-3" /> Reviewed
                              </span>
                            ) : q.marks_awarded === 0 ? (
                              <span className="flex items-center gap-1 text-status-live">
                                <XCircle className="h-3 w-3" /> Reviewed
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-amber-600">
                                <Clock className="h-3 w-3" /> Reviewed
                              </span>
                            )
                          ) : q.is_correct ? (
                            <span className="flex items-center gap-1 text-status-success">
                              <CheckCircle className="h-3 w-3" /> Correct
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-status-live">
                              <XCircle className="h-3 w-3" /> Incorrect
                            </span>
                          )}
                          <span>·</span>
                          <span>{q.is_manual_review && q.marks_awarded == null ? 'Pending' : `${q.marks_awarded ?? 0}/${q.marks} marks`}</span>
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-surface-border p-3 space-y-3">
                        {q.image_url && (
                          <div className="overflow-hidden rounded-lg border border-surface-border">
                            <img src={q.image_url} alt="Question" className="max-h-60 w-full object-contain" />
                          </div>
                        )}
                        {q.student_answer && typeof q.student_answer === 'object' && q.student_answer.url && (
                          <div className="rounded-lg border border-surface-border p-2">
                            <p className="mb-1 text-xs font-medium text-text-muted">Your uploaded file:</p>
                            {(q.student_answer.fileName?.toLowerCase().endsWith('.pdf') || q.student_answer.mimeType === 'application/pdf') ? (
                              <a href={q.student_answer.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-navy underline">Download / Preview PDF: {q.student_answer.fileName}</a>
                            ) : (
                              <img src={q.student_answer.url} alt="Your answer" className="max-h-60 w-full object-contain rounded" />
                            )}
                          </div>
                        )}

                        {q.question_type !== 'short_answer' && q.question_type !== 'long_answer' && q.question_type !== 'numerical' && optArr.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-text-muted">Options:</p>
                            {optArr.map((opt: any, oi: number) => {
                              const optKey = opt.key ?? opt.id ?? String(oi);
                              const optVal = opt.value ?? opt.label ?? opt;
                              const isStudentAns = String(q.student_answer) === String(optKey) || (Array.isArray(q.student_answer) && q.student_answer.includes(optKey));
                              const parsedCorrect = safeParseAnswer(q.correct_answer);
                              const isCorrectAns = String(q.correct_answer) === String(optKey) || (Array.isArray(parsedCorrect) && parsedCorrect.includes(optKey));

                              let bgColor = 'bg-surface-muted';
                              if (isCorrectAns) bgColor = 'bg-status-success/10 border-status-success';
                              if (isStudentAns && !isCorrectAns) bgColor = 'bg-status-live/10 border-status-live';

                              return (
                                <div
                                  key={optKey}
                                  className={cn('flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs', bgColor)}
                                >
                                  {isCorrectAns && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-status-success" />}
                                  {isStudentAns && !isCorrectAns && <XCircle className="h-3.5 w-3.5 shrink-0 text-status-live" />}
                                  <span className="text-text-primary">{optVal}</span>
                                  {isCorrectAns && <span className="ml-auto text-[10px] font-medium text-status-success">Correct</span>}
                                  {isStudentAns && !isCorrectAns && <span className="ml-auto text-[10px] font-medium text-status-live">Your answer</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-text-muted">Your answer</p>
                            <p className={cn('font-medium', q.is_manual_review ? 'text-amber-600' : q.is_correct ? 'text-status-success' : 'text-status-live')}>
                              {q.is_manual_review && (q.student_answer == null || q.student_answer === '') ? '—' : renderAnswer(q.student_answer)}
                              {q.is_manual_review && <span className="ml-1 text-[10px] text-amber-600">(Awaiting review)</span>}
                            </p>
                          </div>
                          {q.correct_answer != null && !q.is_correct && !q.is_manual_review && (
                            <div>
                              <p className="text-text-muted">Correct answer</p>
                              <p className="font-medium text-status-success break-words">
                                {(() => {
                                  const keyRaw = String(q.correct_answer);
                                  // direct match against optArr
                                  const found = optArr.find((o: any) => String(o.key) === keyRaw || String(o.key).toLowerCase() === keyRaw.toLowerCase());
                                  if (found) return `${found.key} — ${found.value}`;
                                  // comma-separated multiple keys (e.g. "A,B")
                                  if (keyRaw.includes(',')) {
                                    const parts = keyRaw.split(',').map((k: string) => k.trim()).filter(Boolean);
                                    let anyResolved = false;
                                    const resolved = parts.map((k) => {
                                      const f = optArr.find((o: any) => String(o.key) === k || String(o.key).toLowerCase() === k.toLowerCase());
                                      if (f) { anyResolved = true; return `${f.key} — ${f.value}`; }
                                      return k;
                                    }).join(', ');
                                    if (anyResolved) return resolved;
                                  }
                                  return renderAnswer(q.correct_answer);
                                })()}
                              </p>
                            </div>
                          )}
                          {q.is_manual_review && (
                            <div>
                              <p className="text-text-muted">Status</p>
                              <p className="font-medium text-amber-600">Pending manual review</p>
                            </div>
                          )}
                        </div>

                        {q.teacher_feedback && (
                          <div className="rounded-lg bg-brand-navy/5 p-3">
                            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-brand-navy">Teacher Feedback</p>
                            <p className="text-xs text-text-secondary">{q.teacher_feedback}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Teacher Feedback */}
        {result.teacherFeedback && (
          <div className="rounded-card border border-surface-border bg-surface-card p-4">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Teacher Feedback</h3>
            <div className="rounded-lg bg-brand-navy/5 p-3">
              <p className="text-sm text-text-secondary">{result.teacherFeedback}</p>
            </div>
          </div>
        )}

        <div className="pb-6 text-center">
          <button
            onClick={() => router.push('/student/tests')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navyDark"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Tests
          </button>
        </div>
      </div>
    </div>
  );
}
