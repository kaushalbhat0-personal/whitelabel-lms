'use client';

import { useState, useCallback, useEffect } from 'react';
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
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type User,
  getStudents,
  createUser,
  deleteUser,
  permanentDeleteUser,
  restoreUser,
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
  const [showInactive, setShowInactive] = useState(false);
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
  // Permanent delete states — two-step confirmation
  const [permStep1Target, setPermStep1Target] = useState<User | null>(null);
  const [permStep2Target, setPermStep2Target] = useState<User | null>(null);
  const [confirmEmailInput, setConfirmEmailInput] = useState('');
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const refresh = useCallback(async (includeInactiveOverride?: boolean) => {
    const inactive = includeInactiveOverride ?? showInactive;
    setLoading(true);
    try {
      const result = await getStudents({ includeInactive: inactive });
      setStudents(result.items);
      setTotal(result.total);
    } catch { /* silent */ }
    finally { setLoading(false); }
    router.refresh();
  }, [router, showInactive]);

  useEffect(() => {
    refresh(showInactive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteUser(deleteTarget.id); setDeleteTarget(null); refresh(); toast.success('Student archived'); }
    catch (e: any) { setDeleteTarget(null); toast.error(e.message || 'Failed to archive'); }
  };

  const handleRestore = async (user: User) => {
    setRestoringId(user.id);
    try { await restoreUser(user.id); toast.success(`${user.name} restored`); refresh(); }
    catch (e: any) { toast.error(e.message || 'Failed to restore'); }
    finally { setRestoringId(null); }
  };

  const handlePermStep1Confirm = () => {
    if (!permStep1Target) return;
    const t = permStep1Target;
    setPermStep1Target(null);
    setPermStep2Target(t);
    setConfirmEmailInput('');
    setPermError('');
  };

  const handlePermanentDelete = async () => {
    if (!permStep2Target) return;
    if (confirmEmailInput.trim() !== permStep2Target.email) {
      setPermError('Email does not match. Type the exact email to confirm.');
      return;
    }
    setPermLoading(true);
    setPermError('');
    try {
      await permanentDeleteUser(permStep2Target.id);
      toast.success('Student permanently deleted');
      setPermStep2Target(null);
      setConfirmEmailInput('');
      refresh();
    } catch (e: any) {
      const data = e?.data ?? e;
      const code = data?.code ?? data?.details?.code;
      if (data?.code === 'STUDENT_HAS_HISTORICAL_RECORDS' || code === 'STUDENT_HAS_HISTORICAL_RECORDS') {
        const details = data.details ?? data.data?.details ?? {};
        const labels: string[] = [];
        if (details.payments) labels.push('Payments');
        if (details.paymentPlans) labels.push('Payment Plans');
        if (details.invoices) labels.push('Invoices');
        if (details.receipts) labels.push('Receipts');
        if (details.testResults) labels.push('Test Results');
        if (details.certificates) labels.push('Certificates');
        if (details.attendance) labels.push('Attendance');
        const which = labels.length ? ` (${labels.join(', ')})` : '';
        setPermError(`Cannot permanently delete because historical records exist${which}. Archive the student instead.`);
      } else {
        setPermError(e.message || 'Failed to permanently delete');
      }
    } finally { setPermLoading(false); }
  };

  const handleCloseAddStudent = useCallback(() => {
    setShowAddModal(false);
    setAddError('');
  }, []);

  const handleSingleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setAddError(''); setSubmitting(true);
    try {
      await createUser({ name: `${firstName} ${lastName}`.trim(), email, role: 'student', phone: phone || undefined });
      setFirstName(''); setLastName(''); setEmail(''); setPhone('');
      setShowAddModal(false); refresh();
      toast.success('Student created');
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
          {s.is_active ? (
            <button onClick={() => setDeleteTarget(s)} className="rounded-lg px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 transition-colors">Archive</button>
          ) : (
            <>
              <button onClick={() => handleRestore(s)} disabled={restoringId === s.id} className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">{restoringId === s.id ? 'Restoring…' : 'Restore'}</button>
              <button onClick={() => setPermStep1Target(s)} className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">Permanently Delete</button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader title="All Students" description={`${total} student${total !== 1 ? 's' : ''} enrolled`} actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-600" />
            Show Inactive
          </label>
          <button onClick={() => { setShowAddModal(true); setAddTab('single'); }} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
            <Plus className="h-4 w-4" /> Add Student
          </button>
        </div>
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

      <Modal isOpen={showAddModal} onClose={handleCloseAddStudent} title="Add Student">
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
          ) : <FileDropzone onUploadSuccess={() => refresh()} />}
        </div>
      </Modal>

      <AssignBatchModal isOpen={showAssignModal} studentIds={assignTargets} currentBatches={assignTargets.length === 1 ? students.find(s => s.id === assignTargets[0])?.batches ?? [] : []} studentLabel={assignTargets.length === 1 ? students.find(s => s.id === assignTargets[0])?.name ?? '' : `${assignTargets.length} students`} onClose={() => { setShowAssignModal(false); setAssignTargets([]); }} onSuccess={() => { setSelectedIds(new Set()); refresh(); }} />
      <ConfirmDialog isOpen={!!deleteTarget} variant="warning" title="Archive Student" message={deleteTarget ? `Archive ${deleteTarget.name}? The student will become inactive and their email will remain reserved. Use Permanently Delete (available for inactive students) to free the email for re-onboarding.` : ''} confirmLabel="Archive" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      {/* Permanent delete step 1 — warning */}
      <ConfirmDialog isOpen={!!permStep1Target} variant="warning" title="Permanently Delete Student?" message={permStep1Target ? `${permStep1Target.name} (${permStep1Target.email}) will be permanently deleted: Auth account, profile, enrollments, progress and ephemeral records will be removed and the email will become available for re-onboarding. Students with payments, invoices, test results, certificates or attendance cannot be deleted — archive instead.` : ''} confirmLabel="Continue" onConfirm={handlePermStep1Confirm} onCancel={() => setPermStep1Target(null)} />
      {/* Permanent delete step 2 — type email to confirm */}
      <Modal isOpen={!!permStep2Target} onClose={() => { setPermStep2Target(null); setConfirmEmailInput(''); setPermError(''); }} title="Confirm Permanent Deletion">
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">Type <span className="font-mono font-semibold text-text-primary">{permStep2Target?.email}</span> to confirm. This cannot be undone.</p>
          <input type="text" value={confirmEmailInput} onChange={e => { setConfirmEmailInput(e.target.value); setPermError(''); }} placeholder={permStep2Target?.email ?? ''} className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" autoFocus />
          {permError && <p className="text-sm text-red-600 whitespace-pre-wrap">{permError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setPermStep2Target(null); setConfirmEmailInput(''); setPermError(''); }} disabled={permLoading} className="rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-50">Cancel</button>
            <button onClick={handlePermanentDelete} disabled={permLoading || confirmEmailInput.trim() !== permStep2Target?.email} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{permLoading ? 'Deleting…' : 'Permanently Delete'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
