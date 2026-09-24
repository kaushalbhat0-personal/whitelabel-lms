'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  BookOpen,
  IndianRupee,
  ClipboardList,
  Award,
  Trophy,
  Megaphone,
  Activity,
  RefreshCw,
  Mail,
  Link2,
  CreditCard,
  ChevronRight,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trash2,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-currency';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';
import { AdminWorkspaceHeader } from '@/components/shared/AdminWorkspaceHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { AdminDataTable, type AdminDataTableColumn } from '@/components/shared/AdminDataTable';
import { AdminEmptyState } from '@/components/shared/AdminEmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AssignBatchModal } from './assign-batch-modal';
import { permanentDeleteUser, restoreUser } from '@/lib/api/users';

interface StudentWorkspaceProps {
  student: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    is_active: boolean;
    created_at: string;
    role: string;
  };
  initialBatches: any[];
  initialPlans: any[];
  initialAnalytics: any;
  initialAuditLogs: any[];
}

type Tab = 'overview' | 'enrollments' | 'payments' | 'assessments' | 'certificates' | 'achievements' | 'communication' | 'activity';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <Activity className="h-4 w-4" /> },
  { key: 'enrollments', label: 'Enrollments', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'payments', label: 'Payments', icon: <IndianRupee className="h-4 w-4" /> },
  { key: 'assessments', label: 'Assessments', icon: <ClipboardList className="h-4 w-4" /> },
  { key: 'certificates', label: 'Certificates', icon: <Award className="h-4 w-4" /> },
  { key: 'achievements', label: 'Achievements', icon: <Trophy className="h-4 w-4" /> },
  { key: 'communication', label: 'Communication', icon: <Megaphone className="h-4 w-4" /> },
  { key: 'activity', label: 'Activity', icon: <Activity className="h-4 w-4" /> },
];

