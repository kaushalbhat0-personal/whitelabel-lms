'use client';

import { useState, useCallback, useEffect, Component } from 'react';
import Link from 'next/link';
import {
  Users,
  Calendar,
  ClipboardList,
  IndianRupee,
  BarChart3,
  BookOpen,
  RefreshCw,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { AdminWorkspaceHeader } from '@/components/shared/AdminWorkspaceHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { AdminErrorState } from '@/components/shared/AdminErrorState';
import { CurriculumTab } from './curriculum-tab';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-currency';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';
import { fetchApi } from '@/lib/api-client';
import {
  type Batch,
  type StudentProfile,
  getBatchStudents,
  assignStudentsToBatch,
  removeStudentsFromBatch,
  addStudentToBatch,
} from '@/lib/api/courses';

class TabErrorBoundary extends Component<
  { children: React.ReactNode; onRetry?: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; onRetry?: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };
  render() {
    if (this.state.hasError) {
      return (
        <AdminErrorState
          message="Something went wrong while loading this tab."
          details={this.state.error?.message}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

interface BatchDetailViewProps {
  batch: Batch & {
    course?: { id: string; name: string };
    studentCount?: number;
    teacherCount?: number;
  };
}

type Tab = 'overview' | 'students' | 'curriculum' | 'sessions' | 'payments';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <BarChart3 className="h-4 w-4" /> },
  { key: 'students', label: 'Students', icon: <Users className="h-4 w-4" /> },
  { key: 'curriculum', label: 'Curriculum', icon: <ClipboardList className="h-4 w-4" /> },
  { key: 'sessions', label: 'Sessions', icon: <Calendar className="h-4 w-4" /> },
  { key: 'payments', label: 'Payments', icon: <IndianRupee className="h-4 w-4" /> },
];

export function BatchDetailView({ batch }: BatchDetailViewProps) {
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
    return d.toLocaleTimeString(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  };
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Students tab state
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentPage, setStudentPage] = useState(1);
  const [studentTotal, setStudentTotal] = useState(0);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [addStudentForm, setAddStudentForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [addingStudent, setAddingStudent] = useState(false);

  // Sessions tab state
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Payments tab state
  const [payments, setPayments] = useState<any[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  const loadStudents = useCallback(async () => {
    setLoadingStudents(true);
    try {
      const result = await getBatchStudents(batch.id, studentPage, 50);
      setStudents(result?.items ?? []);
      setStudentTotal(result?.total ?? 0);
    } catch { /* silent */ }
    finally { setLoadingStudents(false); }
  }, [batch.id, studentPage]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const result = await fetchApi<{ items: any[] }>(`/batches/${batch.id}/sessions`);
      setSessions(result.items ?? []);
    } catch {
      setSessions([]);
    }
    finally { setLoadingSessions(false); }
  }, [batch.id]);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const studentsData = await getBatchStudents(batch.id, 1, 100);
      const studentIds = (studentsData?.items ?? []).map((s: any) => s.id);
      if (studentIds.length === 0) { setPayments([]); setLoadingPayments(false); return; }
      const allPlans: any[] = [];
      for (const sid of studentIds.slice(0, 5)) {
        try {
          const plans = await fetchApi<any[]>('/payments/plans/student/' + sid);
          allPlans.push(...(plans ?? []));
        } catch { /* skip */ }
      }
      setPayments(allPlans);
    } catch {
      setPayments([]);
    }
    finally { setLoadingPayments(false); }
  }, [batch.id]);

  useEffect(() => {
    if (activeTab === 'students') loadStudents();
    if (activeTab === 'sessions') loadSessions();
    if (activeTab === 'payments') loadPayments();
  }, [activeTab, loadStudents, loadSessions, loadPayments]);

  const handleRemoveStudent = async (studentId: string) => {
    try {
      await removeStudentsFromBatch(batch.id, [studentId]);
      loadStudents();
    } catch { /* silent */ }
  };

  const handleAddStudent = async () => {
    if (!addStudentForm.email || !addStudentForm.firstName) return;
    setAddingStudent(true);
    try {
      await addStudentToBatch(batch.id, addStudentForm);
      setShowAddStudent(false);
      setAddStudentForm({ firstName: '', lastName: '', email: '', phone: '' });
      loadStudents();
    } catch { /* silent */ }
    finally { setAddingStudent(false); }
  };



  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <AdminWorkspaceHeader
        title={batch.name}
        subtitle={`${batch.schedule_type || 'No schedule'} batch`}
        backHref={batch.course?.id ? `/admin/courses/${batch.course.id}` : '/admin/batches'}
        badges={[
          { label: batch.is_active ? 'Active' : 'Inactive', variant: batch.is_active ? 'active' : 'inactive' },
        ]}
        context={[
          { label: 'Course', value: batch.course?.name ?? '—', href: batch.course?.id ? `/admin/courses/${batch.course.id}` : undefined },
          { label: 'Students', value: String(batch.studentCount ?? 0) },
          { label: 'Teachers', value: String(batch.teacherCount ?? 0) },
        ]}
        actions={
          <button onClick={() => { loadStudents(); }} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      {/* Tab Navigation */}
      <div className="border-b border-surface-border">
        <nav className="-mb-px flex gap-0" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:border-surface-border',
              )}
              role="tab"
              aria-selected={activeTab === tab.key}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <TabErrorBoundary onRetry={() => { if (activeTab === 'students') loadStudents(); if (activeTab === 'sessions') loadSessions(); if (activeTab === 'payments') loadPayments(); }}>
      <div role="tabpanel">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <AdminSection title="Stats at a Glance">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <AdminStatCard label="Students" value={batch.studentCount ?? 0} icon={Users} iconColor="bg-brand-50 text-brand-600" />
                <AdminStatCard label="Teachers" value={batch.teacherCount ?? 0} icon={BookOpen} iconColor="bg-blue-50 text-blue-600" />
                <AdminStatCard label="Schedule" value={batch.schedule_type || 'Not set'} sublabel={batch.start_date ? `Started ${fmtDate(batch.start_date)}` : undefined} icon={Calendar} iconColor="bg-purple-50 text-purple-600" />
              </div>
            </AdminSection>

            <AdminSection title="Course Context">
              {batch.course ? (
                <Link href={`/admin/courses/${batch.course.id}`} className="flex items-center gap-4 rounded-xl border border-surface-border bg-surface-card p-5 hover:border-brand-200 hover:shadow-card-hover transition-all">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
                    <BookOpen className="h-6 w-6 text-brand-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary">{batch.course.name}</p>
                    <p className="text-sm text-text-muted">View full course workspace</p>
                  </div>
                </Link>
              ) : (
                <p className="text-sm text-text-muted">No course linked.</p>
              )}
            </AdminSection>
          </div>
        )}

        {/* Students Tab */}
        {activeTab === 'students' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-muted">{studentTotal} students in this batch</p>
              <button onClick={() => setShowAddStudent(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                + Add Student
              </button>
            </div>

            {loadingStudents ? (
              <div className="rounded-xl border border-surface-border bg-surface-card p-12 text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-surface-border border-t-brand-500" />
                <p className="mt-3 text-sm text-text-muted">Loading students...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="rounded-xl border border-surface-border bg-surface-card p-12 text-center">
                <Users className="mx-auto h-10 w-10 text-text-muted" />
                <h3 className="mt-3 text-sm font-semibold text-text-primary">No students yet</h3>
                <p className="mt-1 text-sm text-text-muted">Add students to this batch to get started.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-surface-border bg-surface-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-muted">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-text-muted">Name</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-text-muted">Email</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {students.map((s) => (
                      <tr key={s.id} className="hover:bg-surface-muted/50">
                        <td className="px-5 py-3.5 font-medium text-text-primary">{s.name}</td>
                        <td className="px-5 py-3.5 text-text-secondary text-xs">{s.email}</td>
                        <td className="px-5 py-3.5 text-right">
                          <button onClick={() => handleRemoveStudent(s.id)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Curriculum Tab */}
        {activeTab === 'curriculum' && <CurriculumTab batchId={batch.id} />}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="space-y-4">
            {loadingSessions ? (
              <div className="rounded-xl border border-surface-border bg-surface-card p-12 text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-surface-border border-t-brand-500" />
                <p className="mt-3 text-sm text-text-muted">Loading sessions...</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-surface-border bg-surface-card p-12 text-center">
                <Calendar className="mx-auto h-10 w-10 text-text-muted" />
                <h3 className="mt-3 text-sm font-semibold text-text-primary">No sessions scheduled</h3>
                <p className="mt-1 text-sm text-text-muted">Live sessions linked to this batch will appear here.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-surface-border bg-surface-card divide-y divide-surface-border">
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-muted/50 transition-colors">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                      <Calendar className="h-5 w-5 text-brand-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{s.topic || s.zoom_webinar_id || 'Session'}</p>
                      <p className="text-xs text-text-muted">
                        {s.start_time ? fmtDate(s.start_time) + ' ' + fmtTime(s.start_time) : 'No time set'}
                        {s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}
                      </p>
                    </div>
                    <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', s.status === 'scheduled' ? 'bg-blue-50 text-blue-700 border-blue-200' : s.status === 'live' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-100 text-gray-500 border-gray-200')}>
                      {s.status ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="space-y-4">
            {loadingPayments ? (
              <div className="rounded-xl border border-surface-border bg-surface-card p-12 text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-surface-border border-t-brand-500" />
                <p className="mt-3 text-sm text-text-muted">Loading payment data...</p>
              </div>
            ) : payments.length === 0 ? (
              <div className="rounded-xl border border-surface-border bg-surface-card p-12 text-center">
                <IndianRupee className="mx-auto h-10 w-10 text-text-muted" />
                <h3 className="mt-3 text-sm font-semibold text-text-primary">No payment plans</h3>
                <p className="mt-1 text-sm text-text-muted">Payment plans for students in this batch will appear here.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-surface-border bg-surface-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-muted">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-text-muted">Student</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-text-muted">Amount</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {payments.map((p, i) => (
                      <tr key={p.id || i} className="hover:bg-surface-muted/50">
                        <td className="px-5 py-3.5 font-medium text-text-primary">{p.student_id || '—'}</td>
                        <td className="px-5 py-3.5 text-text-secondary text-xs">
                          {fmtCurrency(p.total_amount || 0)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', p.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : p.status === 'completed' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200')}>
                            {p.status ?? '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      </TabErrorBoundary>

      {/* Add Student Modal */}
      <Modal
        isOpen={showAddStudent}
        onClose={() => setShowAddStudent(false)}
        title="Add Student to Batch"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">First Name *</label>
              <input type="text" value={addStudentForm.firstName} onChange={(e) => setAddStudentForm({ ...addStudentForm, firstName: e.target.value })} className="input-field text-sm" placeholder="First name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Last Name</label>
              <input type="text" value={addStudentForm.lastName} onChange={(e) => setAddStudentForm({ ...addStudentForm, lastName: e.target.value })} className="input-field text-sm" placeholder="Last name" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Email *</label>
            <input type="email" value={addStudentForm.email} onChange={(e) => setAddStudentForm({ ...addStudentForm, email: e.target.value })} className="input-field text-sm" placeholder="student@email.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
            <input type="text" value={addStudentForm.phone} onChange={(e) => setAddStudentForm({ ...addStudentForm, phone: e.target.value })} className="input-field text-sm" placeholder="Phone number" />
          </div>
          <button
            onClick={handleAddStudent}
            disabled={addingStudent || !addStudentForm.email || !addStudentForm.firstName}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {addingStudent ? 'Adding...' : 'Add Student'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
