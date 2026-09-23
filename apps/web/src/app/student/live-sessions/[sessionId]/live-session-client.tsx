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
            <div
              className="flex flex-col items-center justify-center rounded-xl border bg-gray-900 text-white"
              style={{ height: '600px' }}
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <Loader2 className="mb-3 h-8 w-8 motion-safe:animate-spin text-brand-400" aria-hidden="true" />
              <p className="text-sm font-medium">Preparing Zoom…</p>
              <p className="mt-1 text-xs text-gray-400">Checking access</p>
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
    // Preserve popup-safe synchronous open, but immediately give feedback in the new tab to avoid white flash
    const win = window.open('about:blank', '_blank');
    if (win) {
      try {
        win.document.write(
          '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening Zoom…</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;color:#111827} .card{padding:24px;border-radius:16px;background:white;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center;max-width:320px} .spinner{width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:#059669;border-radius:9999px;animation:spin 0.8s linear infinite;margin:0 auto 12px}@keyframes spin{to{transform:rotate(360deg)}} p{margin:4px 0;font-size:14px} .muted{color:#6b7280;font-size:12px}</style></head><body><div class="card" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"></div><p><strong>Opening Zoom…</strong></p><p class="muted">Preparing your session. This tab will redirect automatically.</p></div></body></html>',
        );
        win.document.close();
      } catch {
        // cross-origin write may fail — ignore, tab will still redirect
      }
    }
    try {
      const { token } = await requestJoinToken(session.id);
      const { joinUrl } = await getSessionJoinUrl(session.id, token);
      if (!joinUrl || !joinUrl.includes('zoom.us')) throw new Error('Invalid join URL');
      if (win && !win.closed) {
        win.location.href = joinUrl;
        try {
          win.focus();
        } catch {}
      } else {
        window.location.href = joinUrl;
      }
    } catch (err: any) {
      if (win && !win.closed) {
        try {
          win.close();
        } catch {}
      }
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
          aria-busy={joining}
          aria-label={joining ? 'Preparing Zoom session' : `Join ${session.topic}`}
          className="flex min-h-[44px] min-w-[160px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none transition-colors"
        >
          {joining ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          )}
          {joining ? 'Preparing Zoom…' : 'Join on Zoom'}
        </button>
        {joinError && <div className="mt-3 text-center"><p className="text-sm font-medium text-red-600" role="alert">{joinError}</p><button onClick={handleJoin} className="mt-2 text-sm font-semibold text-brand-600 underline hover:text-brand-700">Retry</button></div>}
        <div className="pointer-events-none absolute inset-0 select-none overflow-hidden rounded-xl">
          <WatermarkOverlay sessionId={liveSessionId} />
        </div>
      </div>
    </ScreenRecordingDetector>
  );
}
