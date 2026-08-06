'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  IndianRupee,
  TrendingUp,
  Clock,
  AlertTriangle,
  FileText,
  Mail,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Users,
  CreditCard,
  RefreshCw,
  RotateCw,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminWorkspaceHeader } from '@/components/shared/AdminWorkspaceHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { AdminDataTable, type AdminDataTableColumn } from '@/components/shared/AdminDataTable';
import { AdminEmptyState } from '@/components/shared/AdminEmptyState';
import { AdminTableSkeleton } from '@/components/shared/AdminSkeletons';
import {
  type User,
  getStudents,
} from '@/lib/api/users';
import {
  type PaymentPlan,
  getStudentPlans,
  markInstallmentPaid,
} from '@/lib/api/payments';
import {
  type EmailLogStats,
  getEmailLogs,
  retryEmail,
} from '@/lib/api/email-logs';

interface FinanceWorkspaceProps {
  totalRevenue: number;
  studentCount: number;
  initialStudents: User[];
  initialEmailStats: EmailLogStats | null;
}

type Tab = 'overview' | 'collections' | 'payments' | 'invoices' | 'at-risk' | 'email';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'collections', label: 'Collections', icon: <IndianRupee className="h-4 w-4" /> },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="h-4 w-4" /> },
  { key: 'at-risk', label: 'At Risk', icon: <AlertTriangle className="h-4 w-4" /> },
  { key: 'invoices', label: 'Invoices', icon: <FileText className="h-4 w-4" /> },
  { key: 'email', label: 'Email & Delivery', icon: <Mail className="h-4 w-4" /> },
];

