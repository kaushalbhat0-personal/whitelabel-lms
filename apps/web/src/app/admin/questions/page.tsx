'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Search, Filter, ChevronLeft, ChevronRight, HelpCircle,
  Upload, X, Save, Loader2, Trash2, Archive, RefreshCw, AlertTriangle,
  BookOpen, BarChart3,
} from 'lucide-react';
import {
  getQuestions, createQuestion, bulkImportQuestions,
  archiveQuestion, unarchiveQuestion, deleteQuestion, getTopics, uploadQuestionImage,
} from '@/lib/api/assessments';
import { cn } from '@/lib/utils';
import { AdminPageHeader } from '@/components/shared/AdminPageHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import type { QuestionResponse } from '@/lib/api/assessments';

const difficultyColors: Record<string, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
};

const typeColors: Record<string, string> = {
  single_choice: 'bg-blue-100 text-blue-700',
  multiple_choice: 'bg-purple-100 text-purple-700',
  true_false: 'bg-cyan-100 text-cyan-700',
  numerical: 'bg-orange-100 text-orange-700',
};

interface OptionEntry {
  key: string;
  value: string;
}

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<QuestionResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [topicFilter, setTopicFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [topics, setTopics] = useState<{ id: string; name: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState<QuestionResponse | null>(null);

  const limit = 20;

  useEffect(() => {
    getTopics().then(setTopics).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getQuestions({
        topicId: topicFilter || undefined,
        difficulty: difficultyFilter || undefined,
        questionType: typeFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        limit,
      });
      setQuestions(result.items);
      setTotal(result.total);
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [topicFilter, difficultyFilter, typeFilter, debouncedSearch, page]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const totalPages = Math.ceil(total / limit);

  const handleArchive = async (id: string) => {
    try {
      await archiveQuestion(id);
      fetchQuestions();
    } catch {}
  };

  const handleUnarchive = async (id: string) => {
    try {
      await unarchiveQuestion(id);
      fetchQuestions();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQuestion(id);
      setShowConfirmDelete(null);
      fetchQuestions();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Question Bank" description={`${total} question${total !== 1 ? 's' : ''} total — Manage and organize test questions`} actions={
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkModal(true)} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted transition-colors"><Upload className="h-4 w-4" /> Bulk Import</button>
          <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"><Plus className="h-4 w-4" /> Add Question</button>
        </div>
      } />

      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard label="Total Questions" value={total} icon={HelpCircle} iconColor="bg-brand-50 text-brand-600" />
          <AdminStatCard label="Topics" value={topics.length} icon={BookOpen} iconColor="bg-emerald-50 text-emerald-600" />
          <AdminStatCard label="Difficulty: Hard" value={questions.filter(q => q.difficulty === 'hard').length} icon={BarChart3} iconColor="bg-red-50 text-red-600" />
        </div>
      </AdminSection>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search questions..."
            aria-label="Search questions"
            className="w-full rounded-xl border border-surface-border bg-surface-card py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <select
          value={topicFilter}
          onChange={(e) => { setTopicFilter(e.target.value); setPage(1); }}
          aria-label="Filter by topic"
          className="rounded-xl border border-surface-border bg-surface-card py-2.5 px-4 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">All Topics</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          value={difficultyFilter}
          onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1); }}
          aria-label="Filter by difficulty"
          className="rounded-xl border border-surface-border bg-surface-card py-2.5 px-4 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">All Difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          aria-label="Filter by type"
          className="rounded-xl border border-surface-border bg-surface-card py-2.5 px-4 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">All Types</option>
          <option value="single_choice">Single Choice</option>
          <option value="multiple_choice">Multiple Choice</option>
          <option value="true_false">True/False</option>
          <option value="numerical">Numerical</option>
          <option value="short_answer">Short Answer</option>
          <option value="long_answer">Long Answer</option>
          <option value="image_upload">File Upload</option>
          <option value="image_based">Image Based</option>
        </select>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 motion-safe:animate-spin rounded-full border-4 border-surface-border border-t-brand-600" aria-label="Loading" role="status" />
          </div>
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <HelpCircle className="mb-3 h-12 w-12 text-text-muted" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-text-primary">{searchQuery || topicFilter || difficultyFilter || typeFilter ? 'No matching questions' : 'No questions found'}</h3>
            <p className="mt-1 max-w-sm text-sm text-text-muted">
              {searchQuery || topicFilter || difficultyFilter || typeFilter
                ? 'No questions match your filters. Try clearing filters or searching differently.'
                : 'Add questions to the bank to start building tests.'}
            </p>
            {searchQuery || topicFilter || difficultyFilter || typeFilter ? (
              <button
                onClick={() => { setSearchQuery(''); setTopicFilter(''); setDifficultyFilter(''); setTypeFilter(''); setPage(1); }}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-muted"
              >
                Clear filters
              </button>
            ) : (
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Plus className="h-4 w-4" />
                Add Question
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-muted">
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Question</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Difficulty</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Topic</th>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {questions.map((q) => (
                    <tr key={q.id} className="hover:bg-surface-muted/50">
                      <td className="max-w-md px-4 py-3">
                        <p className="truncate font-medium text-text-primary">{q.question_text}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', typeColors[q.question_type] || 'bg-gray-100 text-gray-700')}>
                          {q.question_type?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', difficultyColors[q.difficulty] || 'bg-gray-100 text-gray-700')}>
                          {q.difficulty}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{q.topics?.name || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {q.is_archived ? (
                            <button
                              onClick={() => handleUnarchive(q.id)}
                              aria-label={`Unarchive question: ${q.question_text.slice(0, 40)}`}
                              className="flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] text-text-muted hover:bg-surface-muted hover:text-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 transition-colors"
                            >
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleArchive(q.id)}
                              aria-label={`Archive question: ${q.question_text.slice(0, 40)}`}
                              className="flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] text-text-muted hover:bg-surface-muted hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 transition-colors"
                            >
                              <Archive className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            onClick={() => setShowConfirmDelete(q)}
                            aria-label={`Delete question: ${q.question_text.slice(0, 40)}`}
                            className="flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] text-text-muted hover:bg-surface-muted hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-surface-border px-4 py-3">
                <p className="text-sm text-text-muted">
                  Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-medium text-text-primary">{page}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AddQuestionModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={fetchQuestions}
        topics={topics}
      />

      <BulkImportModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onSuccess={fetchQuestions}
        topics={topics}
      />

      {showConfirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-surface-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <h2 className="text-lg font-semibold text-text-primary">Delete Question</h2>
              <button onClick={() => setShowConfirmDelete(null)} className="rounded-lg p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                <p className="text-sm text-text-secondary">
                  Are you sure you want to delete this question? This action cannot be undone.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowConfirmDelete(null)}
                  className="rounded-lg border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(showConfirmDelete.id)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddQuestionModal({
  isOpen,
  onClose,
  onSuccess,
  topics,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  topics: { id: string; name: string }[];
}) {
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState('single_choice');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [topicId, setTopicId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [options, setOptions] = useState<OptionEntry[]>([
    { key: 'A', value: '' },
    { key: 'B', value: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resetForm = () => {
    setQuestionText('');
    setQuestionType('single_choice');
    setCorrectAnswer('');
    setExplanation('');
    setDifficulty('medium');
    setTopicId('');
    setImageUrl('');
    setUploadingImage(false);
    setOptions([{ key: 'A', value: '' }, { key: 'B', value: '' }]);
    setError('');
  };

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen]);

  const addOption = () => {
    const nextKey = String.fromCharCode(65 + options.length);
    setOptions([...options, { key: nextKey, value: '' }]);
  };

  const removeOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const updateOption = (index: number, value: string) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, value } : o)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionText.trim()) { setError('Question text is required'); return; }

    const optionsObj: Record<string, any> = {};
    if (questionType === 'single_choice' || questionType === 'multiple_choice') {
      options.forEach((o) => { optionsObj[o.key] = o.value; });
      if (!correctAnswer) { setError('Please select a correct answer'); return; }
    }

    setSaving(true);
    setError('');

    try {
      await createQuestion({
        questionText: questionText.trim(),
        questionType,
        options: (questionType === 'single_choice' || questionType === 'multiple_choice' || questionType === 'image_based') ? optionsObj : undefined,
        correctAnswer: correctAnswer || undefined,
        explanation: explanation || undefined,
        difficulty,
        topicId: topicId || undefined,
        imageUrl: imageUrl || undefined,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create question');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-surface-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <h2 className="text-lg font-semibold text-text-primary">Add Question</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Question Text *</label>
            <textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
              placeholder="Enter the question..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Question Type</label>
              <select
                value={questionType}
                onChange={(e) => { setQuestionType(e.target.value); setCorrectAnswer(''); }}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
              >
                <option value="single_choice">Single Choice</option>
                <option value="multiple_choice">Multiple Choice</option>
                <option value="true_false">True/False</option>
                <option value="numerical">Numerical</option>
                <option value="short_answer">Short Answer</option>
                <option value="long_answer">Long Answer</option>
                <option value="image_upload">File Upload (Student uploads file)</option>
                <option value="image_based">Image Based (Question with image)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Topic</label>
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
            >
              <option value="">No topic</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {(questionType === 'single_choice' || questionType === 'multiple_choice') && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-text-secondary">Options</label>
                <button type="button" onClick={addOption} className="text-xs text-brand-600 hover:underline">+ Add option</button>
              </div>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-6 text-sm font-medium text-text-muted">{opt.key}.</span>
                    <input
                      value={opt.value}
                      onChange={(e) => updateOption(i, e.target.value)}
                      className="flex-1 rounded-xl border border-surface-border bg-surface-page px-4 py-2 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
                      placeholder={`Option ${opt.key}`}
                    />
                    <input
                      type={questionType === 'multiple_choice' ? 'checkbox' : 'radio'}
                      name="correctAnswer"
                      checked={questionType === 'multiple_choice'
                        ? correctAnswer.split(',').includes(opt.key)
                        : correctAnswer === opt.key}
                      onChange={() => {
                        if (questionType === 'multiple_choice') {
                          const keys = correctAnswer ? correctAnswer.split(',') : [];
                          const updated = keys.includes(opt.key)
                            ? keys.filter((k) => k !== opt.key)
                            : [...keys, opt.key];
                          setCorrectAnswer(updated.join(','));
                        } else {
                          setCorrectAnswer(opt.key);
                        }
                      }}
                      className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                    />
                    {options.length > 2 && (
                      <button type="button" onClick={() => removeOption(i)} className="p-1 text-text-muted hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {questionType === 'true_false' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Correct Answer</label>
              <div className="flex gap-4">
                {['true', 'false'].map((val) => (
                  <label key={val} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="tfAnswer"
                      checked={correctAnswer === val}
                      onChange={() => setCorrectAnswer(val)}
                      className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-sm capitalize text-text-primary">{val}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {questionType === 'numerical' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Correct Answer</label>
              <input
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
                placeholder="e.g. 42"
              />
            </div>
          )}

          {(questionType === 'short_answer' || questionType === 'long_answer') && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This question will be manually reviewed. Auto-grading is not applied. It will appear in Admin → Review Queue after submission.
            </div>
          )}

          {questionType === 'image_upload' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Student must upload a file (image/PDF). This requires manual review by admin.
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Reference Image / Attachment (optional)</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*,.pdf"
                disabled={uploadingImage}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 10 * 1024 * 1024) { setError('File must be < 10MB'); return; }
                  setUploadingImage(true);
                  try {
                    const { uploadQuestionImage } = await import('@/lib/api/assessments');
                    const res = await uploadQuestionImage(file);
                    setImageUrl(res.url);
                  } catch (err: any) {
                    setError(err?.message || 'Upload failed');
                  } finally {
                    setUploadingImage(false);
                  }
                }}
                className="flex-1 text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-700 disabled:opacity-50"
              />
              {uploadingImage && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}
            </div>
            {imageUrl && (
              <div className="mt-2 flex items-center gap-2">
                <span className="truncate text-xs text-text-muted">{imageUrl}</span>
                <button type="button" onClick={() => setImageUrl('')} className="text-xs text-red-600 hover:underline">Remove</button>
              </div>
            )}
            {imageUrl && imageUrl.startsWith('http') && (
              <img src={imageUrl} alt="Reference" className="mt-2 max-h-40 rounded-lg border border-surface-border object-contain" />
            )}
            <p className="mt-1 text-[10px] text-text-muted">Accepted: PNG/JPG/WEBP/GIF/PDF, max 10MB. Shown to student during attempt.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Explanation (optional)</label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none"
              placeholder="Explain the correct answer..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-600-dark disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save Question'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkImportModal({
  isOpen,
  onClose,
  onSuccess,
  topics,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  topics: { id: string; name: string }[];
}) {
  const [activeTab, setActiveTab] = useState<'json' | 'csv'>('csv');
  const [jsonText, setJsonText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(0);
  const [validation, setValidation] = useState<{ row: number; msg: string }[]>([]);
  const [csvFileName, setCsvFileName] = useState('');

  const resetState = () => { setError(''); setSuccess(0); setValidation([]); };

  useEffect(() => { if (!isOpen) { resetState(); setCsvFileName(''); } }, [isOpen]);

  const handleJsonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetState();
    let parsed: any[];
    try {
      parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('Must be an array');
    } catch (err: any) {
      setError('Invalid JSON: ' + err.message);
      return;
    }
    setSaving(true);
    try {
      const result = await bulkImportQuestions({ questions: parsed });
      setSuccess(result.length);
      onSuccess();
      setJsonText('');
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setSaving(false);
    }
  };

  // ── CSV helpers ──
  const csvHeaders = ['question_text','question_type','option_a','option_b','option_c','option_d','option_e','correct_answer','difficulty','topic','explanation','image_url'];

  const downloadTemplate = () => {
    const rows = [
      csvHeaders.join(','),
      // single_choice example (commas inside quotes handled)
      '"What is 2+2?","single_choice","3","4","5","6","","B","easy","Math","",""',
      '"Select even numbers","multiple_choice","1","2","3","4","","A,C","medium","Math","Even means divisible by 2",""',
      '"The sun rises in the east","true_false","","","","","","true","easy","General","",""',
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mct_question_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  function parseCsvLine(line: string): string[] {
    const out: string[] = []; let cur = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out.map((v) => v.replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim());
  }

  function csvToQuestions(csvText: string): { questions: any[]; rowErrors: { row: number; msg: string }[] } {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return { questions: [], rowErrors: [{ row: 1, msg: 'CSV must have header + at least 1 data row' }] };
    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const idx: Record<string, number> = {}; header.forEach((h, i) => { idx[h] = i; });
    const missing = csvHeaders.filter((h) => !(h in idx));
    // allow missing optional cols, but question_text/type required
    if (!('question_text' in idx) || !('question_type' in idx)) {
      return { questions: [], rowErrors: [{ row: 1, msg: `Header must include ${csvHeaders.join(', ')} (question_text, question_type required)` }] };
    }
    const questions: any[] = []; const rowErrors: { row: number; msg: string }[] = [];
    const topicMap = new Map(topics.map((t) => [t.name.toLowerCase(), t.id]));
    for (let r = 1; r < lines.length; r++) {
      const cols = parseCsvLine(lines[r]);
      const get = (k: string) => (idx[k] !== undefined ? (cols[idx[k]] ?? '').trim() : '');
      const qText = get('question_text');
      const qType = (get('question_type') || 'single_choice').trim();
      const diff = (get('difficulty') || 'medium').trim().toLowerCase();
      const topicName = get('topic');
      const correct = get('correct_answer');
      const explanation = get('explanation');
      const imageUrl = get('image_url');
      const rowNum = r + 1;
      if (!qText) { rowErrors.push({ row: rowNum, msg: 'question_text required' }); continue; }
      const validTypes = ['single_choice','multiple_choice','true_false','numerical','short_answer','long_answer','image_upload','image_based'];
      if (!validTypes.includes(qType)) { rowErrors.push({ row: rowNum, msg: `invalid question_type "${qType}"` }); continue; }
      const opts: Record<string,string> = {};
      ['a','b','c','d','e'].forEach((k) => {
        const v = get(`option_${k}`);
        if (v) opts[k.toUpperCase()] = v;
      });
      if ((qType === 'single_choice' || qType === 'multiple_choice') && Object.keys(opts).length < 2) {
        rowErrors.push({ row: rowNum, msg: `${qType} requires at least 2 options (option_a/b…)` }); continue;
      }
      if ((qType === 'single_choice' || qType === 'multiple_choice' || qType === 'true_false' || qType === 'numerical') && !correct) {
        rowErrors.push({ row: rowNum, msg: `${qType} requires correct_answer` }); continue;
      }
      const topicId = topicName ? (topicMap.get(topicName.toLowerCase()) || undefined) : undefined;
      const payload: any = {
        questionText: qText,
        questionType: qType,
        difficulty: ['easy','medium','hard'].includes(diff) ? diff : 'medium',
        correctAnswer: correct || undefined,
        explanation: explanation || undefined,
        imageUrl: imageUrl || undefined,
        topicId,
      };
      if (Object.keys(opts).length) payload.options = opts;
      questions.push(payload);
    }
    return { questions, rowErrors };
  }

  const handleCsvFile = async (file: File) => {
    resetState(); setCsvFileName(file.name);
    const text = await file.text();
    const { questions, rowErrors } = csvToQuestions(text);
    if (rowErrors.length) {
      setValidation(rowErrors);
      setError(`Found ${rowErrors.length} invalid row(s). Fix CSV and re-upload. Valid rows: ${questions.length}.`);
      return;
    }
    if (!questions.length) { setError('No valid rows found.'); return; }
    setSaving(true);
    try {
      const result = await bulkImportQuestions({ questions });
      setSuccess(result.length);
      setValidation([]);
      onSuccess();
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally { setSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-surface-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <h2 className="text-lg font-semibold text-text-primary">Bulk Import Questions</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-text-muted hover:bg-surface-muted hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex border-b border-surface-border">
          <button onClick={() => setActiveTab('csv')} className={`flex-1 py-3 text-sm font-medium ${activeTab==='csv' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-text-muted hover:text-text-primary'}`}>CSV</button>
          <button onClick={() => setActiveTab('json')} className={`flex-1 py-3 text-sm font-medium ${activeTab==='json' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-text-muted hover:text-text-primary'}`}>JSON</button>
        </div>

        {activeTab === 'csv' ? (
          <div className="p-6 space-y-4">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
            {success > 0 && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="status">Successfully imported {success} question{success>1?'s':''}!</div>}
            {validation.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">Row errors:</p>
                <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-amber-700 list-disc pl-4">
                  {validation.slice(0,20).map((v) => <li key={v.row}>Row {v.row}: {v.msg}</li>)}
                </ul>
              </div>
            )}
            <div className="rounded-xl border border-surface-border bg-surface-muted/30 p-4">
              <h3 className="text-sm font-semibold text-text-primary">How it works</h3>
              <ol className="mt-2 list-decimal pl-5 text-xs leading-relaxed text-text-secondary">
                <li>Download CSV template</li>
                <li>Fill rows — one question per row</li>
                <li>Upload CSV — we validate, show row errors, then import via existing pipeline</li>
              </ol>
              <div className="mt-3">
                <p className="text-xs font-medium text-text-secondary">Columns (header must match):</p>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-text-muted break-all">{csvHeaders.join(', ')}</p>
                <ul className="mt-2 text-xs text-text-muted list-disc pl-4">
                  <li><span className="font-medium">Required:</span> question_text, question_type</li>
                  <li>single/multiple: need ≥2 options (option_a…e) + correct_answer (e.g. B or A,C)</li>
                  <li>true_false: correct_answer true/false · numerical: numeric correct_answer</li>
                  <li>Optional: difficulty (easy/medium/hard), topic (name must match existing), explanation, image_url</li>
                  <li>Commas inside text: wrap cell in quotes; UTF-8, quoted values supported</li>
                </ul>
              </div>
              <button onClick={downloadTemplate} className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                Download CSV Template
              </button>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Upload CSV</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }}
                className="block w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:text-white"
              />
              {csvFileName && <p className="mt-1 text-xs text-text-muted">Selected: {csvFileName}</p>}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-muted min-h-[44px]">Close</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleJsonSubmit} className="p-6 space-y-4">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
            {success > 0 && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="status">Successfully imported {success} question{success > 1 ? 's' : ''}!</div>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Paste JSON array of questions</label>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={10}
                className="w-full rounded-xl border border-surface-border bg-surface-page px-4 py-2.5 text-sm font-mono text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder={JSON.stringify([{ questionText: 'What is 2+2?', questionType: 'single_choice', options: { A: '3', B: '4', C: '5', D: '6' }, correctAnswer: 'B', difficulty: 'easy' }], null, 2)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-muted min-h-[44px]">Cancel</button>
              <button type="submit" disabled={saving || !jsonText.trim()} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Upload className="h-4 w-4" />}
                {saving ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
