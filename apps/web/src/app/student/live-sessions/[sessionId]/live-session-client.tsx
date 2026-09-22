'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { ZoomWebinarPlayer } from '@/components/student/zoom-webinar-player';
import { WatermarkOverlay } from '@/components/shared/WatermarkOverlay';
import { ScreenRecordingDetector } from '@/components/shared/ScreenRecordingDetector';
import { getSessionJoinUrl, requestJoinToken } from '@/lib/api/live-sessions';
import type { LiveSessionWithDetails } from '@/lib/api/live-sessions';

interface Props {
  session: LiveSessionWithDetails;
}

export function LiveSessionClient({ session }: Props) {
  const user = useAuthStore((s) => s.user);
  const [liveSessionId] = useState(() => crypto.randomUUID());
  const [tokenValidated, setTokenValidated] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  const isLive = session.status === 'live';

  useEffect(() => {
    if (!session.zoom_webinar_id || !isLive) return;
    let cancelled = false;
    requestJoinToken(session.id).then(() => {
      if (!cancelled) setTokenValidated(true);
    }).catch(() => {
      if (!cancelled) setTokenError(true);
    });
    return () => { cancelled = true; };
  }, [session.id, session.zoom_webinar_id, isLive]);

  if (session.zoom_webinar_id && isLive) {
    if (tokenError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-red-300 py-16 text-red-500">
          <p className="text-lg font-medium">Unable to verify access</p>
          <p className="mt-1 text-sm">You may not be registered for this session.</p>
        </div>
      );
    }

    return (
      <div className="relative mx-auto max-w-4xl">
        <ScreenRecordingDetector
          contextType="live_session"
          contextId={session.id}
        >
          {tokenValidated ? (
            <ZoomWebinarPlayer
              meetingNumber={session.zoom_webinar_id}
              password={undefined}
              userName={user?.name || user?.email || 'Student'}
              userEmail={user?.email}
            />
          ) : (
            <div className="flex items-center justify-center rounded-xl bg-gray-900 py-24 text-white">
              <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
            </div>
          )}
        </ScreenRecordingDetector>
        <WatermarkOverlay sessionId={liveSessionId} />
      </div>
    );
  }

  return <SessionJoinFallback session={session} />;
}

function SessionJoinFallback({ session }: { session: LiveSessionWithDetails }) {
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [liveSessionId] = useState(() => crypto.randomUUID());

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    const win = window.open('about:blank', '_blank');
    try {
      const { token } = await requestJoinToken(session.id);
      const { joinUrl } = await getSessionJoinUrl(session.id, token);
      if (!joinUrl || !joinUrl.includes('zoom.us')) throw new Error('Invalid join URL');
      if (win && !win.closed) {
        win.location.href = joinUrl;
        win.focus();
      } else {
        window.location.href = joinUrl;
      }
    } catch (err: any) {
      if (win && !win.closed) win.close();
      setJoinError(err?.message || 'Unable to join. Please try again.');
      setJoining(false);
      return;
    }
    setJoining(false);
  };

  const isUpcoming = session.status === 'scheduled' || session.status === 'live';

  if (!isUpcoming) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-16 text-gray-500">
        <p className="text-lg font-medium">Session has ended</p>
        <p className="mt-1 text-sm">This session is no longer available.</p>
      </div>
    );
  }

  return (
    <ScreenRecordingDetector
      contextType="live_session"
      contextId={session.id}
    >
      <div className="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-16 text-gray-500">
        <p className="text-lg font-medium">{session.topic}</p>
        <p className="mt-1 text-sm">
          {new Date(session.start_time).toLocaleString('en-IN')}
        </p>
        {session.matchingBatches && session.matchingBatches.length > 0 && (
          <p
            className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs font-medium text-text-secondary"
            aria-label={`${session.matchingBatches.length === 1 ? 'Batch' : 'Batches'}: ${session.matchingBatches.map((b) => b.name).join(', ')}`}
          >
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {session.matchingBatches.length === 1 ? 'Batch' : 'Batches'}: {session.matchingBatches.map((b) => b.name).join(', ')}
            </span>
          </p>
        )}
        <div className="mb-6 mt-2" />
        <button
          onClick={handleJoin}
          disabled={joining}
          aria-label={joining ? 'Joining session' : `Join ${session.topic}`}
          className="flex min-h-[44px] min-w-[160px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none transition-colors"
        >
          {joining ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="h-4 w-4" />
          )}
          {joining ? 'Opening Zoom...' : 'Join on Zoom'}
        </button>
        {joinError && <div className="mt-3 text-center"><p className="text-sm font-medium text-red-600" role="alert">{joinError}</p><button onClick={handleJoin} className="mt-2 text-sm font-semibold text-brand-600 underline hover:text-brand-700">Retry</button></div>}
        <div className="pointer-events-none absolute inset-0 select-none overflow-hidden rounded-xl">
          <WatermarkOverlay sessionId={liveSessionId} />
        </div>
      </div>
    </ScreenRecordingDetector>
  );
}
