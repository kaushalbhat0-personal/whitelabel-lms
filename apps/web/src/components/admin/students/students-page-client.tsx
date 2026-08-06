'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Plus,
  UserPlus,
  Upload,
  Link2,
  Trash2,
  CheckCircle2,
  Calendar,
  GraduationCap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type User,
  getStudents,
  createUser,
  deleteUser,
} from '@/lib/api/users';
import { AdminPageHeader } from '@/components/shared/AdminPageHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { AdminDataTable, type AdminDataTableColumn } from '@/components/shared/AdminDataTable';
import { AdminTableSkeleton } from '@/components/shared/AdminSkeletons';
import { AdminEmptyState } from '@/components/shared/AdminEmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FileDropzone } from '@/components/admin/bulk-upload/file-dropzone';
import { AssignBatchModal } from './assign-batch-modal';

interface StudentsPageClientProps {
  initialStudents: User[];
  initialTotal: number;
}

export function StudentsPageClient({ initialStudents, initialTotal }: StudentsPageClientProps) {
  const router = useRouter();
  const [students, setStudents] = useState<User[]>(initialStudents);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'single' | 'bulk'>('single');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addError, setAddError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTargets, setAssignTargets] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getStudents();
      setStudents(result.items);
      setTotal(result.total);
    } catch { /* silent */ }
    finally { setLoading(false); }
    router.refresh();
  }, [router]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteUser(deleteTarget.id); setDeleteTarget(null); refresh(); }
    catch { setDeleteTarget(null); }
  };

  const handleSingleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setAddError(''); setSubmitting(true);
    try {
      await createUser({ name: `${firstName} ${lastName}`.trim(), email, role: 'student', phone: phone || undefined });
      setFirstName(''); setLastName(''); setEmail(''); setPhone('');
      setShowAddModal(false); refresh();
    } catch (err: any) { setAddError(err.message || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const openAssignBulk = () => { setAssignTargets(Array.from(selectedIds)); setShowAssignModal(true); };

  const studentsWithBatches = students.filter(s => (s.batches?.length ?? 0) > 0).length;
  const activeStudents = students.filter(s => s.is_active).length;
  const newThisMonth = students.filter(s => { const d = new Date(s.created_at); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length;

  const columns: AdminDataTableColumn<User>[] = [
    { key: 'name', header: 'Name', sortable: true,
      render: (s) => <a href={`/admin/students/${s.id}`} className="text-brand-600 hover:underline font-medium">{s.name}</a> },
    { key: 'email', header: 'Email', sortable: true, hideOnMobile: true },
    { key: 'phone', header: 'Phone', render: (s) => s.phone || '—', hideOnMobile: true },
    { key: 'batches', header: 'Batches',
      render: (s) => {
        const list = s.batches ?? [];
        if (list.length === 0) return <span className="text-xs text-text-muted">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {list.map((b) => (
              <span key={b.id} className="inline-flex rounded-full border border-surface-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-secondary">
                {b.name}
              </span>
            ))}
          </div>
        );
      } },
    { key: 'status', header: 'Status',
      render: (s) => <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{s.is_active ? 'Active' : 'Inactive'}</span> },
    { key: 'actions', header: 'Actions',
      render: (s) => (
        <div className="flex items-center gap-1">
          <button onClick={() => { setAssignTargets([s.id]); setShowAssignModal(true); }} className="rounded-lg px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors">Assign</button>
          <button onClick={() => setDeleteTarget(s)} className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">Archive</button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader title="All Students" description={`${total} student${total !== 1 ? 's' : ''} enrolled`} actions={
        <button onClick={() => { setShowAddModal(true); setAddTab('single'); }} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
          <Plus className="h-4 w-4" /> Add Student
        </button>
      } />

      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard label="Total Students" value={total} icon={Users} iconColor="bg-brand-50 text-brand-600" />
          <AdminStatCard label="Active" value={activeStudents} sublabel={`${studentsWithBatches} in batches`} icon={GraduationCap} iconColor="bg-emerald-50 text-emerald-600" />
          <AdminStatCard label="New This Month" value={newThisMonth} icon={Calendar} iconColor="bg-blue-50 text-blue-600" />
        </div>
      </AdminSection>

      {loading ? (
        <AdminTableSkeleton rows={5} cols={6} showBulk />
      ) : students.length === 0 ? (
        <AdminEmptyState icon={Users} title="No students" description="Add your first student to get started." actionLabel="Add Student" actionHref="#" />
      ) : (
        <AdminDataTable
          columns={columns}
          data={students}
          keyExtractor={(s) => s.id}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by name or email..."
          searchKeys={['name', 'email', 'phone']}
          bulkActions={[{ label: 'Assign to Batch', onClick: () => openAssignBulk() }]}
          exportCsv csvFilename="students.csv"
          csvHeaders={['Name', 'Email', 'Phone', 'Batches', 'Status']}
          getCsvRow={(s) => [s.name, s.email, s.phone || '', String(s.batches?.length ?? 0), s.is_active ? 'Active' : 'Inactive']}
        />
      )}

      <Modal isOpen={showAddModal} onClose={() => { setShowAddModal(false); setAddError(''); }} title="Add Student">
        <div className="flex border-b border-surface-border">
          <button onClick={() => setAddTab('single')} className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium ${addTab === 'single' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-text-muted'}`}>Single</button>
          <button onClick={() => setAddTab('bulk')} className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium ${addTab === 'bulk' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-text-muted'}`}>Bulk</button>
        </div>
        <div className="p-4">
          {addTab === 'single' ? (
            <form onSubmit={handleSingleAdd} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-text-secondary mb-1">First Name *</label><input required value={firstName} onChange={e => setFirstName(e.target.value)} className="input-field text-sm" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Last Name</label><input value={lastName} onChange={e => setLastName(e.target.value)} className="input-field text-sm" /></div>
              </div>
              <div><label className="block text-xs font-medium text-text-secondary mb-1">Email *</label><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-xs font-medium text-text-secondary mb-1">Phone</label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input-field text-sm" /></div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
              <button type="submit" disabled={submitting} className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{submitting ? 'Creating...' : 'Create Student'}</button>
            </form>
          ) : <FileDropzone onUploadSuccess={refresh} />}
        </div>
      </Modal>

      <AssignBatchModal isOpen={showAssignModal} studentIds={assignTargets} currentBatches={assignTargets.length === 1 ? students.find(s => s.id === assignTargets[0])?.batches ?? [] : []} studentLabel={assignTargets.length === 1 ? students.find(s => s.id === assignTargets[0])?.name ?? '' : `${assignTargets.length} students`} onClose={() => { setShowAssignModal(false); setAssignTargets([]); }} onSuccess={() => { setSelectedIds(new Set()); refresh(); }} />
      <ConfirmDialog isOpen={!!deleteTarget} title="Archive Student" message={deleteTarget ? `Archive ${deleteTarget.name}? Data will be preserved.` : ''} confirmLabel="Archive" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}
