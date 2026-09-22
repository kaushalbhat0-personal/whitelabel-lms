'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Loader2,
  Search,
  GripVertical,
  X,
} from 'lucide-react';
import { getTest, updateTest, getQuestions } from '@/lib/api/assessments';
import { getAllBatches } from '@/lib/api/courses';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { localInputToUTCISOString, utcToLocalInput, computeEndFromStartAndDuration } from '@/lib/date-utils';
import type { QuestionResponse } from '@/lib/api/assessments';

interface Section {
  id: string;
  title: string;
}

interface SelectedQuestion {
  questionBankId: string;
  marks: number;
  sortOrder: number;
  questionText: string;
  questionType?: string;
  difficulty?: string;
}

const STEPS = [
  { id: 1, label: 'Details', desc: 'Title & scoring' },
  { id: 2, label: 'Questions', desc: 'Bank & sections' },
  { id: 3, label: 'Batches', desc: 'Assignment' },
  { id: 4, label: 'Schedule', desc: 'Timing & settings' },
] as const;

const typeColors: Record<string, string> = {
  single_choice: 'bg-blue-100 text-blue-700',
  multiple_choice: 'bg-purple-100 text-purple-700',
  true_false: 'bg-cyan-100 text-cyan-700',
  numerical: 'bg-orange-100 text-orange-700',
};
const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
};

