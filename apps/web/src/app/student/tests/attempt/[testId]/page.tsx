'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Clock, AlertTriangle, CheckCircle, XCircle, HelpCircle,
  ArrowLeft, ArrowRight, Send, ChevronDown, ChevronUp,
  FileText,
} from 'lucide-react';
import { startAttempt, getAttempt, saveAllAnswers, submitAttempt, getAttemptTimer, uploadQuestionImage } from '@/lib/api/assessments';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ScreenRecordingDetector } from '@/components/shared/ScreenRecordingDetector';
import { cn } from '@/lib/utils';

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, any> | null;
  correct_answer?: string | null;
  marks?: number;
  negative_marks?: number;
  image_url?: string | null;
  section_title?: string;
}

interface AnswerEntry {
  questionId: string;
  questionType: string;
  answer: any;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function normalizeOptions(raw: any): { key: string; value: string }[] {
  if (!raw) return [];
  const arr = raw?.options ?? raw?.choices ?? raw;
  if (Array.isArray(arr)) {
    return arr.map((opt: any, idx: number) => {
      if (typeof opt === 'string') return { key: opt, value: opt };
      return { key: String(opt?.key ?? opt?.id ?? idx), value: String(opt?.value ?? opt?.label ?? opt) };
    });
  }
  if (typeof arr === 'object') {
    return Object.entries(arr).map(([k, v]) => ({
      key: String(k),
      value: typeof v === 'string' ? v : String((v as any)?.value ?? v),
    }));
  }
  return [];
}

function QuestionRenderer({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: any;
  onChange: (val: any) => void;
}) {
  const options = question.options;
  const optArr = options?.options ?? options?.choices ?? options ?? [];

  switch (question.question_type) {
    case 'single_choice':
    case 'true_false': {
      const choices = question.question_type === 'true_false'
        ? [{ key: 'True', value: 'True' }, { key: 'False', value: 'False' }].map(o=> ({key: o.key, value: o.value}))
        : normalizeOptions(optArr);
      return (
        <div className="space-y-2">
          {choices.map((opt: any, idx: number) => {
            const optVal = opt.value;
            const optKey = opt.key;
            return (
              <label
                key={optKey}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                  value === optKey
                    ? 'border-brand-navy bg-brand-navy/5'
                    : 'border-surface-border hover:bg-surface-muted',
                )}
              >
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  value={optKey}
                  checked={value === optKey}
                  onChange={() => onChange(optKey)}
                  className="h-4 w-4 text-brand-navy accent-brand-navy"
                />
                <span className="text-sm text-text-primary">{optVal}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case 'multiple_choice': {
      const selected: string[] = Array.isArray(value) ? value : [];
      const choices = normalizeOptions(optArr);
      return (
        <div className="space-y-2">
          {choices.map((opt: any, idx: number) => {
            const optVal = opt.value;
            const optKey = opt.key;
            const isChecked = selected.includes(optKey);
            return (
              <label
                key={optKey}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                  isChecked ? 'border-brand-navy bg-brand-navy/5' : 'border-surface-border hover:bg-surface-muted',
                )}
              >
                <input
                  type="checkbox"
                  value={optKey}
                  checked={isChecked}
                  onChange={() => {
                    if (isChecked) {
                      onChange(selected.filter((v) => v !== optKey));
                    } else {
                      onChange([...selected, optKey]);
                    }
                  }}
                  className="h-4 w-4 rounded text-brand-navy accent-brand-navy"
                />
                <span className="text-sm text-text-primary">{optVal}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case 'numerical':
      return (
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="Enter your answer"
          className="w-full rounded-lg border border-surface-border bg-white p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
        />
      );

    case 'short_answer':
      return (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer here..."
          rows={3}
          className="w-full resize-none rounded-lg border border-surface-border bg-white p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
        />
      );

    case 'long_answer':
      return (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your detailed answer here..."
          rows={8}
          className="w-full resize-none rounded-lg border border-surface-border bg-white p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
        />
      );

    case 'image_upload': {
      const isUploading = typeof value === 'object' && value !== null && '_uploading' in value;
      const hasValue = value && typeof value === 'object' && value.url;
      const isPdf = hasValue && (value.fileName?.toLowerCase().endsWith('.pdf') || value.mimeType === 'application/pdf');
      return (
        <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-surface-border p-8 text-center">
          <input
            type="file"
            accept="image/*,.pdf"
            disabled={isUploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const allowed = ['image/png','image/jpeg','image/jpg','image/webp','image/gif','application/pdf'];
              if (!allowed.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
                toast.error('Unsupported file type. Use PNG/JPG/WEBP/GIF/PDF');
                return;
              }
              if (file.size > 10 * 1024 * 1024) {
                toast.error('File must be smaller than 10MB');
                return;
              }
              onChange({ _uploading: true, fileName: file.name });
              try {
                const result = await uploadQuestionImage(file);
                onChange({ url: result.url, fileName: result.fileName, mimeType: file.type, storagePath: (result as any).storagePath });
                toast.success('File uploaded');
              } catch (err: any) {
                toast.error(err?.message || 'Failed to upload file');
                onChange(undefined);
              }
            }}
            className="text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-navyDark disabled:opacity-50"
          />
          {isUploading && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-brand-navy border-t-transparent" />
              Uploading...
            </div>
          )}
          {hasValue && (
            <div className="w-full space-y-2">
              <p className="text-xs text-text-muted">Uploaded: {value.fileName}</p>
              {isPdf ? (
                <div className="rounded-lg border border-surface-border bg-surface-muted p-3 text-xs text-text-secondary">
                  PDF uploaded — <a href={value.url} target="_blank" rel="noopener noreferrer" className="text-brand-navy underline">Preview / Download</a>
                </div>
              ) : (
                <img src={value.url} alt="Uploaded answer" className="max-h-40 rounded-lg border border-surface-border object-contain" />
              )}
              <button type="button" onClick={() => onChange(undefined)} className="text-xs text-red-600 hover:underline">Remove / Replace</button>
            </div>
          )}
          <p className="text-[10px] text-text-muted">PNG, JPG, WEBP, GIF or PDF — max 10MB</p>
        </div>
      );
    }

    case 'image_based':
      return (
        <div className="space-y-4">
          {question.image_url && (
            <div className="overflow-hidden rounded-lg border border-surface-border">
              <img
                src={question.image_url}
                alt="Question image"
                className="max-h-80 w-full object-contain"
              />
            </div>
          )}
          <div className="space-y-2">
            {normalizeOptions(optArr).map((opt: any, idx: number) => {
              const optVal = opt.value;
              const optKey = opt.key;
              return (
                <label
                  key={optKey}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                    value === optKey ? 'border-brand-navy bg-brand-navy/5' : 'border-surface-border hover:bg-surface-muted',
                  )}
                >
                  <input
                    type="radio"
                    name={`q-${question.id}`}
                    value={optKey}
                    checked={value === optKey}
                    onChange={() => onChange(optKey)}
                    className="h-4 w-4 text-brand-navy accent-brand-navy"
                  />
                  <span className="text-sm text-text-primary">{optVal}</span>
                </label>
              );
            })}
          </div>
        </div>
      );

    default:
      return (
        <p className="text-sm text-text-muted">Unsupported question type: {question.question_type}</p>
      );
  }
}

export default function TestAttemptPage() {
  const params = useParams();
  const router = useRouter();
  const testId = params.testId as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [testTitle, setTestTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [showWarning, setShowWarning] = useState(false);

  const answersRef = useRef(answers);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const timerSyncRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef(Date.now());

  answersRef.current = answers;

  // Load attempt
  useEffect(() => {
    async function init() {
      try {
        const res = await startAttempt(testId);
        // API returns the attempt flat with `questions` (question content) and `test`.
        const att = res.attempt ?? res;
        const qs = res.questions ?? att.questions ?? [];

        setAttemptId(att.id);
        setTestTitle(att.test?.title ?? att.testTitle ?? res.test?.title ?? 'Test');
        setQuestions(qs);
        setDurationMinutes(att.test?.duration_minutes ?? att.durationMinutes ?? res.test?.duration_minutes ?? null);

        if (att.timeRemainingSeconds != null) {
          setTimeRemaining(att.timeRemainingSeconds);
        } else if (att.test?.duration_minutes ?? res.test?.duration_minutes) {
          setTimeRemaining((att.test?.duration_minutes ?? res.test?.duration_minutes) * 60);
        }

        if (att.currentQuestionIndex != null) {
          setCurrentIndex(att.currentQuestionIndex);
        }

        // Load existing answers
        const savedAnswers: Record<string, any> = {};
        const ansArr = att.answers ?? att.test_answers ?? res.test_answers ?? [];
        if (Array.isArray(ansArr)) {
          for (const a of ansArr) {
            savedAnswers[a.questionId ?? a.question_id] = a.answer ?? a.answer ?? '';
          }
        }
        setAnswers(savedAnswers);
        startTimeRef.current = Date.now();
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [testId]);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining == null || timeRemaining <= 0) return;
    countdownRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev == null || prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current!);
  }, [timeRemaining != null]);

  // Timer sync every 30s
  useEffect(() => {
    if (!attemptId) return;
    timerSyncRef.current = setInterval(async () => {
      try {
        const res = await getAttemptTimer(attemptId);
        if (res.remainingSeconds != null) {
          setTimeRemaining(res.remainingSeconds);
        }
      } catch {
        // silent
      }
    }, 30000);
    return () => clearInterval(timerSyncRef.current!);
  }, [attemptId]);

  // beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Auto-save with retry — preserves answers in local state even on failure
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!attemptId) return;
      const ans = answersRef.current;
      const answersList: AnswerEntry[] = [];
      for (const q of questions) {
        const val = ans[q.id];
        if (val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
          answersList.push({ questionId: q.id, questionType: q.question_type, answer: val });
        }
      }
      if (answersList.length === 0) return;
      let lastError: any;
      for (let retry = 0; retry < 3; retry++) {
        try {
          await saveAllAnswers(attemptId, {
            answers: answersList,
            currentQuestionIndex: currentIndex,
            timeRemainingSeconds: timeRemaining ?? undefined,
          });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (retry < 2) await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
        }
      }
      if (lastError) {
        toast.error('Auto-save failed. Your answers are saved locally.');
      }
    }, 2000);
  }, [attemptId, questions, currentIndex, timeRemaining]);

