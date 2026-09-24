'use client';

import { useState } from 'react';
import { Calendar, Clock, ExternalLink, Loader2, Video } from 'lucide-react';
import { type LiveSession, getSessionJoinUrl, requestJoinToken } from '@/lib/api/live-sessions';
import { SessionStatusBadge } from '@/components/shared/SessionStatusBadge';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

interface Props {
  upcoming: LiveSession[];
  past: LiveSession[];
}

function getRelativeTime(startTime: string): string {
  const diff = new Date(startTime).getTime() - Date.now();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Starts in ${days}d`;
  if (hours > 0) return `Starts in ${hours}h`;
  if (mins > 0) return `Starts in ${mins}m`;
  return 'Starting now';
}

function getTimeLabel(session: LiveSession): string {
  const start = new Date(session.start_time).getTime();
  const end = start + (session.duration_minutes ?? 60) * 60000;
  const now = Date.now();
  if (session.status === 'cancelled') return 'Cancelled';
  if (session.status === 'ended' || now >= end) return 'Ended';
  if (now >= start) return 'Live Now';
  if (now >= start - 15 * 60 * 1000) return 'Starting soon';
  return getRelativeTime(session.start_time);
}

function JoinButton({ session }: { session: LiveSession }) {
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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
      setJoinError(err?.message || 'Unable to join');
    } finally {
      setJoining(false);
    }
  };

  const start = new Date(session.start_time).getTime();
  const end = start + (session.duration_minutes ?? 60) * 60000;
  const now = Date.now();
  const canJoin =
    (session.status === 'live' || session.status === 'scheduled') &&
    now >= start - 15 * 60 * 1000 &&
    now <= end;

  if (!canJoin) return null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        onClick={handleJoin}
        disabled={joining}
        aria-label={joining ? 'Joining' : `Join ${session.topic}`}
        className="flex min-h-[44px] min-w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none transition-colors"
      >
        {joining ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
        {joining ? 'Joining...' : 'Join Now'}
      </button>
      {joinError && <div className="max-w-[140px] text-right"><p className="text-xs font-medium text-red-600" role="alert">{joinError}</p><button onClick={handleJoin} className="mt-1 text-xs font-semibold text-brand-600 underline hover:text-brand-700">Retry</button></div>}
    </div>
  );
}

export function CourseDetailSessions({ upcoming, past }: Props) {
  const { locale, timezone } = useBusinessConfig();
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  };
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(locale, { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' });
  };
  if (upcoming.length === 0 && past.length === 0) {
    return (
      <div className="rounded-card border border-surface-border bg-surface-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Live Sessions
        </h3>
        <div className="mt-4 flex flex-col items-center gap-2 py-4 text-center">
          <Video className="h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-secondary">No sessions scheduled yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Live Sessions
      </h3>
      <div className="mt-3 space-y-2">
        {upcoming.map((session) => (
          <div
            key={session.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-surface-border bg-surface-muted p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text-primary truncate">
                  {session.topic}
                </p>
                {(() => {
                  const st = new Date(session.start_time).getTime();
                  const en = st + (session.duration_minutes ?? 60) * 60000;
                  const nw = Date.now();
                  const liveByTime = nw >= st && nw < en && session.status !== 'cancelled' && session.status !== 'ended';
                  const derived = liveByTime ? 'live' : session.status;
                  return <SessionStatusBadge status={derived} />;
                })()}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(session.start_time)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(session.start_time)}
                </span>
                <span>{session.duration_minutes} min</span>
              </div>
              <p className={`mt-1 flex items-center gap-1.5 text-[10px] font-semibold ${(() => { const s=new Date(session.start_time).getTime(); const e=s+(session.duration_minutes??60)*60000; const n=Date.now(); if(n>=s&&n<e&&session.status!=='cancelled'&&session.status!=='ended') return 'text-red-600'; return 'text-text-muted';})()}`}>
                {(() => { const s=new Date(session.start_time).getTime(); const e=s+(session.duration_minutes??60)*60000; const n=Date.now(); if(n>=s&&n<e&&session.status!=='cancelled'&&session.status!=='ended') return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />; return null;})()}
                {getTimeLabel(session)}
              </p>
            </div>
            <JoinButton session={session} />
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <div className="my-3 border-t border-surface-border" />
          <div className="space-y-2">
            {past.slice(0, 5).map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-3 rounded-lg p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                  <Calendar className="h-4 w-4 text-text-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-secondary truncate">
                    {session.topic}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatDate(session.start_time)} · {formatTime(session.start_time)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
