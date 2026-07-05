import { getMyCourses, type StudentCourse } from '@/lib/api/courses';
import { getMySessions, type LiveSession } from '@/lib/api/live-sessions';
import { getMyVideos, type StudentVideo } from '@/lib/api/videos';
import { getMyResults } from '@/lib/api/assessments';
import { getMyPaymentPlans, type PaymentPlan } from '@/lib/api/payments';
import { DashboardClient } from './dashboard-client';
import { ContinueWatching } from '@/components/student/ContinueWatching';
import { RecentlyWatched } from '@/components/student/RecentlyWatched';

export const dynamic = 'force-dynamic';

export default async function StudentDashboardPage() {
  let courses: StudentCourse[] = [];
  let upcoming: LiveSession[] = [];
  let past: (LiveSession & { attendanceStatus?: string })[] = [];
  let recordings: StudentVideo[] = [];
  let results: unknown[] = [];
  let paymentPlans: PaymentPlan[] = [];

  console.log('[DEBUG_DASHBOARD] Calling getMyVideos() — endpoint: GET /recordings/my');
  const [coursesResult, sessionsResult, recordingsResult, resultsResult, plansResult] = await Promise.all([
    getMyCourses().catch(() => [] as StudentCourse[]),
    getMySessions().catch(() => ({ upcoming: [], past: [] }) as { upcoming: LiveSession[]; past: (LiveSession & { attendanceStatus?: string })[] }),
    getMyVideos().catch(() => [] as StudentVideo[]),
    getMyResults().catch(() => [] as unknown[]),
    getMyPaymentPlans().catch(() => [] as PaymentPlan[]),
  ]);
  courses = coursesResult;
  upcoming = sessionsResult.upcoming ?? [];
  past = sessionsResult.past ?? [];
  recordings = recordingsResult;
  results = resultsResult;
  paymentPlans = plansResult;

  console.log(`[DEBUG_DASHBOARD] getMyVideos() returned ${recordings.length} recordings | sourceEndpoint=GET /recordings/my`);
  console.log(`[DEBUG_DASHBOARD] recordings array:`, JSON.stringify(recordings));

  const nextClass = upcoming.length > 0
    ? upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0]
    : null;

  const inProgressVideos = recordings.filter((r) => !r.progress.completed && r.progress.watched_seconds > 0);
  const continueContent = inProgressVideos.length > 0 ? inProgressVideos : recordings.slice(0, 6);
  console.log(`[DEBUG_DASHBOARD] videosCount=${recordings.length} | inProgress=${inProgressVideos.length} | continueContent=${continueContent.length}`);

  return (
    <>
      <ContinueWatching />
      <RecentlyWatched />
      <DashboardClient
        name="Trader"
        nextClass={nextClass}
        upcoming={upcoming}
        continueContent={continueContent}
        courses={courses}
        recordings={recordings}
        results={results}
        pastSessions={past}
        paymentPlans={paymentPlans}
      />
    </>
  );
}