  const setAnswer = useCallback((questionId: string, value: any) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      return next;
    });
    debouncedSave();
  }, [debouncedSave]);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = questions.filter((q) => {
    const val = answers[q.id];
    return val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
  }).length;

  const goToQuestion = (idx: number) => {
    setCurrentIndex(idx);
  };

  const handleSubmit = async () => {
    if (!attemptId) return;

    // Check unanswered
    const unanswered = questions.filter((q) => {
      const val = answers[q.id];
      return val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
    });
    if (unanswered.length > 0) {
      setWarningMessage(`${unanswered.length} question${unanswered.length !== 1 ? 's' : ''} unanswered. Are you sure you want to submit?`);
      setShowWarning(true);
      return;
    }
    setShowSubmitDialog(true);
  };

  const confirmSubmit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    try {
      const answersList: AnswerEntry[] = [];
      for (const q of questions) {
        const val = answers[q.id];
        if (val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
          answersList.push({ questionId: q.id, questionType: q.question_type, answer: val });
        }
      }
      await submitAttempt(attemptId, {
        answers: answersList,
        timeRemainingSeconds: timeRemaining ?? 0,
      } as any);

      // Redirect to results page
      router.replace(`/student/tests/result/${attemptId}`);
    } catch {
      setSubmitting(false);
      setShowSubmitDialog(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-page">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-navy border-t-transparent" />
      </div>
    );
  }

  if (!attemptId || questions.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-page px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">Unable to load test</p>
        <button
          onClick={() => router.push('/student/tests')}
          className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navyDark"
        >
          Back to Tests
        </button>
      </div>
    );
  }

  return (
    <ScreenRecordingDetector contextType="test" contextId={testId} modal>
      <div className="flex min-h-screen flex-col bg-surface-page">
        {/* Fixed Header */}
        <header className="fixed left-0 right-0 top-0 z-30 border-b border-surface-border bg-white shadow-sm">
          <div className="flex h-14 items-center justify-between px-3 md:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 shrink-0 text-brand-navy" />
              <h1 className="truncate text-sm font-semibold text-text-primary md:text-base">
                {testTitle}
              </h1>
            </div>

            <div className="flex items-center gap-3 md:gap-6">
              <div className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                timeRemaining != null && timeRemaining <= 300
                  ? 'bg-red-50 text-red-600'
                  : 'bg-surface-muted text-text-secondary',
              )}>
                <Clock className="h-4 w-4" />
                {timeRemaining != null ? formatTime(timeRemaining) : '--:--'}
              </div>

              <span className="hidden text-xs text-text-muted md:inline">
                {currentIndex + 1} of {totalQuestions}
              </span>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-navyDark disabled:opacity-50"
              >
                {submitting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-surface-muted">
            <div
              className="h-full bg-brand-navy transition-all duration-300"
              style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
            />
          </div>
        </header>

        {/* Main content */}
        <div className="flex flex-1 pt-14">
          {/* Question area */}
          <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">
            <div className="mx-auto max-w-3xl">
              {/* Question number */}
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-white">
                  {currentIndex + 1}
                </span>
                <span className="text-xs font-medium text-text-secondary">
                  {currentQuestion.section_title && `${currentQuestion.section_title} · `}
                  {currentQuestion.marks != null && `${currentQuestion.marks} mark${currentQuestion.marks !== 1 ? 's' : ''}`}
                  {currentQuestion.negative_marks != null && currentQuestion.negative_marks > 0 && (
                    <span className="ml-1 text-status-live">(-{currentQuestion.negative_marks})</span>
                  )}
                </span>
              </div>

              {/* Question text */}
              <div className="mb-6 rounded-card border border-surface-border bg-surface-card p-4">
                <p className="text-sm leading-relaxed text-text-primary md:text-base">
                  {currentQuestion.question_text}
                </p>
              </div>

              {/* Answer */}
              <div className="mb-6">
                <QuestionRenderer
                  question={currentQuestion}
                  value={answers[currentQuestion.id]}
                  onChange={(val) => setAnswer(currentQuestion.id, val)}
                />
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => goToQuestion(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-30"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </button>
                <span className="text-xs text-text-muted md:hidden">
                  {currentIndex + 1} / {totalQuestions}
                </span>
                <button
                  onClick={() => goToQuestion(Math.min(totalQuestions - 1, currentIndex + 1))}
                  disabled={currentIndex === totalQuestions - 1}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-30"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </main>

          {/* Question palette - desktop sidebar */}
          <aside className="hidden w-56 shrink-0 border-l border-surface-border bg-surface-card p-4 lg:block">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Questions
            </h3>
            <div className="grid grid-cols-5 gap-1.5">
              {questions.map((q, idx) => {
                const hasAnswer = answers[q.id] !== undefined && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && answers[q.id].length === 0);
                return (
                  <button
                    key={q.id}
                    onClick={() => goToQuestion(idx)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-colors',
                      idx === currentIndex
                        ? 'bg-brand-navy text-white'
                        : hasAnswer
                          ? 'bg-status-success/20 text-status-success'
                          : 'bg-surface-muted text-text-muted hover:bg-surface-border',
                    )}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2 border-t border-surface-border pt-4">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="h-3 w-3 rounded bg-status-success/20" />
                Answered
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="h-3 w-3 rounded bg-surface-muted" />
                Unanswered
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="h-3 w-3 rounded bg-brand-navy" />
                Current
              </div>
            </div>

            <div className="mt-4 border-t border-surface-border pt-4">
              <p className="text-xs text-text-muted">
                {answeredCount} of {totalQuestions} answered
              </p>
            </div>
          </aside>
        </div>

        {/* Mobile question palette (bottom sheet button) */}
        <MobileQuestionPalette
          questions={questions}
          answers={answers}
          currentIndex={currentIndex}
          onSelect={goToQuestion}
        />

        {/* Warning dialog */}
        <ConfirmDialog
          isOpen={showWarning}
          title="Unanswered Questions"
          message={warningMessage}
          confirmLabel="Yes, Submit"
          onConfirm={() => {
            setShowWarning(false);
            setShowSubmitDialog(true);
          }}
          onCancel={() => setShowWarning(false)}
        />

        {/* Submit confirmation */}
        <ConfirmDialog
          isOpen={showSubmitDialog}
          title="Submit Test"
          message={`You are about to submit your test. ${answeredCount} of ${totalQuestions} questions answered. This action cannot be undone.`}
          confirmLabel="Submit"
          onConfirm={confirmSubmit}
          onCancel={() => setShowSubmitDialog(false)}
        />
      </div>
    </ScreenRecordingDetector>
  );
}

function MobileQuestionPalette({
  questions,
  answers,
  currentIndex,
  onSelect,
}: {
  questions: Question[];
  answers: Record<string, any>;
  currentIndex: number;
  onSelect: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-brand-navy px-5 py-2.5 text-xs font-semibold text-white shadow-lg md:hidden"
      >
        <HelpCircle className="mr-1.5 inline h-4 w-4" />
        Questions ({questions.length})
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-white p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Questions</h3>
              <button onClick={() => setOpen(false)} className="p-1">
                <ChevronDown className="h-5 w-5 text-text-muted" />
              </button>
            </div>
            <div className="mb-3 grid grid-cols-6 gap-2">
              {questions.map((q, idx) => {
                const hasAnswer = answers[q.id] !== undefined && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && answers[q.id].length === 0);
                return (
                  <button
                    key={q.id}
                    onClick={() => { onSelect(idx); setOpen(false); }}
                    className={cn(
                      'flex h-10 w-full items-center justify-center rounded-lg text-xs font-semibold transition-colors',
                      idx === currentIndex
                        ? 'bg-brand-navy text-white'
                        : hasAnswer
                          ? 'bg-status-success/20 text-status-success'
                          : 'bg-surface-muted text-text-muted',
                    )}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-4 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-status-success/20" />
                Answered
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-surface-muted" />
                Unanswered
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-brand-navy" />
                Current
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