export function StudentWorkspace({
  student,
  initialBatches,
  initialPlans,
  initialAnalytics,
  initialAuditLogs,
}: StudentWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [permStep1Open, setPermStep1Open] = useState(false);
  const [permStep2Open, setPermStep2Open] = useState(false);
  const [confirmEmailInput, setConfirmEmailInput] = useState('');
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState('');
  const [restoring, setRestoring] = useState(false);

  const totals = {
    enrolledBatches: Array.isArray(initialBatches) ? initialBatches.length : 0,
    paymentPlans: Array.isArray(initialPlans) ? initialPlans.length : 0,
    totalPaid: Array.isArray(initialPlans)
      ? initialPlans.reduce((sum: number, p: any) =>
          sum + (p.installments ?? []).reduce((s: number, i: any) =>
            s + (i.status === 'paid' ? (i.amount || 0) : 0), 0), 0)
      : 0,
    totalPending: Array.isArray(initialPlans)
      ? initialPlans.reduce((sum: number, p: any) =>
          sum + (p.installments ?? []).reduce((s: number, i: any) =>
            s + (i.status !== 'paid' ? (i.amount || 0) : 0), 0), 0)
      : 0,
    testsTaken: initialAnalytics?.total_tests_taken ?? 0,
    avgScore: initialAnalytics?.average_percentage ?? null,
  };

  const { currency, locale, timezone } = useBusinessConfig();
  const fmtCurrency = (amt: number) => formatCurrency(amt, currency, locale, { maximumFractionDigits: 0 });
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(locale, { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  };

  const handleRestore = async () => {
    setRestoring(true);
    try { await restoreUser(student.id); toast.success(`${student.name} restored`); router.refresh(); }
    catch (e: any) { toast.error(e.message || 'Failed to restore'); }
    finally { setRestoring(false); }
  };

  const handlePermStep1Confirm = () => { setPermStep1Open(false); setPermStep2Open(true); setConfirmEmailInput(''); setPermError(''); };
  const handlePermanentDelete = async () => {
    if (confirmEmailInput.trim() !== student.email) { setPermError('Email does not match. Type the exact email to confirm.'); return; }
    setPermLoading(true); setPermError('');
    try { await permanentDeleteUser(student.id); toast.success('Student permanently deleted'); router.push('/admin/students'); router.refresh(); }
    catch (e: any) {
      const data = e?.data ?? e;
      if (data?.code === 'STUDENT_HAS_HISTORICAL_RECORDS') {
        const d = data.details ?? {};
        const labels: string[] = [];
        if (d.payments) labels.push('Payments');
        if (d.paymentPlans) labels.push('Payment Plans');
        if (d.invoices) labels.push('Invoices');
        if (d.receipts) labels.push('Receipts');
        if (d.testResults) labels.push('Test Results');
        if (d.certificates) labels.push('Certificates');
        if (d.attendance) labels.push('Attendance');
        const which = labels.length ? ` (${labels.join(', ')})` : '';
        setPermError(`Cannot permanently delete because historical records exist${which}. Archive the student instead.`);
      } else { setPermError(e.message || 'Failed to permanently delete'); }
    } finally { setPermLoading(false); }
  };

  const activityColumns: AdminDataTableColumn<any>[] = [
    { key: 'time', header: 'Time', render: (item) => <span className="text-xs whitespace-nowrap">{fmtTime(item.createdAt)}</span> },
    { key: 'action', header: 'Action',
      render: (item) => (
        <span className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
          item.action === 'created' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
          item.action === 'updated' ? 'bg-blue-50 text-blue-700 border-blue-200' :
          item.action === 'deleted' ? 'bg-red-50 text-red-700 border-red-200' :
          'bg-gray-100 text-gray-600 border-gray-200',
        )}>{item.action}</span>
      ),
    },
    { key: 'entityType', header: 'Entity', render: (item) => <span className="text-xs font-medium">{item.entityType}</span> },
    { key: 'details', header: 'Details', className: 'max-w-xs',
      render: (item) => (
        <div className="truncate text-xs text-text-muted">
          {item.metadata?.subject || item.metadata?.recipient || item.metadata?.template || '—'}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminWorkspaceHeader
        title={student.name}
        subtitle={student.email}
        backHref="/admin/students"
        badges={[
          { label: student.is_active ? 'Active' : 'Suspended', variant: student.is_active ? 'active' : 'warning' },
        ]}
        context={[
          { label: 'Joined', value: fmtDate(student.created_at) },
          { label: 'Batches', value: String(totals.enrolledBatches) },
          { label: 'Payments', value: fmtCurrency(totals.totalPaid) },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {!student.is_active && (
              <button onClick={handleRestore} disabled={restoring} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" />
                {restoring ? 'Restoring…' : 'Restore Student'}
              </button>
            )}
            <button onClick={() => setShowAssignModal(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors">
              <Link2 className="h-3.5 w-3.5" />
              Assign Batch
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="border-b border-surface-border">
        <nav className="-mb-px flex gap-0 overflow-x-auto" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === tab.key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:border-surface-border',
              )}
              role="tab" aria-selected={activeTab === tab.key}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div role="tabpanel">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <AdminSection title="Student Profile">
              <div className="rounded-xl border border-surface-border bg-surface-card p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[{ label: 'Email', value: student.email, icon: Mail },
                  { label: 'Phone', value: student.phone || '—', icon: Users },
                  { label: 'Joined', value: fmtDate(student.created_at), icon: Calendar },
                  { label: 'Status', value: student.is_active ? 'Active' : 'Suspended', icon: CheckCircle2 }].map((field) => (
                  <div key={field.label}>
                    <p className="text-xs font-medium text-text-muted">{field.label}</p>
                    <p className="mt-1 text-sm font-medium text-text-primary">{field.value}</p>
                  </div>
                ))}
              </div>
            </AdminSection>

            <AdminSection title="Key Metrics">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <AdminStatCard label="Enrolled Batches" value={totals.enrolledBatches} icon={BookOpen} iconColor="bg-brand-50 text-brand-600" />
                <AdminStatCard label="Tests Taken" value={totals.testsTaken} icon={ClipboardList} iconColor="bg-blue-50 text-blue-600" />
                <AdminStatCard label="Total Paid" value={fmtCurrency(totals.totalPaid)} icon={IndianRupee} iconColor="bg-emerald-50 text-emerald-600" />
                <AdminStatCard label="Avg Score" value={totals.avgScore != null ? `${totals.avgScore}%` : '—'} sublabel={totals.testsTaken > 0 ? `${totals.testsTaken} tests` : undefined} icon={Trophy} iconColor="bg-purple-50 text-purple-600" />
              </div>
            </AdminSection>

            {totals.paymentPlans > 0 && totals.totalPending > 0 && (
              <AdminSection title="Pending Dues">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                    <Clock className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary">{fmtCurrency(totals.totalPending)} outstanding</p>
                    <p className="text-sm text-text-secondary mt-0.5">This student has pending payments across {totals.paymentPlans} plans</p>
                  </div>
                </div>
              </AdminSection>
            )}

            {/* Danger Zone — always visible on overview for discoverability */}
            <AdminSection title="Danger Zone">
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100">
                    <ShieldAlert className="h-5 w-5 text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-red-800">Permanently Delete Student</p>
                    <p className="mt-1 text-xs leading-relaxed text-red-700">Auth account and profile will be permanently deleted; enrollments, progress and ephemeral records may be removed. Email will become available for re-onboarding. Students with payments, invoices, test results, certificates or attendance cannot be deleted — archive instead.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!student.is_active && (
                    <button onClick={handleRestore} disabled={restoring} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                      <RotateCcw className="h-4 w-4" /> {restoring ? 'Restoring…' : 'Restore Student'}
                    </button>
                  )}
                  <button onClick={() => setPermStep1Open(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors">
                    <Trash2 className="h-4 w-4" /> Permanently Delete
                  </button>
                </div>
                {!student.is_active ? null : (
                  <p className="text-xs text-text-muted">Tip: Archive is available via the students list. Permanent delete is typically used for inactive students with no historical records.</p>
                )}
              </div>
            </AdminSection>

            {initialAuditLogs.length > 0 && (
              <AdminSection title="Recent Activity" actions={
                <button onClick={() => setActiveTab('activity')} className="text-xs font-medium text-brand-600 hover:text-brand-700">View all</button>
              }>
                <div className="rounded-xl border border-surface-border bg-surface-card divide-y divide-surface-border">
                  {initialAuditLogs.slice(0, 5).map((log: any, i: number) => (
                    <div key={log.id || i} className="flex items-center gap-3 px-5 py-3">
                      <span className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                        log.action === 'created' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        log.action === 'updated' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-gray-100 text-gray-600 border-gray-200',
                      )}>{log.action}</span>
                      <span className="text-xs text-text-secondary">{log.entityType}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-text-muted whitespace-nowrap">{fmtTime(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </AdminSection>
            )}
          </div>
        )}

        {/* Enrollments Tab */}
        {activeTab === 'enrollments' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-muted">{totals.enrolledBatches} batch{initialBatches.length !== 1 ? 'es' : ''} enrolled</p>
              <button onClick={() => setShowAssignModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                <Link2 className="h-4 w-4" />
                Assign Batch
              </button>
            </div>

            {!Array.isArray(initialBatches) || initialBatches.length === 0 ? (
              <AdminEmptyState icon={BookOpen} title="No enrollments" description="Assign this student to a batch to get started." actionLabel="Assign Batch" actionHref="#" />
            ) : (
              <div className="rounded-xl border border-surface-border bg-surface-card divide-y divide-surface-border">
                {initialBatches.map((batch: any) => (
                  <div key={batch.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-muted/50 transition-colors">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                      <BookOpen className="h-5 w-5 text-brand-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">{batch.name}</p>
                      <p className="text-xs text-text-muted">{batch.schedule_type || batch.course?.name || '—'}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-muted" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="space-y-4">
            <AdminSection title="Payment Plans" actions={
              <button className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                <CreditCard className="h-4 w-4" />
                Add Payment
              </button>
            }>
              {!Array.isArray(initialPlans) || initialPlans.length === 0 ? (
                <AdminEmptyState icon={IndianRupee} title="No payment plans" description="No payment plans found for this student." />
              ) : (
                <div className="space-y-4">
                  {initialPlans.map((plan: any) => {
                    const paid = (plan.installments ?? []).filter((i: any) => i.status === 'paid').length;
                    const total = (plan.installments ?? []).length;
                    return (
                      <div key={plan.id} className="rounded-xl border border-surface-border bg-surface-card p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-semibold text-text-primary">{plan.course?.name || 'Course'} — {fmtCurrency(plan.total_amount)}</p>
                            <p className="text-xs text-text-muted">{paid}/{total} installments paid · {plan.status}</p>
                          </div>
                          <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium',
                            plan.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            plan.status === 'active' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            'bg-gray-100 text-gray-500 border-gray-200',
                          )}>{plan.status}</span>
                        </div>
                        {plan.installments && plan.installments.length > 0 && (
                          <div className="space-y-1.5">
                            {plan.installments.map((inst: any) => (
                              <div key={inst.id} className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-surface-muted">
                                <span>#{inst.installment_number} — {fmtCurrency(inst.amount)}</span>
                                <span className={cn('font-medium',
                                  inst.status === 'paid' ? 'text-emerald-600' :
                                  inst.status === 'overdue' ? 'text-red-600' :
                                  'text-text-muted',
                                )}>
                                  {inst.status}{inst.paid_at ? ` · ${fmtDate(inst.paid_at)}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </AdminSection>
          </div>
        )}

        {/* Assessments Tab */}
        {activeTab === 'assessments' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <AdminStatCard label="Tests Taken" value={initialAnalytics?.total_tests_taken ?? 0} icon={ClipboardList} iconColor="bg-brand-50 text-brand-600" />
              <AdminStatCard label="Average Score" value={initialAnalytics?.average_percentage ? `${initialAnalytics.average_percentage}%` : '—'} icon={Trophy} iconColor="bg-brand-50 text-brand-600" />
              <AdminStatCard label="Best Score" value={initialAnalytics?.best_percentage ? `${initialAnalytics.best_percentage}%` : '—'} icon={CheckCircle2} iconColor="bg-emerald-50 text-emerald-600" />
            </div>

            {initialAnalytics?.recent_trend && initialAnalytics.recent_trend.length > 0 && (
              <AdminSection title="Recent Performance">
                <div className="rounded-xl border border-surface-border bg-surface-card divide-y divide-surface-border">
                  {initialAnalytics.recent_trend.map((item: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3">
                      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', item.percentage >= 70 ? 'bg-emerald-50' : item.percentage >= 40 ? 'bg-amber-50' : 'bg-red-50')}>
                        <span className={cn('text-xs font-bold', item.percentage >= 70 ? 'text-emerald-600' : item.percentage >= 40 ? 'text-amber-600' : 'text-red-600')}>{item.percentage}%</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">{item.test_name || `Test ${i + 1}`}</p>
                        <p className="text-xs text-text-muted">{item.date ? fmtDate(item.date) : '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </AdminSection>
            )}

            {(!initialAnalytics || initialAnalytics.total_tests_taken === 0) && (
              <AdminEmptyState icon={ClipboardList} title="No assessments" description="This student has not taken any tests yet." />
            )}
          </div>
        )}

        {/* Certificates Tab */}
        {activeTab === 'certificates' && (
          <AdminEmptyState
            icon={Award}
            title="Certificates"
            description="Certificates issued on course completion will appear here. Admin certificate listing requires a backend endpoint for non-student users."
          />
        )}

        {/* Achievements Tab */}
        {activeTab === 'achievements' && (
          <AdminEmptyState
            icon={Trophy}
            title="Achievements"
            description="Student achievements and badges will appear here. Admin achievement listing requires a backend endpoint for non-student users."
          />
        )}

        {/* Communication Tab */}
        {activeTab === 'communication' && (
          <div className="space-y-4">
            <AdminSection title="Email Activity">
              <p className="text-sm text-text-muted">
                Email history, notifications, and announcements for this student. Use the{' '}
                <a href="/admin/email-logs" className="text-brand-600 underline">Email Center</a>{' '}
                to search by recipient: {student.email}
              </p>
            </AdminSection>
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            {initialAuditLogs.length === 0 ? (
              <AdminEmptyState icon={Activity} title="No activity" description="No audit log entries found for this student." />
            ) : (
              <AdminDataTable
                columns={activityColumns}
                data={initialAuditLogs}
                keyExtractor={(item) => item.id}
                showSearch={false}
                showPagination={false}
                pageSize={50}
              />
            )}
          </div>
        )}
      </div>

      {/* Assign Batch Modal */}
      <AssignBatchModal
        isOpen={showAssignModal}
        studentIds={[student.id]}
        currentBatches={initialBatches}
        studentLabel={student.name}
        onClose={() => setShowAssignModal(false)}
        onSuccess={() => setShowAssignModal(false)}
      />

      {/* Permanent delete step 1 — warning */}
      <ConfirmDialog isOpen={permStep1Open} variant="warning" title="Permanently Delete Student?" message={`${student.name} (${student.email}) will be permanently deleted: Auth account, profile, enrollments and progress will be removed and the email will become available for re-onboarding. Students with historical records cannot be deleted.`} confirmLabel="Continue" onConfirm={handlePermStep1Confirm} onCancel={() => setPermStep1Open(false)} />

      {/* Permanent delete step 2 — type email to confirm */}
      <Modal isOpen={permStep2Open} onClose={() => { setPermStep2Open(false); setConfirmEmailInput(''); setPermError(''); }} title="Confirm Permanent Deletion">
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">Type <span className="font-mono font-semibold text-text-primary">{student.email}</span> to confirm. This cannot be undone.</p>
          <input type="text" value={confirmEmailInput} onChange={e => { setConfirmEmailInput(e.target.value); setPermError(''); }} placeholder={student.email} className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" autoFocus />
          {permError && <p className="text-sm text-red-600 whitespace-pre-wrap">{permError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setPermStep2Open(false); setConfirmEmailInput(''); setPermError(''); }} disabled={permLoading} className="rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-50">Cancel</button>
            <button onClick={handlePermanentDelete} disabled={permLoading || confirmEmailInput.trim() !== student.email} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{permLoading ? 'Deleting…' : 'Permanently Delete'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
