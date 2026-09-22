'use client';

import { useState, useEffect } from 'react';
import { Video, Calendar, Clock, ExternalLink, Loader2, CheckCircle, XCircle, AlertTriangle, Users } from 'lucide-react';
import { type LiveSession, getSessionJoinUrl, requestJoinToken } from '@/lib/api/live-sessions';
import { SessionStatusBadge } from '@/components/shared/SessionStatusBadge';
import { deriveSessionState, getTimeLabel as sharedGetTimeLabel, getRelativeTime as sharedGetRelativeTime } from '@/lib/session-status';

interface Props {
  upcoming: LiveSession[];
  past: (LiveSession & { attendanceStatus?: string })[];
  error?: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function SessionCard({
  session,
  now,
}: {
  session: LiveSession & { attendanceStatus?: string };
  now: number;
}) {
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    // Open blank tab synchronously to avoid popup-blocker (async window.open is blocked)
    const win = window.open('about:blank', '_blank');
    try {
      const { token } = await requestJoinToken(session.id);
      const { joinUrl } = await getSessionJoinUrl(session.id, token);
      if (!joinUrl || !joinUrl.includes('zoom.us')) {
        throw new Error('Invalid join URL');
      }
      if (win && !win.closed) {
        win.location.href = joinUrl;
        win.focus();
      } else {
        // Popup was blocked — fallback to same-tab navigation; also surface link
        window.location.href = joinUrl;
      }
    } catch (err: any) {
      if (win && !win.closed) win.close();
      const msg = err?.message || 'Unable to join. Please try again.';
      setJoinError(msg);
    } finally {
      setJoining(false);
    }
  };

  const start = new Date(session.start_time).getTime();
  const end = start + (session.duration_minutes ?? 60) * 60000;
  const state = deriveSessionState(session, now);
  const isLiveByTime = state === 'live';
  const derivedStatus = state === 'live' ? 'live' : state === 'starting_soon' ? 'scheduled' : state === 'cancelled' ? 'cancelled' : state === 'ended' ? 'ended' : session.status;
  // Use derived upcoming: not ended/cancelled and time <= end
  const isUpcoming = state !== 'ended' && state !== 'cancelled';
  const canJoin = (session.status === 'live' || session.status === 'scheduled') && now >= start - 15 * 60 * 1000 && now <= end && state !== 'cancelled' && state !== 'ended';

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text-primary truncate">
              {session.topic}
            </p>
            <SessionStatusBadge status={derivedStatus} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(session.start_time)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatTime(session.start_time)}
            </span>
            <span>{session.duration_minutes} min</span>
          </div>
          {session.matchingBatches && session.matchingBatches.length > 0 && (
            <p
              className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-secondary"
              aria-label={`${session.matchingBatches.length === 1 ? 'Batch' : 'Batches'}: ${session.matchingBatches.map((b) => b.name).join(', ')}`}
            >
              <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words">
                {session.matchingBatches.length === 1 ? 'Batch' : 'Batches'}: {session.matchingBatches.map((b) => b.name).join(', ')}
              </span>
            </p>
          )}
          <p className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${isLiveByTime ? 'text-red-600' : derivedStatus === 'ended' ? 'text-text-muted' : derivedStatus === 'cancelled' ? 'text-gray-500' : 'text-text-muted'}`}>
            {isLiveByTime && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />}
            {sharedGetTimeLabel(session, now)}
          </p>
          {!isUpcoming && session.attendanceStatus && (
            <p
              className={`mt-1 flex items-center gap-1 text-xs ${
                session.attendanceStatus === 'present'
                  ? 'text-status-success'
                  : 'text-status-live'
              }`}
            >
              {session.attendanceStatus === 'present' ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {session.attendanceStatus === 'present' ? 'Attended' : 'Absent'}
            </p>
          )}
        </div>
        {isUpcoming && canJoin && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              onClick={handleJoin}
              disabled={joining}
              aria-label={joining ? 'Joining session' : `Join ${session.topic}`}
              className="flex min-h-[44px] min-w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none transition-colors"
            >
              {joining ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              {joining ? 'Joining...' : 'Join Now'}
            </button>
            {joinError && (
              <div className="max-w-[180px] text-right">
                <p className="text-xs font-medium text-red-600" role="alert">{joinError}</p>
                <button onClick={handleJoin} className="mt-1 text-xs font-semibold text-brand-600 underline hover:text-brand-700">Retry</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveSessionsList({ upcoming, past, error }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);
  // Re-derive upcoming/past based on wall-clock time so a session crossing start/end while page is open moves sections without reload
  const all = [...upcoming, ...past];
  const effectiveUpcoming = all.filter((s) => {
    const st = deriveSessionState(s as any, now);
    return st !== 'ended' && st !== 'cancelled';
  });
  const effectivePast = all.filter((s) => {
    const st = deriveSessionState(s as any, now);
    return st === 'ended' || st === 'cancelled' || s.status === 'ended' || s.status === 'cancelled';
  });
  // Deduplicate: prefer effectiveUpcoming for live sessions that were initially in past but time-based still live? Already covered.
  const todayStr = new Date(now).toDateString();
  const todaySessions = effectiveUpcoming.filter(
    (s) => new Date(s.start_time).toDateString() === todayStr,
  );
  const laterSessions = effectiveUpcoming.filter(
    (s) => new Date(s.start_time).toDateString() !== todayStr,
  );

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-status-live" />
        <p className="text-sm font-medium text-text-primary">
          Failed to load sessions
        </p>
        <p className="text-xs text-text-secondary">
          Something went wrong. Please try again later.
        </p>
      </div>
    );
  }

  if (effectiveUpcoming.length === 0 && effectivePast.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Video className="h-10 w-10 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">
          No sessions scheduled
        </p>
        <p className="text-xs text-text-secondary">
          New sessions will appear here once scheduled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {todaySessions.length > 0 && (
        <Section title="Today" sessions={todaySessions} now={now} />
      )}
      {laterSessions.length > 0 && (
        <Section title="Upcoming" sessions={laterSessions} now={now} />
      )}
      {effectivePast.length > 0 && (
        <Section title="Past" sessions={effectivePast} now={now} past />
      )}
    </div>
  );
}

function Section({
  title,
  sessions,
  now,
  past,
}: {
  title: string;
  sessions: (LiveSession & { attendanceStatus?: string })[];
  now: number;
  past?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      <div className="space-y-2">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} now={now} />
        ))}
      </div>
    </div>
  );
}