function formatCurrency(amt: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function FinanceWorkspace({
  totalRevenue,
  studentCount,
  initialStudents,
  initialEmailStats,
}: FinanceWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Collections state
  const [students, setStudents] = useState<User[]>(initialStudents);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentPlans, setStudentPlans] = useState<Map<string, PaymentPlan[]>>(new Map());
  const [plansLoading, setPlansLoading] = useState(false);

  // Email state
  const [emailRetrying, setEmailRetrying] = useState<Set<string>>(new Set());
  const [emailError, setEmailError] = useState('');

  const loadAllPlans = useCallback(async () => {
    if (students.length === 0) return;
    setPlansLoading(true);
    const map = new Map<string, PaymentPlan[]>();
    // Load in batches of 5 to avoid overwhelming the server
    for (let i = 0; i < Math.min(students.length, 20); i++) {
      try {
        const plans = await getStudentPlans(students[i].id);
        map.set(students[i].id, plans);
      } catch { /* skip */ }
    }
    setStudentPlans(map);
    setPlansLoading(false);
  }, [students]);

  useEffect(() => {
    if (activeTab === 'collections' || activeTab === 'at-risk') {
      if (studentPlans.size === 0) loadAllPlans();
    }
  }, [activeTab, studentPlans.size, loadAllPlans]);

  // Compute financial metrics from loaded plans
  const allPlans = Array.from(studentPlans.values()).flat();
  const allInstallments = allPlans.flatMap((p) => (p.installments ?? []).map((i) => ({ ...i, studentId: p.student_id, courseName: p.course?.name, planId: p.id })));

  const totalPending = allInstallments
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + (i.amount || 0), 0);

  const totalOverdue = allInstallments
    .filter((i) => i.status === 'overdue')
    .reduce((sum, i) => sum + (i.amount || 0), 0);

  const totalCollectedMonth = allInstallments
    .filter((i) => i.status === 'paid' && i.paid_at)
    .filter((i) => {
      const d = new Date(i.paid_at!);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, i) => sum + (i.amount || 0), 0);

  const studentsWithDues = new Set(allInstallments.filter((i) => i.status !== 'paid' && i.status !== 'waived').map((i) => i.studentId)).size;

  // At-risk students
  const atRiskStudents = students
    .filter((s) => studentPlans.has(s.id))
    .map((s) => {
      const plans = studentPlans.get(s.id) ?? [];
      const installments = plans.flatMap((p) => (p.installments ?? []).map((i) => ({ ...i, courseName: p.course?.name, planId: p.id })));
      const overdue = installments.filter((i) => i.status === 'overdue').length;
      const pending = installments.filter((i) => i.status === 'pending').length;
      const totalDue = installments.filter((i) => i.status !== 'paid').reduce((sum, i) => sum + (i.amount || 0), 0);
      const latePayments = installments.filter((i) => i.status === 'paid' && i.paid_at && new Date(i.paid_at) > new Date(i.due_date || '')).length;

      let risk: 'low' | 'medium' | 'high' = 'low';
      if (overdue > 0 || totalDue > 50000) risk = 'high';
      else if (pending > 2 || latePayments > 1) risk = 'medium';

      return { ...s, overdue, pending, totalDue, latePayments, risk };
    })
    .filter((s) => s.risk !== 'low')
    .sort((a, b) => b.totalDue - a.totalDue);

  const handleMarkPaid = async (installmentId: string) => {
    try {
      await markInstallmentPaid(installmentId, { paymentMethod: 'manual' });
      loadAllPlans();
    } catch { /* silent */ }
  };

  const handleRetryEmail = async (id: string) => {
    setEmailRetrying((prev) => new Set(prev).add(id));
    try {
      await retryEmail(id);
      setEmailError('Email retried successfully');
    } catch (err: any) {
      setEmailError(err.message || 'Retry failed');
    } finally {
      setEmailRetrying((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setTimeout(() => setEmailError(''), 4000);
    }
  };

  const collectionsColumns: AdminDataTableColumn<any>[] = [
    { key: 'student', header: 'Student', render: (item: any) => (
      <Link href={`/admin/students/${item.id}`} className="text-brand-600 hover:underline font-medium text-sm">{item.name}</Link>
    )},
    { key: 'email', header: 'Email', render: (item: any) => <span className="text-xs text-text-muted">{item.email}</span> },
    { key: 'course', header: 'Course', render: (item: any) => <span className="text-xs">{item.course || '—'}</span> },
    { key: 'amount', header: 'Due Amount', render: (item: any) => <span className="font-medium text-sm">{formatCurrency(item.amount)}</span> },
    { key: 'dueDate', header: 'Due Date', render: (item: any) => <span className="text-xs">{item.dueDate ? formatDate(item.dueDate) : '—'}</span> },
    { key: 'status', header: 'Status', render: (item: any) => (
      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
        item.status === 'overdue' ? 'bg-red-50 text-red-700 border-red-200' :
        item.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
        'bg-gray-100 text-gray-500 border-gray-200',
      )}>{item.status}</span>
    )},
    { key: 'actions', header: 'Actions', render: (item: any) => (
      <div className="flex items-center gap-1.5">
        {item.status !== 'paid' && item.installmentId && (
          <button onClick={() => handleMarkPaid(item.installmentId)} className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors">Pay</button>
        )}
        <Link href={`/admin/students/${item.studentId || item.id}`} className="rounded-lg px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    )},
  ];

  const atRiskColumns: AdminDataTableColumn<any>[] = [
    { key: 'student', header: 'Student', render: (item: any) => (
      <Link href={`/admin/students/${item.id}`} className="text-brand-600 hover:underline font-medium text-sm">{item.name}</Link>
    )},
    { key: 'email', header: 'Email', render: (item: any) => <span className="text-xs text-text-muted">{item.email}</span> },
    { key: 'totalDue', header: 'Total Due', render: (item: any) => <span className="font-medium text-sm">{formatCurrency(item.totalDue)}</span> },
    { key: 'overdue', header: 'Overdue', render: (item: any) => <span className="text-xs text-red-600 font-medium">{item.overdue}</span> },
    { key: 'pending', header: 'Pending', render: (item: any) => <span className="text-xs">{item.pending}</span> },
    { key: 'risk', header: 'Risk', render: (item: any) => (
      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
        item.risk === 'high' ? 'bg-red-50 text-red-700 border-red-200' :
        item.risk === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
        'bg-emerald-50 text-emerald-700 border-emerald-200',
      )}>{item.risk === 'high' ? 'High' : item.risk === 'medium' ? 'Medium' : 'Low'}</span>
    )},
    { key: 'actions', header: 'Actions', render: (item: any) => (
      <Link href={`/admin/students/${item.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors">
        View <ChevronRight className="h-3 w-3" />
      </Link>
    )},
  ];

  const collectionData = allInstallments
    .filter((i) => i.status !== 'paid' && i.status !== 'waived')
    .map((i) => ({
      id: `${i.studentId}-${i.planId}-${(i as any).installment_number}`,
      name: students.find((s) => s.id === i.studentId)?.name ?? i.studentId,
      email: students.find((s) => s.id === i.studentId)?.email ?? '',
      studentId: i.studentId,
      course: i.courseName || '—',
      amount: i.amount || 0,
      dueDate: (i as any).due_date,
      status: i.status,
      installmentId: (i as any).id,
    }))
    .slice(0, 50);

  return (
    <div className="space-y-6">
      <AdminWorkspaceHeader
        title="Finance Command Center"
        subtitle="Collections, payments, invoices, and revenue analytics"
        backHref="/admin"
        badges={[{ label: 'Finance', variant: 'info' }]}
        context={[
          { label: 'Total Revenue', value: formatCurrency(totalRevenue) },
          { label: 'Students', value: String(studentCount) },
        ]}
        actions={
          <button onClick={loadAllPlans} className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Data
          </button>
        }
      />

      {/* Tabs */}
      <div className="border-b border-surface-border">
        <nav className="-mb-px flex gap-0 overflow-x-auto" role="tablist">
          {TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cn('flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors', activeTab === tab.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-text-muted hover:text-text-secondary hover:border-surface-border')} role="tab" aria-selected={activeTab === tab.key}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div role="tabpanel">
        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <AdminSection title="Revenue KPIs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <AdminStatCard label="Total Revenue" value={formatCurrency(totalRevenue)} icon={IndianRupee} iconColor="bg-brand-50 text-brand-600" trend={totalRevenue > 0 ? { value: 12, positive: true } : undefined} />
                <AdminStatCard label="Collected This Month" value={plansLoading ? '...' : formatCurrency(totalCollectedMonth)} icon={TrendingUp} iconColor="bg-emerald-50 text-emerald-600" />
                <AdminStatCard label="Pending Amount" value={plansLoading ? '...' : formatCurrency(totalPending)} icon={Clock} iconColor="bg-amber-50 text-amber-600" />
                <AdminStatCard label="Overdue Amount" value={plansLoading ? '...' : formatCurrency(totalOverdue)} icon={AlertTriangle} iconColor={totalOverdue > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'} />
              </div>
            </AdminSection>

            <AdminSection title="Operational Overview">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <AdminStatCard label="Students With Dues" value={plansLoading ? '...' : String(studentsWithDues)} sublabel={studentCount > 0 ? `of ${studentCount} total` : undefined} icon={Users} iconColor={studentsWithDues > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'} />
                <AdminStatCard label="Email Status" value={initialEmailStats ? `${initialEmailStats.sent} sent / ${initialEmailStats.failed} failed` : '—'} icon={Mail} iconColor={(initialEmailStats?.failed ?? 0) > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'} />
                <AdminStatCard label="Total Payment Plans" value={plansLoading ? '...' : String(allPlans.length)} icon={CreditCard} iconColor="bg-blue-50 text-blue-600" />
                <AdminStatCard label="Active Students" value={String(studentCount)} icon={Users} iconColor="bg-brand-50 text-brand-600" />
              </div>
            </AdminSection>

            <AdminSection title="Quick Actions" description="Common finance operations">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  { label: 'Create Plan', href: '/admin/payments', icon: CreditCard, color: 'bg-brand-50 text-brand-600' },
                  { label: 'Bulk Invoice', href: '/admin/bulk-upload', icon: FileText, color: 'bg-blue-50 text-blue-600' },
                  { label: 'Student Ledger', href: '/admin/payments', icon: Users, color: 'bg-emerald-50 text-emerald-600' },
                  { label: 'Email Center', href: '/admin/email-logs', icon: Mail, color: 'bg-purple-50 text-purple-600' },
                  { label: 'Refresh Data', href: '#', icon: RefreshCw, color: 'bg-amber-50 text-amber-600', onClick: loadAllPlans },
                ].map((action) => (
                  action.href === '#' ? (
                    <button key={action.label} onClick={action.onClick} className="flex flex-col items-center gap-2 rounded-xl border border-surface-border bg-surface-card p-4 text-center hover:border-brand-200 hover:shadow-card-hover transition-all group">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.color}`}>
                        <action.icon className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-medium text-text-secondary group-hover:text-text-primary">{action.label}</span>
                    </button>
                  ) : (
                    <Link key={action.label} href={action.href} className="flex flex-col items-center gap-2 rounded-xl border border-surface-border bg-surface-card p-4 text-center hover:border-brand-200 hover:shadow-card-hover transition-all group">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.color}`}>
                        <action.icon className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-medium text-text-secondary group-hover:text-text-primary">{action.label}</span>
                    </Link>
                  )
                ))}
              </div>
            </AdminSection>
          </div>
        )}

        {/* Collections */}
        {activeTab === 'collections' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-muted">All pending and overdue installments across students</p>
              {plansLoading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-surface-border border-t-brand-500" />}
            </div>
            {plansLoading ? (
              <AdminTableSkeleton rows={5} cols={7} />
            ) : collectionData.length === 0 ? (
              <AdminEmptyState icon={CheckCircle2} title="All clear" description="No pending or overdue installments found." />
            ) : (
              <AdminDataTable columns={collectionsColumns} data={collectionData} keyExtractor={(i) => i.id} showSearch={true} searchPlaceholder="Search students..." searchKeys={['name', 'email', 'course']} exportCsv csvFilename="collections.csv" csvHeaders={['Student', 'Email', 'Course', 'Due Amount', 'Due Date', 'Status']} getCsvRow={(i) => [i.name, i.email, i.course, String(i.amount), i.dueDate || '', i.status]} showPagination={collectionData.length > 20} pageSize={20} total={collectionData.length} />
            )}
          </div>
        )}

        {/* Payments */}
        {activeTab === 'payments' && (
          <AdminSection title="Recent Payments">
            <AdminEmptyState icon={CreditCard} title="Payment Activity" description="Access individual student payment history from the Student Workspace." actionLabel="View Students" actionHref="/admin/students" />
          </AdminSection>
        )}

        {/* At Risk */}
        {activeTab === 'at-risk' && (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">Students with overdue installments, large pending balances, or repeated late payments</p>
            {plansLoading ? (
              <AdminTableSkeleton rows={5} cols={6} />
            ) : atRiskStudents.length === 0 ? (
              <AdminEmptyState icon={CheckCircle2} title="No at-risk students" description="All students with payment plans are in good standing." />
            ) : (
              <AdminDataTable columns={atRiskColumns} data={atRiskStudents} keyExtractor={(s) => s.id} showSearch={true} searchPlaceholder="Search by name or email..." searchKeys={['name', 'email']} showPagination={atRiskStudents.length > 15} pageSize={15} total={atRiskStudents.length} />
            )}
          </div>
        )}

        {/* Invoices */}
        {activeTab === 'invoices' && (
          <AdminSection title="Invoice Management">
            <AdminEmptyState icon={FileText} title="Invoices" description="Invoice generation happens through the payment flow. Use Bulk Upload to generate invoices en masse." actionLabel="Go to Bulk Upload" actionHref="/admin/bulk-upload" />
          </AdminSection>
        )}

        {/* Email & Delivery */}
        {activeTab === 'email' && (
          <div className="space-y-6">
            <AdminSection title="Email Delivery Stats">
              {initialEmailStats ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <AdminStatCard label="Invoices Sent" value={initialEmailStats.templateCounts?.invoice ?? 0} icon={Send} iconColor="bg-brand-50 text-brand-600" />
                  <AdminStatCard label="Receipts Sent" value={initialEmailStats.templateCounts?.receipt ?? 0} icon={Send} iconColor="bg-emerald-50 text-emerald-600" />
                  <AdminStatCard label="Failed Emails" value={initialEmailStats.failed} icon={XCircle} iconColor={initialEmailStats.failed > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'} />
                  <AdminStatCard label="Total Emails" value={initialEmailStats.total} icon={Mail} iconColor="bg-blue-50 text-blue-600" />
                </div>
              ) : (
                <p className="text-sm text-text-muted">Email stats unavailable</p>
              )}
            </AdminSection>

            {emailError && (
              <div className={cn('rounded-xl border p-4 text-sm', emailError.includes('success') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>
                {emailError}
              </div>
            )}

            <AdminSection title="Quick Access">
              <Link href="/admin/email-logs" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                <Mail className="h-4 w-4" />
                Open Email Center
              </Link>
            </AdminSection>
          </div>
        )}
      </div>
    </div>
  );
}
