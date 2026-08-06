'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { createTest, getQuestions } from '@/lib/api/assessments';
import { getAllBatches } from '@/lib/api/courses';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
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
}

export default function CreateTestPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      .then((result) => setAvailableBatches(result.items ?? []))
      .catch(() => setAvailableBatches([]));
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [questionSearch, questionPage]);

  const fetchQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const result = await getQuestions({ page: questionPage, limit: 20 });
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
      await createTest({
        title: title.trim(),
        description: description || undefined,
        instructions: instructions || undefined,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
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
      setError(err?.message || 'Failed to create test');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Create New Test</h1>
          <p className="mt-1 text-sm text-text-muted">Set up a new assessment for your students</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-surface-border bg-surface-card p-6">
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Basic Information</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
                placeholder="e.g. Mock Test 1"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
                placeholder="Brief description of the test"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-navy focus:outline-none"
                placeholder="Instructions for students..."
              />
            </div>
          </div>
        </div>

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
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
                placeholder="e.g. 60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Max Attempts</label>
              <input
                type="number"
                min="1"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
              />
            </div>
          </div>
        </div>

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
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Passing Marks</label>
              <input
                type="number"
                min="0"
                value={passingMarks}
                onChange={(e) => setPassingMarks(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={negativeMarking}
                onChange={(e) => setNegativeMarking(e.target.checked)}
                className="h-4 w-4 rounded border-surface-border text-brand-navy focus:ring-brand-navy"
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
                  className="w-full max-w-xs rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
                  placeholder="e.g. 0.25"
                />
              </div>
            )}
          </div>
        </div>

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
                  className="h-4 w-4 rounded border-surface-border text-brand-navy focus:ring-brand-navy"
                />
                <span className="text-sm font-medium text-text-secondary">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-surface-border bg-surface-card p-6">
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Batch Assignment</h2>
          {availableBatches.length === 0 ? (
            <p className="text-sm text-text-muted">No active batches found. Create a batch before assigning this test.</p>
          ) : (
            <div className="space-y-2">
              {availableBatches.map((batch) => (
                <label key={batch.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={batches.includes(batch.id)}
                    onChange={() => toggleBatch(batch.id)}
                    className="h-4 w-4 rounded border-surface-border text-brand-navy focus:ring-brand-navy"
                  />
                  <span className="text-sm text-text-primary">{batch.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

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
                  <GripVertical className="h-4 w-4 text-text-muted" />
                  <input
                    value={section.title}
                    onChange={(e) => updateSection(section.id, e.target.value)}
                    className="flex-1 rounded-xl border border-surface-border bg-surface-page px-4 py-2 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
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
            <p className="text-sm text-text-muted">No questions added yet.</p>
          ) : (
            <div className="divide-y divide-surface-border">
              {selectedQuestions.map((sq, i) => (
                <div key={sq.questionBankId} className="flex items-center gap-3 py-3">
                  <span className="text-sm font-medium text-text-muted w-6">{i + 1}.</span>
                  <p className="flex-1 text-sm text-text-primary truncate">{sq.questionText}</p>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-muted">Marks:</label>
                    <input
                      type="number"
                      min="0"
                      value={sq.marks}
                      onChange={(e) => updateQuestionMarks(sq.questionBankId, Number(e.target.value))}
                      className="w-16 rounded-lg border border-surface-border bg-surface-page px-2 py-1 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQuestion(sq.questionBankId)}
                    className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl border border-surface-border px-6 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-navy px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving...' : 'Create Test'}
          </button>
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
                  className="w-full rounded-xl border border-surface-border bg-surface-page py-2 pl-10 pr-4 text-sm text-text-primary focus:border-brand-navy focus:outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingQuestions ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-surface-border border-t-brand-navy" />
                </div>
              ) : availableQuestions.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">No questions found.</p>
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
                          <p className="text-sm font-medium text-text-primary truncate">{q.question_text}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs capitalize text-text-secondary">
                              {q.question_type?.replace('_', ' ')}
                            </span>
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-xs capitalize',
                              q.difficulty === 'easy' && 'bg-green-100 text-green-700',
                              q.difficulty === 'medium' && 'bg-yellow-100 text-yellow-700',
                              q.difficulty === 'hard' && 'bg-red-100 text-red-700',
                            )}>
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
