import { getAdminOverview } from '@/lib/api/analytics';
import { getReviewQueue } from '@/lib/api/assessments';
import { getEmailStats } from '@/lib/api/email-logs';
import { getObservabilityDashboard } from '@/lib/api/observability';
import { AdminDashboardClient } from './admin-dashboard-client';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  let overview = {
    studentCount: 0,
    totalRevenue: 0,
    activeCourses: 0,
    upcomingSessions: [] as { id: string; topic: string; startTime: string; durationMinutes: number }[],
  };
  let reviewQueue: unknown[] = [];
  let failedEmails = 0;
  let systemErrors = 0;
  let totalEmails = 0;

  try {
    const results = await Promise.allSettled([
      getAdminOverview(),
      getReviewQueue({ status: 'pending', limit: 5 }),
      getEmailStats().catch(() => null),
      getObservabilityDashboard().catch(() => null),
    ]);

    if (results[0].status === 'fulfilled') overview = results[0].value;
    if (results[1].status === 'fulfilled') {
      const queueResult = results[1].value as { items?: unknown[] } | unknown[];
      reviewQueue = Array.isArray(queueResult) ? queueResult : (queueResult?.items ?? []);
    }
    if (results[2].status === 'fulfilled' && results[2].value) {
      failedEmails = results[2].value.failed ?? 0;
      totalEmails = results[2].value.total ?? 0;
    }
    if (results[3].status === 'fulfilled' && results[3].value) {
      systemErrors = results[3].value.errorCountsLast24h ?? 0;
    }
  } catch {
    // APIs unavailable
  }

  const sessions = overview.upcomingSessions.slice(0, 5).map((s) => ({
    id: s.id,
    topic: s.topic,
    start_time: s.startTime,
    duration_minutes: s.durationMinutes,
    status: 'scheduled' as const,
  }));

  return (
    <AdminDashboardClient
      studentCount={overview.studentCount}
      totalRevenue={overview.totalRevenue}
      activeCourses={overview.activeCourses}
      upcomingSessions={sessions}
      reviewCount={reviewQueue.length}
      failedEmails={failedEmails}
      systemErrors={systemErrors}
      totalEmails={totalEmails}
    />
  );
}
