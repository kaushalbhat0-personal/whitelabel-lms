'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Plus, Edit3, Copy, Archive, Trash2, Search,
  ChevronLeft, ChevronRight, FileText, X, AlertTriangle,
  BarChart3, Clock, BookOpen,
} from 'lucide-react';
import { getTests, duplicateTest, archiveTest, deleteTest } from '@/lib/api/assessments';
import { ROUTES } from '@/lib/constants';
import { cn, formatDate } from '@/lib/utils';
import type { TestResponse } from '@/lib/api/assessments';
import { AdminPageHeader } from '@/components/shared/AdminPageHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-700',
  active: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-orange-100 text-orange-700',
  archived: 'bg-red-100 text-red-700',
  ended: 'bg-orange-100 text-orange-700',
};

function deriveAdminStatus(test: TestResponse, now: number): string {
  if (test.status === 'draft' || test.status === 'archived' || test.status === 'cancelled') return test.status;
  if (!test.start_time) return test.status;
  const start = new Date(test.start_time).getTime();
  const end = test.end_time ? new Date(test.end_time).getTime() : start + (test.duration_minutes ?? 60) * 60000;
  if (now < start) return 'scheduled';
  if (now > end) return 'ended';
  // within window and published/scheduled -> show published as Available
  return test.status === 'published' ? 'published' : 'active';
}

export default function AdminTestsPage() {
  const router = useRouter();
  const [tests, setTests] = useState<TestResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const [confirmAction, setConfirmAction] = useState<{ type: 'archive' | 'delete'; id: string; title: string } | null>(null);
  const limit = 20;

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { setDebouncedSearch(searchQuery); setPage(1); }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  const fetchTests = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTests({ status: statusFilter || undefined, search: debouncedSearch || undefined, page, limit });
      setTests(result.items); setTotal(result.total);
    } catch { setTests([]); }
    finally { setLoading(false); }
  }, [statusFilter, debouncedSearch, page]);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const handleDuplicate = async (id: string) => { try { await duplicateTest(id); toast.success('Test duplicated'); fetchTests(); } catch (e: any) { toast.error(e?.message || 'Failed'); } };
  const handleArchive = async (id: string) => { try { await archiveTest(id); toast.success('Archived'); setConfirmAction(null); fetchTests(); } catch (e: any) { toast.error(e?.message || 'Failed'); setConfirmAction(null); } };
  const handleDelete = async (id: string) => { try { await deleteTest(id); toast.success('Deleted'); setConfirmAction(null); fetchTests(); } catch (e: any) { toast.error(e?.message || 'Failed'); setConfirmAction(null); } };

  const totalPages = Math.ceil(total / limit);
  const totalMarks = tests.reduce((s, t) => s + (t.total_marks || 0), 0);
  const totalQuestions = tests.reduce((s, t) => s + (t.test_question_bank?.length ?? 0), 0);
  const activeTests = tests.filter(t => t.status === 'active' || t.status === 'published').length;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Tests" description="Manage assessments and exams" actions={
        <Link href={ROUTES.ADMIN.TESTS_NEW} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"><Plus className="h-4 w-4" /> Create New Test</Link>
      } />

      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard label="Total Tests" value={total} icon={FileText} iconColor="bg-brand-50 text-brand-600" />
          <AdminStatCard label="Active / Published" value={activeTests} icon={BookOpen} iconColor="bg-emerald-50 text-emerald-600" />
          <AdminStatCard label="Total Questions" value={totalQuestions} icon={BarChart3} iconColor="bg-blue-50 text-blue-600" />
        </div>
      </AdminSection>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search tests..." className="w-full rounded-xl border border-surface-border bg-surface-card py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-xl border border-surface-border bg-surface-card py-2.5 px-4 text-sm text-text-primary focus:border-brand-500 focus:outline-none">
          <option value="">All Statuses</option>
          {['draft','published','scheduled','active','closed','archived'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-surface-border bg-surface-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-surface-border border-t-brand-500" /></div>
        ) : tests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-12 w-12 text-text-muted" />
            <h3 className="text-lg font-semibold text-text-primary">No tests found</h3>
            <p className="mt-1 text-sm text-text-muted">{statusFilter ? 'No tests match the filter.' : 'Create your first test.'}</p>
            {!statusFilter && <Link href={ROUTES.ADMIN.TESTS_NEW} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">+ Create New Test</Link>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-muted">
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Questions</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Marks</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Duration</th>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Created</th>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                    {tests.map((test) => {
                      const derived = deriveAdminStatus(test, now);
                      return (
                      <tr key={test.id} className="hover:bg-surface-muted/50">
                        <td className="px-4 py-3 font-medium text-text-primary">{test.title}</td>
                        <td className="px-4 py-3"><span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', statusColors[derived] || 'bg-gray-100 text-gray-700')}>{derived}</span></td>
                      <td className="px-4 py-3 text-text-secondary">{test.test_question_bank?.length ?? 0}</td>
                      <td className="px-4 py-3 text-text-secondary">{test.total_marks}</td>
                      <td className="px-4 py-3 text-text-secondary">{test.duration_minutes ? `${test.duration_minutes} min` : '-'}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(test.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => router.push(`/admin/tests/${test.id}/edit`)} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary" title="Edit"><Edit3 className="h-4 w-4" /></button>
                          <button onClick={() => handleDuplicate(test.id)} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary" title="Duplicate"><Copy className="h-4 w-4" /></button>
                          <button onClick={() => setConfirmAction({ type: 'archive', id: test.id, title: test.title })} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-orange-600" title="Archive"><Archive className="h-4 w-4" /></button>
                          <button onClick={() => setConfirmAction({ type: 'delete', id: test.id, title: test.title })} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-red-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-surface-border px-4 py-3">
                <p className="text-sm text-text-muted">Showing {(page-1)*limit+1}–{Math.min(page*limit,total)} of {total}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="text-sm font-medium text-text-primary">{page}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmAction(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4"><h2 className="text-lg font-semibold">{confirmAction.type==='archive'?'Archive':'Delete'} Test</h2><button onClick={() => setConfirmAction(null)} className="rounded-lg p-1 text-text-muted hover:bg-surface-muted"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4 px-6 py-4">
              <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" /><p className="text-sm text-text-secondary">{confirmAction.type==='archive'?`Archive "${confirmAction.title}"?`:`Delete "${confirmAction.title}"? This cannot be undone.`}</p></div>
              <div className="flex justify-end gap-3"><button onClick={() => setConfirmAction(null)} className="rounded-lg border border-surface-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-muted">Cancel</button><button onClick={() => confirmAction.type==='archive'?handleArchive(confirmAction.id):handleDelete(confirmAction.id)} className={cn('rounded-lg px-4 py-2 text-sm font-semibold text-white',confirmAction.type==='archive'?'bg-orange-600 hover:bg-orange-700':'bg-red-600 hover:bg-red-700')}>{confirmAction.type==='archive'?'Archive':'Delete'}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
