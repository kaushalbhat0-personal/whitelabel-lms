'use client';

import { useState } from 'react';
import { Video, Calendar, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { type LiveSession, getSessionJoinUrl, requestJoinToken } from '@/lib/api/live-sessions';
import { SessionStatusBadge } from '@/components/shared/SessionStatusBadge';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

interface Props {
  session: LiveSession | null;
}

export function DashboardNextClass({ session }: Props) {
  const { locale, timezone } = useBusinessConfig();
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  };
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(locale, { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'short' });
  };
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!session) return;
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

  if (!session) {
    return (
      <div className="rounded-card border border-surface-border bg-surface-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Next Class
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          No upcoming classes scheduled.
        </p>
      </div>
    );
  }

  const isLive = session.status === 'live';

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {isLive ? 'Live Now' : 'Next Class'}
      </h3>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-bold text-text-primary truncate">
              {session.topic}
            </h4>
            <SessionStatusBadge status={session.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
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
        </div>
      </div>
      <button
        onClick={handleJoin}
        disabled={joining}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-navyDark disabled:opacity-50 md:w-auto"
      >
        {joining ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Joining...
          </>
        ) : (
          <>
            {isLive ? 'Join Now' : 'Join'}
            <ExternalLink className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
