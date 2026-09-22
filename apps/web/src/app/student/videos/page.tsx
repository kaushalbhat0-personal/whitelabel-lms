import { getMyVideosGrouped, getMyVideos, type StudentBatchRecordings, type StudentVideo } from '@/lib/api/videos';
import { PageHeader } from '@/components/shared/PageHeader';
import { StudentVideosGrouped } from './student-videos-grouped';
import { RecordingsList } from './recordings-list';
import { StudentVideoSearch } from './student-videos-search';
import { EmptyState } from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export default async function StudentVideosPage({
  searchParams,
}: {
  searchParams?: { search?: string };
}) {
  const search = searchParams?.search?.trim() || undefined;
  let groupedData: StudentBatchRecordings[] = [];
  let flatRecordings: StudentVideo[] = [];
  let groupedFailed = false;

  try {
    groupedData = await getMyVideosGrouped(search);
  } catch {
    groupedFailed = true;
    // Fallback to flat list
    try {
      flatRecordings = await getMyVideos(undefined, search);
    } catch {}
  }

  // No results for search — dedicated empty state
  if (search && groupedData.length === 0 && flatRecordings.length === 0) {
    return (
      <div>
        <PageHeader title="Recordings" subtitle={`Search: “${search}”`} />
        <div className="px-4 md:px-0 space-y-4">
          <StudentVideoSearch />
          <EmptyState
            title={`No recordings match “${search}”`}
            description="Try a different search or clear your search."
            action={
              <a
                href="/student/videos"
                className="inline-flex items-center justify-center rounded-xl bg-surface-muted px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-border min-h-[44px]"
              >
                Clear search
              </a>
            }
          />
        </div>
      </div>
    );
  }

  if (groupedData.length > 0) {
    return (
      <div>
        <PageHeader title="Recordings" subtitle="Organized by batch and section" />
        <div className="space-y-4 px-4 md:px-0">
          <StudentVideoSearch />
          <div className="space-y-8">
            <StudentVideosGrouped data={groupedData} />
          </div>
        </div>
      </div>
    );
  }

  const total = flatRecordings.length;
  const showFallbackNotice = groupedFailed && total > 0;
  return (
    <div>
      <PageHeader
        title="Recordings"
        subtitle={search ? `Search: “${search}” · ${total} result${total !== 1 ? 's' : ''}` : `${total} recording${total !== 1 ? 's' : ''}`}
      />
      <div className="px-4 md:px-0 space-y-4">
        <StudentVideoSearch />
        {showFallbackNotice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800" role="status">
            Grouped view temporarily unavailable — showing all recordings. Browse and search still work.
          </div>
        )}
        {search && total === 0 ? (
          <EmptyState
            title={`No recordings match “${search}”`}
            description="Try a different search or clear your search."
            action={
              <a
                href="/student/videos"
                className="inline-flex items-center justify-center rounded-xl bg-surface-muted px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-border min-h-[44px]"
              >
                Clear search
              </a>
            }
          />
        ) : (
          <RecordingsList recordings={flatRecordings} />
        )}
      </div>
    </div>
  );
}
