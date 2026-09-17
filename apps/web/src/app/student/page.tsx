import { redirect } from 'next/navigation';
import { getMyDashboardCourses, type StudentCourse } from '@/lib/api/courses';
import { getMyDashboardSessions, type LiveSession } from '@/lib/api/live-sessions';
import { getMyDashboardRecordings, type StudentVideo, type StudentBatchRecordings } from '@/lib/api/videos';
import { getMyDashboardTests, getMyDashboardResults } from '@/lib/api/assessments';
import { getMyPaymentPlans, type PaymentPlan } from '@/lib/api/payments';
import { DashboardClient } from './dashboard-client';

export const dynamic = 'force-dynamic';

function isUnauthorized(err: unknown): boolean {
  const status = (err as any)?.status;
  const name = (err as any)?.name;
  const code = (err as any)?.data?.code ?? (err as any)?.code;
  return status === 401 || name === 'UnauthorizedError' || code === 'SESSION_REPLACED';
}

export default async function StudentDashboardPage() {
  const settled = await Promise.allSettled([
    getMyDashboardCourses(),
    getMyDashboardSessions(),
    getMyDashboardRecordings(),
    getMyDashboardResults(),
    getMyPaymentPlans(),
    getMyDashboardTests(),
  ]);

  // If any is 401, redirect to login (preserve Phase 21/24 session behavior)
  for (const r of settled) {
    if (r.status === 'rejected' && isUnauthorized(r.reason)) {
      redirect('/login');
    }
  }

  const dashboardCoursesResult = settled[0].status === 'fulfilled' ? (settled[0].value as { courses: StudentCourse[]; name: string | null }) : { courses: [], name: null };
  const coursesResult = dashboardCoursesResult.courses ?? [];
  const sessionsResult = settled[1].status === 'fulfilled' ? (settled[1].value as { upcoming: LiveSession[]; past: (LiveSession & { attendanceStatus?: string })[] }) : { upcoming: [], past: [] };
  const recordingsDashboardResult = settled[2].status === 'fulfilled' ? (settled[2].value as { flat: StudentVideo[]; grouped: StudentBatchRecordings[] }) : { flat: [], grouped: [] };
  const resultsDashboardResult = settled[3].status === 'fulfilled' ? (settled[3].value as { items: unknown[]; total: number; page: number; limit: number }) : { items: [], total: 0, page: 1, limit: 5 };
  const plansResult = settled[4].status === 'fulfilled' ? (settled[4].value as PaymentPlan[]) : [];
  const testsDashboardResult = settled[5].status === 'fulfilled' ? (settled[5].value as { items: any[]; total: number; page: number; limit: number }) : { items: [], total: 0, page: 1, limit: 50 };

  const errors = {
    courses: settled[0].status === 'rejected' ? 'Failed to load courses' : null,
    sessions: settled[1].status === 'rejected' ? 'Failed to load live sessions' : null,
    recordings: settled[2].status === 'rejected' ? 'Failed to load recordings' : null,
    results: settled[3].status === 'rejected' ? 'Failed to load results' : null,
    payments: settled[4].status === 'rejected' ? 'Failed to load payments' : null,
    grouped: settled[2].status === 'rejected' ? 'Failed to load learning journey' : null,
    tests: settled[5].status === 'rejected' ? 'Failed to load tests' : null,
  };

  const courses = coursesResult;
  const upcoming = sessionsResult.upcoming ?? [];
  const past = sessionsResult.past ?? [];
  const recordings = recordingsDashboardResult.flat ?? [];
  const results = (resultsDashboardResult as any)?.items ?? [];
  const paymentPlans = plansResult;
  const grouped = (recordingsDashboardResult.grouped ?? []) as StudentBatchRecordings[];
  const myTestsTotal = (testsDashboardResult as any)?.total ?? 0;

  const nextClass = upcoming.length > 0
    ? upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0]
    : null;

  const rawName = (dashboardCoursesResult as any)?.name ?? null;
  const displayName = rawName && String(rawName).trim() ? String(rawName).trim().split(' ')[0] : 'Trader';
  return (
    <DashboardClient
      name={displayName}
      nextClass={nextClass}
      upcoming={upcoming}
      courses={courses}
      recordings={recordings}
      results={results}
      pastSessions={past}
      paymentPlans={paymentPlans}
      grouped={grouped}
      myTestsTotal={myTestsTotal}
      myTests={((testsDashboardResult as any)?.items ?? []) as any[]}
      errors={errors}
    />
  );
}
