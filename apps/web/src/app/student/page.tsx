import { redirect } from 'next/navigation';
import { getMyCourses, type StudentCourse } from '@/lib/api/courses';
import { getMySessions, type LiveSession } from '@/lib/api/live-sessions';
import { getMyVideos, type StudentVideo, type StudentBatchRecordings, getMyVideosGrouped } from '@/lib/api/videos';
import { getMyResults, getMyTests } from '@/lib/api/assessments';
import { getMyPaymentPlans, type PaymentPlan } from '@/lib/api/payments';
import { fetchApi } from '@/lib/api-client';
import { DashboardClient } from './dashboard-client';

export const dynamic = 'force-dynamic';

async function getMyProfile(): Promise<{ name: string; email: string } | null> {
  try {
    const p = await fetchApi<{ name: string; email: string }>('/auth/me');
    return p;
  } catch {
    return null;
  }
}

function isUnauthorized(err: unknown): boolean {
  const status = (err as any)?.status;
  const name = (err as any)?.name;
  const code = (err as any)?.data?.code ?? (err as any)?.code;
  return status === 401 || name === 'UnauthorizedError' || code === 'SESSION_REPLACED';
}

export default async function StudentDashboardPage() {
  const settled = await Promise.allSettled([
    getMyCourses(),
    getMySessions(),
    getMyVideos(),
    getMyResults(),
    getMyPaymentPlans(),
    getMyVideosGrouped(),
    getMyTests({ limit: 50 }),
    getMyProfile(),
  ]);

  // If any is 401, redirect to login (preserve Phase 21/24 session behavior)
  for (const r of settled) {
    if (r.status === 'rejected' && isUnauthorized(r.reason)) {
      redirect('/login');
    }
  }

  const coursesResult = settled[0].status === 'fulfilled' ? (settled[0].value as StudentCourse[]) : [];
  const sessionsResult = settled[1].status === 'fulfilled' ? (settled[1].value as { upcoming: LiveSession[]; past: (LiveSession & { attendanceStatus?: string })[] }) : { upcoming: [], past: [] };
  const recordingsResult = settled[2].status === 'fulfilled' ? (settled[2].value as StudentVideo[]) : [];
  const resultsResult = settled[3].status === 'fulfilled' ? (settled[3].value as unknown[]) : [];
  const plansResult = settled[4].status === 'fulfilled' ? (settled[4].value as PaymentPlan[]) : [];
  const groupedResult = settled[5].status === 'fulfilled' ? (settled[5].value as StudentBatchRecordings[]) : [];
  const testsResult = settled[6].status === 'fulfilled' ? (settled[6].value as any) : { items: [], total: 0, page: 1, limit: 50 };
  const profileResult = settled[7].status === 'fulfilled' ? settled[7].value : null;

  const errors = {
    courses: settled[0].status === 'rejected' ? 'Failed to load courses' : null,
    sessions: settled[1].status === 'rejected' ? 'Failed to load live sessions' : null,
    recordings: settled[2].status === 'rejected' ? 'Failed to load recordings' : null,
    results: settled[3].status === 'rejected' ? 'Failed to load results' : null,
    payments: settled[4].status === 'rejected' ? 'Failed to load payments' : null,
    grouped: settled[5].status === 'rejected' ? 'Failed to load learning journey' : null,
    tests: settled[6].status === 'rejected' ? 'Failed to load tests' : null,
  };

  const courses = coursesResult;
  const upcoming = sessionsResult.upcoming ?? [];
  const past = sessionsResult.past ?? [];
  const recordings = recordingsResult;
  const results = resultsResult;
  const paymentPlans = plansResult;
  const grouped = groupedResult as StudentBatchRecordings[];
  const myTestsTotal = (testsResult as any)?.total ?? 0;
  const profileName = (profileResult as any)?.name ?? null;

  const nextClass = upcoming.length > 0
    ? upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0]
    : null;

  const displayName = profileName || 'Trader';
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
      myTests={((testsResult as any)?.items ?? []) as any[]}
      errors={errors}
    />
  );
}