export default function EditTestPage() {
  const router = useRouter();
  const params = useParams();
  const testId = params.id as string;

  const [activeStep, setActiveStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [totalMarks, setTotalMarks] = useState('');
  const [passingMarks, setPassingMarks] = useState('');
  const [negativeMarking, setNegativeMarking] = useState(false);
  const [negativePerQuestion, setNegativePerQuestion] = useState('');
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [showResultImmediately, setShowResultImmediately] = useState(false);
  const [batches, setBatches] = useState<string[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const [questionSearch, setQuestionSearch] = useState('');
  const [availableQuestions, setAvailableQuestions] = useState<QuestionResponse[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<SelectedQuestion[]>([]);
  const [questionPage, setQuestionPage] = useState(1);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [showQuestionBank, setShowQuestionBank] = useState(false);

  const [availableBatches, setAvailableBatches] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getAllBatches({ isActive: true, limit: 200 })
      .then((r) => setAvailableBatches(r.items ?? []))
      .catch(() => setAvailableBatches([]));
  }, []);

  useEffect(() => {
    fetchTest();
  }, [testId]);

  // Auto-sync end = start + duration
  useEffect(() => {
    if (!startTime || !durationMinutes) return;
    const startUTC = localInputToUTCISOString(startTime);
    const computedEndUTC = computeEndFromStartAndDuration(startUTC, Number(durationMinutes));
    if (!computedEndUTC) return;
    const localEnd = utcToLocalInput(computedEndUTC);
    if (localEnd && localEnd !== endTime) setEndTime(localEnd);
  }, [startTime, durationMinutes]);

  useEffect(() => {
    fetchQuestions();
  }, [questionSearch, questionPage]);

  const fetchTest = async () => {
    setLoading(true);
    try {
      const test = await getTest(testId);
      setTitle(test.title);
      setDescription(test.description || '');
      setInstructions(test.instructions || '');
      setDurationMinutes(test.duration_minutes ? String(test.duration_minutes) : '');
      setStartTime(utcToLocalInput(test.start_time));
      setEndTime(utcToLocalInput(test.end_time));
      setMaxAttempts(String(test.max_attempts || 1));
      setTotalMarks(String(test.total_marks));
      setPassingMarks(test.passing_marks ? String(test.passing_marks) : '');
      setNegativeMarking(test.negative_marking || false);
      setNegativePerQuestion(test.negative_per_question ? String(test.negative_per_question) : '');
      setShuffleQuestions(test.shuffle_questions || false);
      setShuffleOptions(test.shuffle_options || false);
      setShowResultImmediately(test.show_result_immediately || false);
      setBatches(test.test_batches?.map((tb: any) => tb.batch_id) || []);
      setSections(
        (test.test_sections || []).map((s: any) => ({
          id: s.id || crypto.randomUUID(),
          title: s.title || '',
        })),
      );
      setSelectedQuestions(
        (test.test_question_bank || []).map((tqb: any, i: number) => ({
          questionBankId: tqb.question_bank_id || tqb.id,
          marks: tqb.marks || 1,
          sortOrder: tqb.sort_order ?? i,
          questionText: tqb.question_text || tqb.questionBank?.question_text || '',
        })),
      );
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const result = await getQuestions({ search: questionSearch || undefined, page: questionPage, limit: 20 });
      setAvailableQuestions(result.items);
    } catch {
      setAvailableQuestions([]);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const addSection = () => {
    setSections([...sections, { id: crypto.randomUUID(), title: '' }]);
  };

  const removeSection = (id: string) => {
    setSections(sections.filter((s) => s.id !== id));
  };

  const updateSection = (id: string, title: string) => {
    setSections(sections.map((s) => (s.id === id ? { ...s, title } : s)));
  };

  const toggleBatch = (batchId: string) => {
    setBatches((prev) =>
      prev.includes(batchId) ? prev.filter((b) => b !== batchId) : [...prev, batchId],
    );
  };

  const addQuestion = (q: QuestionResponse) => {
    if (selectedQuestions.some((sq) => sq.questionBankId === q.id)) return;
    setSelectedQuestions([
      ...selectedQuestions,
      {
        questionBankId: q.id,
        marks: 1,
        sortOrder: selectedQuestions.length,
        questionText: q.question_text,
        questionType: q.question_type,
        difficulty: q.difficulty,
      },
    ]);
  };

  const removeQuestion = (questionBankId: string) => {
    setSelectedQuestions(selectedQuestions.filter((sq) => sq.questionBankId !== questionBankId));
  };

  const updateQuestionMarks = (questionBankId: string, marks: number) => {
    setSelectedQuestions(
      selectedQuestions.map((sq) => (sq.questionBankId === questionBankId ? { ...sq, marks } : sq)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    if (!totalMarks) { setError('Total marks is required'); return; }

    setSaving(true);
    setError('');

    try {
      const startUTC = localInputToUTCISOString(startTime);
      const endUTC = startUTC && durationMinutes ? computeEndFromStartAndDuration(startUTC, Number(durationMinutes)) : localInputToUTCISOString(endTime);
      await updateTest(testId, {
        title: title.trim(),
        description: description || undefined,
        instructions: instructions || undefined,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        startTime: startUTC,
        endTime: endUTC,
        maxAttempts: maxAttempts ? Number(maxAttempts) : undefined,
        totalMarks: Number(totalMarks),
        passingMarks: passingMarks ? Number(passingMarks) : undefined,
        negativeMarking,
        negativePerQuestion: negativeMarking ? (negativePerQuestion ? Number(negativePerQuestion) : undefined) : undefined,
        shuffleQuestions,
        shuffleOptions,
        showResultImmediately,
        batches: batches.map((batchId) => ({ batchId })),
        sections: sections.filter((s) => s.title.trim()).map((s, i) => ({
          title: s.title.trim(),
          sortOrder: i,
        })),
        questions: selectedQuestions.map((sq, i) => ({
          questionBankId: sq.questionBankId,
          marks: sq.marks,
          sortOrder: i,
        })),
      });
      router.push(ROUTES.ADMIN.TESTS);
    } catch (err: any) {
      setError(err?.message || 'Failed to update test');
    } finally {
      setSaving(false);
    }
  };

  const canProceed = () => {
    if (activeStep === 1) return title.trim() && totalMarks;
    return true;
  };
  const nextStep = () => {
    if (activeStep === 1 && !title.trim()) { setError('Title is required'); return; }
    if (activeStep === 1 && !totalMarks) { setError('Total marks is required'); return; }
    setError('');
    setActiveStep((s) => Math.min(4, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const prevStep = () => { setError(''); setActiveStep((s) => Math.max(1, s - 1)); };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-surface-border border-t-brand-600" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-text-primary">Test not found</h2>
        <p className="mt-1 text-sm text-text-muted">The test you are looking for does not exist.</p>
        <button
          onClick={() => router.push(ROUTES.ADMIN.TESTS)}
          className="mt-4 rounded-xl bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
        >
          Back to Tests
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Edit Test</h1>
          <p className="mt-1 text-sm text-text-muted">Update test details</p>
        </div>
      </div>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <a href="/admin" className="hover:text-text-primary hover:underline">Admin</a>
        <span aria-hidden="true">/</span>
        <a href="/admin/tests" className="hover:text-text-primary hover:underline">Tests</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="font-medium text-text-primary">Edit</span>
      </nav>

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-2" aria-label="Test creation steps">
        {STEPS.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors min-h-[44px]',
                activeStep === step.id ? 'bg-brand-navy text-white' : activeStep > step.id ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-surface-muted text-text-muted border border-surface-border'
              )}
              aria-current={activeStep === step.id ? 'step' : undefined}
            >
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', activeStep === step.id ? 'bg-white/20' : 'bg-white border border-surface-border')}>{step.id}</span>
              <span>{step.label}</span>
            </button>
            {idx < STEPS.length - 1 && <div className={cn('h-px w-6 shrink-0', activeStep > step.id ? 'bg-brand-navy' : 'bg-surface-border')} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {activeStep === 1 && (
          <div className="rounded-xl border border-surface-border bg-surface-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Basic Information</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </div>
        )}

        {activeStep === 4 && (
          <div className="rounded-xl border border-surface-border bg-surface-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Timing & Access</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Duration (minutes)</label>
              <input
                type="number"
                min="1"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Max Attempts</label>
              <input
                type="number"
                min="1"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </div>
        )}

        {activeStep === 1 && (
          <div className="rounded-xl border border-surface-border bg-surface-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Scoring</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Total Marks *</label>
              <input
                type="number"
                min="1"
                required
                value={totalMarks}
                onChange={(e) => setTotalMarks(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Passing Marks</label>
              <input
                type="number"
                min="0"
                value={passingMarks}
                onChange={(e) => setPassingMarks(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={negativeMarking}
                onChange={(e) => setNegativeMarking(e.target.checked)}
                className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm font-medium text-text-secondary">Enable Negative Marking</span>
            </label>
            {negativeMarking && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Negative per Question</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={negativePerQuestion}
                  onChange={(e) => setNegativePerQuestion(e.target.value)}
                  className="w-full max-w-xs rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            )}
          </div>
        </div>
        )}

        {activeStep === 4 && (
          <div className="rounded-xl border border-surface-border bg-surface-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Settings</h2>
          <div className="space-y-3">
            {[
              { label: 'Shuffle Questions', value: shuffleQuestions, set: setShuffleQuestions },
              { label: 'Shuffle Options', value: shuffleOptions, set: setShuffleOptions },
              { label: 'Show Result Immediately', value: showResultImmediately, set: setShowResultImmediately },
            ].map(({ label, value, set }) => (
              <label key={label} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                  className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-text-secondary">{label}</span>
              </label>
            ))}
          </div>
        </div>
        )}

        {activeStep === 3 && (
          <div className="rounded-xl border border-surface-border bg-surface-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Batch Assignment</h2>
          <div className="space-y-2">
            {availableBatches.map((batch) => (
              <label key={batch.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={batches.includes(batch.id)}
                  onChange={() => toggleBatch(batch.id)}
                  className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-text-primary">{batch.name}</span>
              </label>
            ))}
          </div>
        </div>
        )}

        {activeStep === 2 && (
          <>
            <div className="rounded-xl border border-surface-border bg-surface-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">Sections</h2>
            <button
              type="button"
              onClick={addSection}
              className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-muted"
            >
              <Plus className="h-4 w-4" />
              Add Section
            </button>
          </div>
          {sections.length === 0 ? (
            <p className="text-sm text-text-muted">No sections added yet.</p>
          ) : (
            <div className="space-y-3">
              {sections.map((section) => (
                <div key={section.id} className="flex items-center gap-3">
                  <input
                    value={section.title}
                    onChange={(e) => updateSection(section.id, e.target.value)}
                    className="flex-1 rounded-xl border border-surface-border bg-surface-page px-4 py-2 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Section title"
                  />
                  <button
                    type="button"
                    onClick={() => removeSection(section.id)}
                    className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-surface-border bg-surface-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Questions</h2>
            <button
              type="button"
              onClick={() => setShowQuestionBank(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-navy-dark"
            >
              <Plus className="h-4 w-4" />
              Add from Question Bank
            </button>
          </div>
          {selectedQuestions.length === 0 ? (
            <p className="text-sm text-text-muted">No questions added yet. Use “Add from Question Bank” to select questions.</p>
          ) : (
            <div className="divide-y divide-surface-border">
              {selectedQuestions.map((sq, i) => {
                const meta = availableQuestions.find((q) => q.id === sq.questionBankId);
                const qType = sq.questionType || meta?.question_type;
                const diff = sq.difficulty || meta?.difficulty;
                return (
                  <div key={sq.questionBankId} className="flex items-center gap-3 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-text-secondary">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary" title={sq.questionText}>{sq.questionText}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {qType && <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', typeColors[qType] || 'bg-gray-100 text-gray-700')}>{qType.replace('_',' ')}</span>}
                        {diff && <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', difficultyColors[diff] || 'bg-gray-100 text-gray-700')}>{diff}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label htmlFor={`marks-${sq.questionBankId}`} className="text-xs font-medium text-text-secondary">Marks</label>
                      <input
                        id={`marks-${sq.questionBankId}`}
                        type="number"
                        min="0"
                        value={sq.marks}
                        onChange={(e) => updateQuestionMarks(sq.questionBankId, Number(e.target.value))}
                        className="w-20 rounded-lg border border-surface-border bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 min-h-[44px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeQuestion(sq.questionBankId)}
                      aria-label={`Remove question ${i + 1}: ${sq.questionText.slice(0, 30)}`}
                      className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-red-600 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-muted min-h-[44px]"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {activeStep > 1 && (
              <button
                type="button"
                onClick={prevStep}
                className="rounded-xl border border-surface-border px-6 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-muted min-h-[44px]"
              >
                Back
              </button>
            )}
            {activeStep < 4 ? (
              <button
                type="button"
                onClick={nextStep}
                disabled={!canProceed()}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-navy px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-60 min-h-[44px]"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-navy px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-60 min-h-[44px]"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </form>

      {showQuestionBank && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowQuestionBank(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] rounded-xl bg-surface-card shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <h2 className="text-lg font-semibold text-text-primary">Question Bank</h2>
              <button
                onClick={() => setShowQuestionBank(false)}
                className="rounded-lg p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 border-b border-surface-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  value={questionSearch}
                  onChange={(e) => { setQuestionSearch(e.target.value); setQuestionPage(1); }}
                  placeholder="Search questions..."
                  className="w-full rounded-xl border border-surface-border bg-surface-page py-2 pl-10 pr-4 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingQuestions ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-surface-border border-t-brand-600" />
                </div>
              ) : availableQuestions.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium text-text-primary">{questionSearch ? 'No matching questions' : 'No questions found'}</p>
                  <p className="mt-1 text-xs text-text-muted">{questionSearch ? `No questions match “${questionSearch}”. Try different search.` : 'No questions in bank.'}</p>
                  {questionSearch && (
                    <button onClick={() => setQuestionSearch('')} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted">
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {availableQuestions.map((q) => {
                    const isSelected = selectedQuestions.some((sq) => sq.questionBankId === q.id);
                    return (
                      <div
                        key={q.id}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                          isSelected
                            ? 'border-brand-navy bg-brand-navy/5'
                            : 'border-surface-border hover:border-brand-navy/30',
                        )}
                        onClick={() => addQuestion(q)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-navy"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate" title={q.question_text}>{q.question_text}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', typeColors[q.question_type] || 'bg-gray-100 text-gray-700')}>
                              {q.question_type?.replace('_', ' ')}
                            </span>
                            <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', difficultyColors[q.difficulty] || 'bg-gray-100 text-gray-700')}>
                              {q.difficulty}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t border-surface-border px-6 py-3 flex items-center justify-between">
              <span className="text-sm text-text-muted">{availableQuestions.length} questions loaded</span>
              <button
                onClick={() => setShowQuestionBank(false)}
                className="rounded-xl bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
              >
                Done ({selectedQuestions.length} selected)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
