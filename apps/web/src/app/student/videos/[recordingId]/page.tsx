import { getVideoMeta } from '@/lib/api/videos';
import { PageHeader } from '@/components/shared/PageHeader';
import { VideoPlayerClient } from './video-player-client';

export const dynamic = 'force-dynamic';

interface Props {
  params: { recordingId: string };
}

export default async function StudentVideoPlayerPage({ params }: Props) {
  let videoTitle = '';
  let videoCreatedAt: string | null = null;

  try {
    const video = await getVideoMeta(params.recordingId);
    if (video) {
      videoTitle = video.title;
      videoCreatedAt = video.created_at ?? null;
    }
  } catch {
    // Metadata unavailable — player will still work
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <PageHeader title={videoTitle || 'Recording'} showBack />
      <div className="md:px-0 min-w-0 max-w-full overflow-hidden">
        <VideoPlayerClient
          recordingId={params.recordingId}
          sessionId=""
          title={videoTitle}
          createdAt={videoCreatedAt}
        />
      </div>
    </div>
  );
}
