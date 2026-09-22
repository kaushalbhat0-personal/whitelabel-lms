import { getStudentCourse } from '@/lib/api/courses';
import { getMySessions } from '@/lib/api/live-sessions';
import { getMyVideosGrouped, type StudentBatchRecordings } from '@/lib/api/videos';
import { PageHeader } from '@/components/shared/PageHeader';
import { CourseDetailSessions } from './course-detail-sessions';
import { CourseDetailRecordings } from './course-detail-recordings';
import { CourseProgress } from '@/components/student/CourseProgress';
import { ContinueWatching } from '@/components/student/ContinueWatching';

export const dynamic = 'force-dynamic';

interface Props {
  params: { courseId: string };
}

export default async function StudentCourseDetailPage({ params }: Props) {
  try {
    const course = await getStudentCourse(params.courseId);
    const enrolledBatches = (course as any).enrolledBatches ?? [];

    if (enrolledBatches.length === 0) {
      return <AccessDenied />;
    }

    const batchIds = enrolledBatches.map((b: any) => b.id);

    const [sessionsResult, groupedRecordings] = await Promise.all([
      getMySessions(),
      getMyVideosGrouped(),
    ]);

    const allSessions = [
      ...(sessionsResult.upcoming ?? []),
      ...(sessionsResult.past ?? []),
    ];

    const now = new Date();
    const upcomingSessions = allSessions
      .filter((s) => s.status === 'scheduled' || s.status === 'live')
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
    const pastSessions = allSessions
      .filter((s) => s.status === 'ended' || s.status === 'cancelled')
      .sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      );

    const recordingsForCourse = groupedRecordings.filter((br) =>
      batchIds.includes(br.batchId),
    );

    const continueRecordings = (() => {
      const flat = recordingsForCourse.flatMap((br) => br.sections.flatMap((s) => s.recordings));
      const dedup = new Map<string, (typeof flat)[number]>();
      for (const rec of flat) {
        if (!dedup.has(rec.id)) dedup.set(rec.id, rec);
      }
      return [...dedup.values()];
    })();

    return (
      <div>
        <PageHeader title={course.name} showBack />
        <div className="space-y-6 px-4 md:px-0">
          <div className="rounded-card border border-surface-border bg-surface-card p-4">
            {course.description && (
              <p className="text-sm text-text-secondary">{course.description}</p>
            )}
            {enrolledBatches.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {enrolledBatches.map((b: any) => (
                  <span
                    key={b.id}
                    className="rounded-full bg-brand-navy/10 px-2.5 py-0.5 text-xs font-medium text-brand-navy"
                  >
                    {b.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <ContinueWatching recordings={continueRecordings as any} />

          <CourseProgress batchIds={batchIds} />

          <CourseDetailSessions
            upcoming={upcomingSessions}
            past={pastSessions}
          />

          {recordingsForCourse.length === 0 ? (
            <div className="rounded-card border border-surface-border bg-surface-card p-8 text-center">
              <p className="text-sm text-text-secondary">No recordings available yet for your batches.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recordingsForCourse.map((batch) => {
                const totalInBatch = batch.sections.reduce((acc, s) => acc + s.recordings.length, 0);
                return (
                  <section
                    key={batch.batchId}
                    aria-labelledby={`batch-${batch.batchId}`}
                    className="rounded-card border border-surface-border bg-surface-card p-4"
                  >
                    <h2 id={`batch-${batch.batchId}`} className="text-sm font-bold text-text-primary">
                      {batch.batchName}
                    </h2>
                    <p className="mt-1 text-xs text-text-muted">
                      {totalInBatch} recording{totalInBatch !== 1 ? 's' : ''} · {batch.sections.length} section{batch.sections.length !== 1 ? 's' : ''}
                    </p>
                    <div className="mt-4 space-y-4">
                      {batch.sections.map((section) => (
                        <div key={section.sectionName ?? '__uncategorized__'}>
                          {section.sectionName && (
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                              {section.sectionName}
                            </h3>
                          )}
                          <CourseDetailRecordings videos={section.recordings as any} hideHeader />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  } catch {
    return <ErrorState />;
  }
}

function AccessDenied() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-red-600">Access Denied</h2>
        <p className="mt-2 text-sm text-text-secondary">
          You are not assigned to an active batch for this course.
        </p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-text-primary">
          Failed to load course
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Please try refreshing the page or contact support.
        </p>
      </div>
    </div>
  );
}
