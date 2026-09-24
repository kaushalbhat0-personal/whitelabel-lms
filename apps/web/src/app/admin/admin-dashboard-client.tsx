'use client';

import Link from 'next/link';
import {
  Users,
  BookOpen,
  IndianRupee,
  Calendar,
  Clock,
  FileText,
  Video,
  UserPlus,
  ChevronRight,
  ClipboardCheck,
  Settings,
  TrendingUp,
  TrendingDown,
  Mail,
  AlertTriangle,
  Megaphone,
  Gauge,
  GraduationCap,
  Pencil,
  Monitor,
  ShieldAlert,
} from 'lucide-react';
import { ROUTES } from '@/lib/constants';
import { formatCurrency } from '@/lib/format-currency';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { Badge } from '@/components/ui/Badge';

interface AdminDashboardClientProps {
  studentCount: number;
  totalRevenue: number;
  activeCourses: number;
  upcomingSessions: { id: string; topic: string; start_time: string; duration_minutes: number; status?: string }[];
  reviewCount: number;
  failedEmails: number;
  systemErrors: number;
  totalEmails: number;
}



const quickActions = [
  { label: 'Create Course', href: ROUTES.ADMIN.COURSES, icon: BookOpen, color: 'bg-blue-50 text-blue-600' },
  { label: 'Add Student', href: ROUTES.ADMIN.STUDENTS, icon: Users, color: 'bg-emerald-50 text-emerald-600' },
  { label: 'Create Test', href: ROUTES.ADMIN.TESTS_NEW, icon: FileText, color: 'bg-purple-50 text-purple-600' },
  { label: 'Upload Recording', href: ROUTES.ADMIN.RECORDINGS, icon: Video, color: 'bg-amber-50 text-amber-600' },
  { label: 'New Announcement', href: ROUTES.ADMIN.ANNOUNCEMENTS, icon: Megaphone, color: 'bg-pink-50 text-pink-600' },
  { label: 'Business Config', href: ROUTES.ADMIN.BUSINESS_CONFIG, icon: Settings, color: 'bg-gray-50 text-gray-600' },
];

export function AdminDashboardClient({
  studentCount,
  totalRevenue,
  activeCourses,
  upcomingSessions,
  reviewCount,
  failedEmails,
  systemErrors,
  totalEmails,
}: AdminDashboardClientProps) {
  const { currency, locale, timezone } = useBusinessConfig();
  const fmtCurrency = (amount: number) => formatCurrency(amount, currency, locale, { maximumFractionDigits: 0 });
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(locale, { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' });
  };
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  };
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">Welcome back. Here&apos;s what&apos;s happening across your platform.</p>
      </div>

      {/* ── Students + Revenue ── */}
      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStatCard
            label="Total Students"
            value={studentCount.toLocaleString(locale)}
            sublabel="Active enrolled learners"
            icon={Users}
            iconColor="bg-brand-50 text-brand-600"
          />
          <AdminStatCard
            label="Active Courses"
            value={activeCourses}
            sublabel="Running batches"
            icon={GraduationCap}
            iconColor="bg-blue-50 text-blue-600"
          />
          <AdminStatCard
            label="Total Revenue"
            value={fmtCurrency(totalRevenue)}
            sublabel="Lifetime earnings"
            icon={IndianRupee}
            iconColor="bg-emerald-50 text-emerald-600"
          />
          <AdminStatCard
            label="Upcoming Sessions"
            value={upcomingSessions.length}
            sublabel="Next 7 days"
            icon={Calendar}
            iconColor="bg-purple-50 text-purple-600"
          />
        </div>
      </AdminSection>

      {/* ── Learning + Operations ── */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <AdminSection title="Learning">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AdminStatCard
              label="Pending Reviews"
              value={reviewCount}
              sublabel={reviewCount > 0 ? 'Awaiting evaluation' : 'All clear'}
              icon={ClipboardCheck}
              iconColor={reviewCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}
              onClick={() => window.location.href = ROUTES.ADMIN.REVIEW_QUEUE}
            />
          </div>
        </AdminSection>

        <AdminSection title="Operations">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AdminStatCard
              label="Failed Emails"
              value={failedEmails}
              sublabel={totalEmails > 0 ? `${totalEmails} total emails sent` : 'No data'}
              icon={Mail}
              iconColor={failedEmails > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}
              onClick={() => window.location.href = ROUTES.ADMIN.EMAIL_LOGS}
            />
            <AdminStatCard
              label="System Errors (24h)"
              value={systemErrors}
              sublabel={systemErrors > 0 ? 'Needs attention' : 'All systems healthy'}
              icon={AlertTriangle}
              iconColor={systemErrors > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}
              onClick={() => window.location.href = ROUTES.ADMIN.MONITORING}
            />
          </div>
        </AdminSection>
      </div>

      {/* ── Upcoming Sessions ── */}
      <AdminSection title="Upcoming Sessions" actions={
        <Link href={ROUTES.ADMIN.SESSIONS} className="text-xs font-medium text-brand-600 hover:text-brand-700">
          View all
        </Link>
      }>
        {upcomingSessions.length > 0 ? (
          <div className="rounded-xl border border-surface-border bg-surface-card divide-y divide-surface-border">
            {upcomingSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-4 px-5 py-3.5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Calendar className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{session.topic}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-2xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {fmtDate(session.start_time)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {fmtTime(session.start_time)}
                    </span>
                    <span>{session.duration_minutes} min</span>
                  </div>
                </div>
                <Badge
                  variant={
                    session.status === 'live' ? 'error' :
                    session.status === 'scheduled' ? 'info' : 'neutral'
                  }
                  size="sm"
                >
                  {session.status === 'live' ? 'LIVE' : session.status === 'scheduled' ? 'Scheduled' : 'Upcoming'}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-surface-border bg-surface-card py-10 text-center">
            <Calendar className="mx-auto h-8 w-8 text-text-muted" />
            <p className="mt-2 text-sm text-text-secondary">No upcoming sessions scheduled</p>
            <Link href={ROUTES.ADMIN.SESSIONS} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              Schedule a session <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </AdminSection>

      {/* ── Quick Actions ── */}
      <AdminSection title="Quick Actions">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((action) => (
            <Link key={action.label} href={action.href}>
              <div className="flex flex-col items-center gap-2 rounded-xl border border-surface-border bg-surface-card p-4 text-center transition-all duration-200 hover:border-brand-200 hover:shadow-card-hover group">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.color}`}>
                  <action.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium text-text-secondary group-hover:text-text-primary">{action.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </AdminSection>

      {/* ── Pending Reviews Alert ── */}
      {reviewCount > 0 && (
        <Link href={ROUTES.ADMIN.REVIEW_QUEUE}>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 flex items-center justify-between hover:shadow-card-hover transition-all duration-200 group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100">
                <ClipboardCheck className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Pending Reviews</h3>
                <p className="text-sm text-text-secondary">
                  {reviewCount} test{reviewCount > 1 ? 's' : ''} awaiting evaluation
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-amber-200 px-2 text-sm font-bold text-amber-700">
                {reviewCount}
              </span>
              <ChevronRight className="h-5 w-5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </Link>
      )}

      {/* ── System Health ── */}
      {systemErrors > 0 && (
        <Link href={ROUTES.ADMIN.MONITORING}>
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 flex items-center justify-between hover:shadow-card-hover transition-all duration-200 group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
                <ShieldAlert className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">System Needs Attention</h3>
                <p className="text-sm text-text-secondary">
                  {systemErrors} error{systemErrors > 1 ? 's' : ''} in the last 24 hours
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      )}
    </div>
  );
}
