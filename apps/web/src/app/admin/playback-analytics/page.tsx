'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  BarChart3,
  Play,
  Clock,
  Users,
  AlertTriangle,
  SkipForward,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPlaybackEvents, getPlaybackViolations } from '@/lib/api/playback-analytics';
import type { PlaybackEvent, PlaybackViolation } from '@/lib/api/playback-analytics';
import { getAdminVideos } from '@/lib/api/videos';

interface AnalyticsSummary {
  totalViews: number;
  uniqueStudents: number;
  avgWatchPercent: number;
  completionRate: number;
  avgSpeed: number;
  totalViolations: number;
  studentsNeverWatched: number;
  mostReplayedTimes: { position: number; count: number }[];
  dropOffPoints: { position: number; dropCount: number }[];
  studentsAbove90: number;
}

function StatCard({ title, value, subtitle, icon: Icon, color }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold text-text-primary">{value ?? '-'}</p>
          {subtitle && <p className="mt-1 text-xs text-text-muted">{subtitle}</p>}
        </div>
        <div className={cn('rounded-xl p-3', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function computeAnalytics(
  events: PlaybackEvent[],
  violations: PlaybackViolation[],
  durations: Record<string, number>,
): AnalyticsSummary {
  const uniqueStudents = new Set(events.map((e) => e.user_id)).size;
  const totalViews = events.filter((e) => e.event_type === 'play').length;
  const ended = events.filter((e) => e.event_type === 'ended').length;
  const heartbeats = events.filter((e) => e.event_type === 'heartbeat');
  const seeks = events.filter((e) => e.event_type === 'seek');

  const userRecording = new Map<string, number>();
  const usersWithHeartbeats = new Set<string>();
  for (const h of heartbeats) {
    if (h.position_seconds == null) continue;
    usersWithHeartbeats.add(h.user_id);
    const key = `${h.user_id}:${h.recording_id ?? ''}`;
    const prev = userRecording.get(key) ?? 0;
    if (h.position_seconds > prev) userRecording.set(key, h.position_seconds);
  }

  let watchPctSum = 0;
  let watchPctCount = 0;
  let usersAbove90 = 0;
  const usersAbove90Seen = new Set<string>();
  const dropMap = new Map<number, number>();

  for (const [key, maxPos] of userRecording) {
    const separator = key.indexOf(':');
    const userId = key.slice(0, separator);
    const recordingId = key.slice(separator + 1);
    const duration = durations[recordingId];
    if (!duration || duration <= 0) continue;

    const pct = Math.min(100, (maxPos / duration) * 100);
    watchPctSum += pct;
    watchPctCount++;

    if (pct >= 90 && !usersAbove90Seen.has(userId)) {
      usersAbove90Seen.add(userId);
      usersAbove90++;
    }

    if (maxPos < duration) {
      const bucket = Math.floor(maxPos / 10) * 10;
      dropMap.set(bucket, (dropMap.get(bucket) || 0) + 1);
    }
  }

  const avgWatchPercent = watchPctCount > 0 ? Math.round(watchPctSum / watchPctCount) : 0;
  const completionRate = totalViews > 0 ? Math.round((ended / totalViews) * 100) : 0;
  const avgSpeed = 1;
  const neverWatched = Math.max(0, uniqueStudents - usersWithHeartbeats.size);

  const replayMap = new Map<number, number>();
  seeks.forEach((s) => {
    if (s.position_seconds != null) {
      const bucket = Math.floor(s.position_seconds / 10) * 10;
      replayMap.set(bucket, (replayMap.get(bucket) || 0) + 1);
    }
  });
  const mostReplayedTimes = [...replayMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([position, count]) => ({ position, count }));

  const dropOffPoints = [...dropMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([position, dropCount]) => ({ position, dropCount }));

  return {
    totalViews,
    uniqueStudents,
    avgWatchPercent,
    completionRate,
    avgSpeed,
    totalViolations: violations.length,
    studentsNeverWatched: neverWatched,
    mostReplayedTimes,
    dropOffPoints,
    studentsAbove90: usersAbove90,
  };
}

export default function AdminPlaybackAnalyticsPage() {
  const [events, setEvents] = useState<PlaybackEvent[]>([]);
  const [violations, setViolations] = useState<PlaybackViolation[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getPlaybackEvents(),
      getPlaybackViolations(),
      getAdminVideos({ limit: 500 }).catch(() => ({ items: [] })),
    ])
      .then(([evts, viols, videoResult]) => {
        if (cancelled) return;
        setEvents(evts);
        setViolations(viols);
        const durationMap: Record<string, number> = {};
        for (const v of videoResult.items ?? []) {
          if (v.duration_seconds) durationMap[v.id] = v.duration_seconds;
        }
        setDurations(durationMap);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load analytics');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const analytics = useMemo(() => computeAnalytics(events, violations, durations), [events, violations, durations]);

  const recentViolations = useMemo(
    () => violations.slice(0, 20),
    [violations],
  );

  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm font-medium text-text-primary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Playback Analytics</h1>
        <p className="mt-1 text-sm text-text-muted">
          Video consumption metrics, drop-off analysis, and rewatch patterns
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-surface-border border-t-brand-navy" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              title="Total Plays"
              value={analytics.totalViews}
              icon={Play}
              color="bg-blue-600"
            />
            <StatCard
              title="Unique Students"
              value={analytics.uniqueStudents}
              icon={Users}
              color="bg-purple-600"
            />
            <StatCard
              title="Avg Watch Progress"
              value={`${analytics.avgWatchPercent}%`}
              subtitle="Average max position across students"
              icon={TrendingUp}
              color="bg-emerald-600"
            />
            <StatCard
              title="Completion Rate"
              value={`${analytics.completionRate}%`}
              subtitle="Played-to-completion ratio"
              icon={CheckCircle2}
              color="bg-teal-600"
            />
            <StatCard
              title="Students Completed >90%"
              value={analytics.studentsAbove90}
              subtitle="High engagement"
              icon={BarChart3}
              color="bg-indigo-600"
            />
            <StatCard
              title="Never Watched"
              value={analytics.studentsNeverWatched}
              subtitle="Students with no heartbeat events"
              icon={Clock}
              color="bg-orange-600"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Most Replayed Sections */}
            <div className="rounded-xl border border-surface-border bg-surface-card p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">
                Most Replayed Sections
              </h2>
              {analytics.mostReplayedTimes.length === 0 ? (
                <p className="text-sm text-text-muted py-8 text-center">No seek data available yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.mostReplayedTimes.map((item) => (
                    <div key={item.position} className="flex items-center gap-3">
                      <SkipForward className="h-4 w-4 shrink-0 text-brand-500" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-text-primary">
                            {Math.floor(item.position / 60)}:{(item.position % 60).toString().padStart(2, '0')}
                          </span>
                          <span className="text-xs text-text-muted">{item.count} rewinds</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${Math.min(100, (item.count / (analytics.mostReplayedTimes[0]?.count || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Drop-off Points */}
            <div className="rounded-xl border border-surface-border bg-surface-card p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">
                Drop-off Points
              </h2>
              {analytics.dropOffPoints.length === 0 ? (
                <p className="text-sm text-text-muted py-8 text-center">No drop-off data available yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.dropOffPoints.map((item) => (
                    <div key={item.position} className="flex items-center gap-3">
                      <TrendingUp className="h-4 w-4 shrink-0 text-red-400 rotate-180" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-text-primary">
                            {Math.floor(item.position / 60)}:{(item.position % 60).toString().padStart(2, '0')}
                          </span>
                          <span className="text-xs text-text-muted">{item.dropCount} dropped</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-red-400"
                            style={{ width: `${Math.min(100, (item.dropCount / (analytics.dropOffPoints[0]?.dropCount || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Violations */}
          {recentViolations.length > 0 && (
            <div className="rounded-xl border border-surface-border bg-surface-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">
                  Recent Playback Violations
                </h2>
                <span className="text-xs text-text-muted">{analytics.totalViolations} total</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-muted border-b border-surface-border">
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">User</th>
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">Type</th>
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">Details</th>
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {recentViolations.map((v) => (
                      <tr key={v.id} className="hover:bg-surface-muted/50">
                        <td className="px-4 py-3 text-text-primary">
                          {v.profiles?.name || v.user_id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                            {v.violation_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted max-w-xs truncate">
                          {v.details ? JSON.stringify(v.details) : '-'}
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted">
                          {new Date(v.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}