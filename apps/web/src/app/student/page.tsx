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

export default async function StudentDashboardPage() {
  let courses: StudentCourse[] = [];
  let upcoming: LiveSession[] = [];
  let past: (LiveSession & { attendanceStatus?: string })[] = [];
  let recordings: StudentVideo[] = [];
  let results: unknown[] = [];
  let paymentPlans: PaymentPlan[] = [];
  let grouped: StudentBatchRecordings[] = [];
  let myTestsTotal = 0;
  let profileName: string | null = null;

  const [coursesResult, sessionsResult, recordingsResult, resultsResult, plansResult, groupedResult, testsResult, profileResult] = await Promise.all([
    getMyCourses().catch(() => [] as StudentCourse[]),
    getMySessions().catch(() => ({ upcoming: [], past: [] }) as { upcoming: LiveSession[]; past: (LiveSession & { attendanceStatus?: string })[] }),
    getMyVideos().catch(() => [] as StudentVideo[]),
    getMyResults().catch(() => [] as unknown[]),
    getMyPaymentPlans().catch(() => [] as PaymentPlan[]),
    getMyVideosGrouped().catch(() => [] as StudentBatchRecordings[]),
    getMyTests({ limit: 50 }).catch(() => ({ items: [], total: 0, page: 1, limit: 50 } as any)),
    getMyProfile().catch(() => null),
  ]);
  courses = coursesResult;
  upcoming = sessionsResult.upcoming ?? [];
  past = sessionsResult.past ?? [];
  recordings = recordingsResult;
  results = resultsResult;
  paymentPlans = plansResult;
  grouped = groupedResult as StudentBatchRecordings[];
  myTestsTotal = (testsResult as any)?.total ?? 0;
  profileName = (profileResult as any)?.name ?? null;

  const nextClass = upcoming.length > 0
    ? upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0]
    : null;

  const inProgressVideos = recordings.filter((r) => !r.progress.completed && r.progress.watched_seconds > 0);
  const continueContent = inProgressVideos.length > 0 ? inProgressVideos : recordings.slice(0, 6);

  const displayName = profileName || 'Trader';
  return (
    <DashboardClient
      name={displayName}
      nextClass={nextClass}
      upcoming={upcoming}
      continueContent={continueContent}
      courses={courses}
      recordings={recordings}
      results={results}
      pastSessions={past}
      paymentPlans={paymentPlans}
      grouped={grouped}
      myTestsTotal={myTestsTotal}
      myTests={((testsResult as any)?.items ?? []) as any[]}
    />
  );
}
