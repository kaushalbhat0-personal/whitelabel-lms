'use client';

import { useState } from 'react';
import { Video, Calendar, Clock, ExternalLink, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { type LiveSession, getSessionJoinUrl, requestJoinToken } from '@/lib/api/live-sessions';
import { SessionStatusBadge } from '@/components/shared/SessionStatusBadge';

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

function SessionCard({
  session,
}: {
  session: LiveSession & { attendanceStatus?: string };
}) {
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    setJoining(true);
    try {
      const { token } = await requestJoinToken(session.id);
      const { joinUrl } = await getSessionJoinUrl(session.id, token);
      window.open(joinUrl, '_blank');
    } catch {
      // silent
    } finally {
      setJoining(false);
    }
  };

  const start = new Date(session.start_time).getTime();
  const end = start + (session.duration_minutes ?? 60) * 60000;
  const now = Date.now();
  const isUpcoming = (session.status === 'scheduled' || session.status === 'live') && now <= end;
  const canJoin = session.status === 'live' || (session.status === 'scheduled' && now >= start - 15 * 60 * 1000 && now <= end);

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text-primary truncate">
              {session.topic}
            </p>
            <SessionStatusBadge status={session.status} />
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
          {isUpcoming && session.status !== 'live' && (
            <p className="mt-1 text-xs text-text-muted">
              {getRelativeTime(session.start_time)}
            </p>
          )}
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
          <button
            onClick={handleJoin}
            disabled={joining}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-navyDark disabled:opacity-50"
          >
            {joining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            {joining ? 'Joining...' : 'Join'}
          </button>
        )}
      </div>
    </div>
  );
}

export function LiveSessionsList({ upcoming, past, error }: Props) {
  const todayStr = new Date().toDateString();
  const todaySessions = upcoming.filter(
    (s) => new Date(s.start_time).toDateString() === todayStr,
  );
  const laterSessions = upcoming.filter(
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

  if (upcoming.length === 0 && past.length === 0) {
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
        <Section title="Today" sessions={todaySessions} />
      )}
      {laterSessions.length > 0 && (
        <Section title="Upcoming" sessions={laterSessions} />
      )}
      {past.length > 0 && (
        <Section title="Past" sessions={past} past />
      )}
    </div>
  );
}

function Section({
  title,
  sessions,
  past,
}: {
  title: string;
  sessions: (LiveSession & { attendanceStatus?: string })[];
  past?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      <div className="space-y-2">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}
