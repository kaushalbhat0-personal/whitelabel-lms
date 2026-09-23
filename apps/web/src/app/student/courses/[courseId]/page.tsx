import { getStudentCourse } from '@/lib/api/courses';
import { getMyVideosGrouped } from '@/lib/api/videos';
import { PageHeader } from '@/components/shared/PageHeader';
import { CourseProgress } from '@/components/student/CourseProgress';
import { ContinueWatching } from '@/components/student/ContinueWatching';
import { CollapsibleBatchList } from './collapsible-batch-list';

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

    const groupedRecordings = await getMyVideosGrouped();

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
                    className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
                  >
                    {b.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <ContinueWatching recordings={continueRecordings as any} />

          <CourseProgress batchIds={batchIds} />

          <CollapsibleBatchList batches={recordingsForCourse} />
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
