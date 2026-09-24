'use client';

import { Calendar, Clock } from 'lucide-react';
import { type LiveSession } from '@/lib/api/live-sessions';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

interface Props {
  sessions: LiveSession[];
}

export function DashboardUpcomingList({ sessions }: Props) {
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
  if (sessions.length === 0) return null;

  return (
    <div className="rounded-card border border-surface-border bg-surface-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Up Next
      </h3>
      <div className="mt-3 space-y-3">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface-muted p-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
              <Calendar className="h-4 w-4 text-brand-navy" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">
                {session.topic}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <span>{formatDate(session.start_time)}</span>
                <span>{formatTime(session.start_time)}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
