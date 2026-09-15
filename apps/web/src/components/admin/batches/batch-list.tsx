'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, BookOpen, Pencil, Trash2, ChevronRight, Users, Calendar, GraduationCap } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/shared/AdminPageHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { AdminDataTable, type AdminDataTableColumn } from '@/components/shared/AdminDataTable';
import { AdminTableSkeleton } from '@/components/shared/AdminSkeletons';
import { AdminEmptyState } from '@/components/shared/AdminEmptyState';
import { BatchForm } from '@/components/admin/courses/batch-form';
import { type Batch, type Course, getAllBatches, getCourses, deleteBatch } from '@/lib/api/courses';

interface BatchListProps { initialBatches: Batch[]; initialTotal: number; }

export function BatchList({ initialBatches, initialTotal }: BatchListProps) {
  const [batches, setBatches] = useState<Batch[]>(initialBatches);
  const [total, setTotal] = useState(initialTotal);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<Batch | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const fetchPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    try { const r = await getAllBatches({ isActive: false, page: nextPage, limit: pageSize }); setBatches(r.items); setTotal(r.total); } catch { /* silent */ }
    finally { setLoading(false); }
  }, [pageSize]);

  const refresh = useCallback(async () => {
    await fetchPage(page);
  }, [fetchPage, page]);

  const handlePageChange = useCallback((next: number) => {
    setPage(next);
    fetchPage(next);
  }, [fetchPage]);

  const openCreate = async () => { try { const r = await getCourses(); setCourses(r.items); } catch { setCourses([]); } setShowCreateModal(true); };
  const openEdit = async (b: Batch) => { try { const r = await getCourses(); setCourses(r.items); } catch { setCourses([]); } setEditingBatch(b); };
  const confirmDelete = async () => { if (!deletingBatch) return; try { await deleteBatch(deletingBatch.id); setDeletingBatch(null); refresh(); } catch { /* silent */ } };

  const activeBatches = batches.filter(b => b.is_active).length;
  const inactiveBatches = batches.filter(b => !b.is_active).length;

  const columns: AdminDataTableColumn<Batch>[] = [
    { key: 'name', header: 'Name', sortable: true,
      render: (b) => <Link href={`/admin/batches/${b.id}`} className="text-brand-600 hover:underline font-medium break-words whitespace-normal" title={b.name}>{b.name}</Link> },
    { key: 'course', header: 'Course',
      render: (b) => <span className="text-xs text-text-muted break-words whitespace-normal" title={(b as any).course?.name ?? ''}>{(b as any).course?.name ?? '—'}</span> },
    { key: 'schedule', header: 'Schedule',
      render: (b) => <span className="text-xs capitalize">{b.schedule_type || '—'}</span> },
    { key: 'status', header: 'Status',
      render: (b) => <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${b.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{b.is_active ? 'Active' : 'Inactive'}</span> },
    { key: 'actions', header: 'Actions',
      render: (b) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(b)} className="rounded-lg px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors"><Pencil className="h-3.5 w-3.5 mr-1 inline" />Edit</button>
          <button onClick={() => setDeletingBatch(b)} className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="h-3.5 w-3.5 mr-1 inline" />Delete</button>
          <Link href={`/admin/batches/${b.id}`} className="rounded-lg px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"><ChevronRight className="h-4 w-4" /></Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Batches" description={`${total} batch${total !== 1 ? 'es' : ''} total`} actions={
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"><Plus className="h-4 w-4" /> Create Batch</button>
      } />

      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard label="Total Batches" value={total} icon={BookOpen} iconColor="bg-brand-50 text-brand-600" />
          <AdminStatCard label="Active" value={activeBatches} icon={GraduationCap} iconColor="bg-emerald-50 text-emerald-600" />
          <AdminStatCard label="Inactive" value={inactiveBatches} icon={Calendar} iconColor="bg-amber-50 text-amber-600" />
        </div>
      </AdminSection>

      {loading ? (
        <AdminTableSkeleton rows={5} cols={5} />
      ) : batches.length === 0 && !searchValue ? (
        <AdminEmptyState icon={BookOpen} title="No batches" description="Create your first batch to get started." actionLabel="Create Batch" actionHref="#" />
      ) : (
        <AdminDataTable
          columns={columns}
          data={batches}
          keyExtractor={(b) => b.id}
          showSearch
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          searchPlaceholder="Search batches..."
          searchKeys={['name']}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={handlePageChange}
          exportCsv
          csvFilename="batches.csv"
          csvHeaders={['Name', 'Course', 'Schedule', 'Status']}
          getCsvRow={(b) => [b.name, (b as any).course?.name ?? '', b.schedule_type || '', b.is_active ? 'Active' : 'Inactive']}
        />
      )}

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Batch"><BatchForm courseId="" courses={courses} onSuccess={() => { setShowCreateModal(false); refresh(); }} /></Modal>
      <Modal isOpen={!!editingBatch} onClose={() => setEditingBatch(null)} title="Edit Batch">{editingBatch && <BatchForm courseId={editingBatch.course_id} batch={editingBatch} courses={courses} onSuccess={() => { setEditingBatch(null); refresh(); }} />}</Modal>
      <ConfirmDialog isOpen={!!deletingBatch} title="Delete Batch" message={`Delete "${deletingBatch?.name}"? This cannot be undone.`} confirmLabel="Delete" onConfirm={confirmDelete} onCancel={() => setDeletingBatch(null)} />
    </div>
  );
}
