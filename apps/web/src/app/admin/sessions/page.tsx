'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Loader2, ExternalLink, Trash2, BarChart3, Clock, Video } from 'lucide-react';
import { toast } from 'sonner';
import { ScheduleSessionModal } from '@/components/admin/sessions/schedule-session-modal';
import {
  getSessions,
  deleteSession,
  type ScheduledSession,
} from '@/lib/api/sessions';
import { AdminPageHeader } from '@/components/shared/AdminPageHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSession(deleteTarget);
      toast.success('Session deleted');
      setDeleteTarget(null);
      fetchSessions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete session');
    } finally {
      setDeleting(false);
    }
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Time-aware derivation: cancelled stays cancelled, otherwise use wall-clock end
  const upcoming = sessions.filter((s) => {
    if (s.status === 'cancelled' || s.status === 'ended') return false;
    const end = new Date(s.start_time).getTime() + (s.duration_minutes ?? 60) * 60000;
    return end > now;
  });
  const past = sessions.filter((s) => {
    if (s.status === 'cancelled' || s.status === 'ended') return true;
    const end = new Date(s.start_time).getTime() + (s.duration_minutes ?? 60) * 60000;
    return end <= now;
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Live Trading Sessions" description="Schedule and manage Zoom webinars for your batches" actions={
        <button onClick={() => setShowScheduleModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"><Plus className="h-4 w-4" /> Schedule New Class</button>
      } />

      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminStatCard label="Total Sessions" value={sessions.length} icon={Calendar} iconColor="bg-brand-50 text-brand-600" />
          <AdminStatCard label="Upcoming" value={upcoming.length} icon={Clock} iconColor="bg-blue-50 text-blue-600" />
          <AdminStatCard label="Past" value={past.length} icon={Video} iconColor="bg-emerald-50 text-emerald-600" />
        </div>
      </AdminSection>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-20 text-gray-500">
          <Calendar className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-lg font-medium">No sessions scheduled</p>
          <p className="text-sm">Schedule your first live class to get started.</p>
        </div>
      ) : (
        <>
          {/* Upcoming */}
          {upcoming.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">
                Upcoming Sessions
              </h2>
              <SessionTable
                sessions={upcoming}
                now={now}
                onDelete={setDeleteTarget}
                formatDateTime={formatDateTime}
              />
            </section>
          )}

          {/* Past */}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">
                Past Sessions
              </h2>
              <SessionTable
                sessions={past}
                now={now}
                onDelete={setDeleteTarget}
                formatDateTime={formatDateTime}
              />
            </section>
          )}
        </>
      )}

      <ScheduleSessionModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSuccess={fetchSessions}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete live session"
        message="This will permanently delete the session from the LMS and attempt to delete the linked Zoom webinar (Zoom 404 is ignored). Attendance mappings for this session will also be removed. This cannot be undone."
        confirmLabel="Delete Session"
      />
    </div>
  );
}

function SessionTable({
  sessions,
  now,
  onDelete,
  formatDateTime,
}: {
  sessions: ScheduledSession[];
  now: number;
  onDelete: (id: string) => void;
  formatDateTime: (iso: string) => string;
}) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm scrollbar-thin focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      role="region"
      aria-label="Sessions table"
      tabIndex={0}
    >
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="px-5 py-3 font-medium text-gray-600">Title</th>
            <th className="px-5 py-3 font-medium text-gray-600">Batch</th>
            <th className="px-5 py-3 font-medium text-gray-600">Date &amp; Time</th>
            <th className="px-5 py-3 font-medium text-gray-600">Status</th>
            <th className="px-5 py-3 font-medium text-gray-600">Zoom</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sessions.map((session) => (
            <tr key={session.id} className="hover:bg-gray-50">
              <td className="px-5 py-4 font-medium text-gray-900">
                {session.title}
              </td>
              <td className="px-5 py-4 text-gray-600">
                {session.batchNames?.length > 0
                  ? session.batchNames.join(', ')
                  : '—'}
              </td>
              <td className="px-5 py-4 text-gray-600">
                {formatDateTime(session.start_time)}
              </td>
              <td className="px-5 py-4">
                {(() => {
                  const start = new Date(session.start_time).getTime();
                  const end = start + (session.duration_minutes ?? 60) * 60000;
                  const isLive = now >= start && now < end && session.status !== 'cancelled' && session.status !== 'ended';
                  const isEnded = end <= now || session.status === 'ended' || session.status === 'cancelled';
                  const label = session.status === 'cancelled' ? 'Cancelled' : isEnded ? 'Ended' : isLive ? 'Live Now' : 'Scheduled';
                  return (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        isLive
                          ? 'bg-green-100 text-green-700'
                          : !isEnded
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : !isEnded ? 'bg-blue-500' : 'bg-gray-400'}`}
                      />
                      {label}
                    </span>
                  );
                })()}
              </td>
              <td className="px-5 py-4">
                {session.joinUrl ? (
                  <a
                    href={session.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
                  >
                    Open
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-5 py-4 text-right">
                <button
                  onClick={() => onDelete(session.id)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Cancel session"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
