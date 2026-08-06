'use client';

import { useState, useEffect } from 'react';
import {
  Film,
  Pencil,
  Trash2,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Hourglass,
} from 'lucide-react';
import { type AdminVideo, type Topic, deleteVideo } from '@/lib/api/videos';
import { EditVideoModal } from './edit-video-modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface RecordingsTableProps {
  initialVideos: AdminVideo[];
  total: number;
  topics: Topic[];
  loading?: boolean;
  onChanged?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-green-100 text-green-700' },
  processing: { label: 'Processing', className: 'bg-yellow-100 text-yellow-700' },
  uploading: { label: 'Uploading', className: 'bg-blue-100 text-blue-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  error: { label: 'Error', className: 'bg-red-100 text-red-700' },
};

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function RecordingsTable({
  initialVideos,
  total,
  topics,
  loading = false,
  onChanged,
}: RecordingsTableProps) {
  const [videos, setVideos] = useState<AdminVideo[]>(initialVideos);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<AdminVideo | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Sync local state when parent refreshes (search/filter/pagination)
  useEffect(() => {
    setVideos(initialVideos);
  }, [initialVideos]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setDeletingId(deleteTarget.id);
    setDeleteError('');
    try {
      await deleteVideo(deleteTarget.id);
      setVideos((prev) => prev.filter((v) => v.id !== deleteTarget.id));
      setDeleteTarget(null);
      onChanged?.();
    } catch {
      setDeleteError(`Failed to delete "${deleteTarget.title}". Please try again.`);
      setDeleteTarget(null);
    } finally {
      setDeletingId(null);
    }
  };

  const isProcessing = (video: AdminVideo) =>
    video.status === 'processing' || video.status === 'uploading';

  const handleSaved = (updated: AdminVideo) => {
    setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    setEditingVideo(null);
    onChanged?.();
  };

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-16 text-gray-500">
        <Film className="mb-3 h-10 w-10 text-gray-300" />
        <p className="text-lg font-medium">No recordings match your filters</p>
        <p className="mt-1 text-sm">
          Try adjusting search or filters, or upload a new recording.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        {loading && (
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating results...
          </div>
        )}
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Video
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Topic
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Batches
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Date
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {videos.map((video) => {
              const cfg = STATUS_CONFIG[video.status] ?? {
                label: video.status,
                className: 'bg-gray-100 text-gray-600',
              };

              const pending = isProcessing(video);
              const batchNames = (video.recording_batches ?? [])
                .map((b) => b.batches?.name)
                .filter(Boolean);

              return (
                <tr key={video.id} className={`hover:bg-gray-50 transition-colors ${pending ? 'opacity-70' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${pending ? 'bg-yellow-50' : 'bg-brand-50'}`}>
                        {pending ? (
                          <Hourglass className="h-5 w-5 text-yellow-500" />
                        ) : (
                          <Film className="h-5 w-5 text-brand-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 max-w-xs">
                          {video.title}
                        </p>
                        {pending && (
                          <p className="text-xs text-yellow-600 font-medium mt-0.5">
                            Encoder preparing video...
                          </p>
                        )}
                        {!pending && video.description && (
                          <p className="truncate text-xs text-gray-500 max-w-xs">
                            {video.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      {pending ? 'Processing...' : formatDuration(video.duration_seconds)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {video.topics?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {batchNames.length === 0 ? (
                      <span className="text-xs text-gray-400">Unassigned</span>
                    ) : (
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {batchNames.slice(0, 3).map((name) => (
                          <span
                            key={name}
                            className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                          >
                            {name}
                          </span>
                        ))}
                        {batchNames.length > 3 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                            +{batchNames.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
                    >
                      {video.status === 'ready' ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : video.status === 'error' || video.status === 'failed' ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {cfg.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {formatDate(video.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditingVideo(video)}
                        disabled={pending}
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={pending ? 'Cannot edit while processing' : 'Edit video, batches and metadata'}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(video)}
                        disabled={deletingId === video.id}
                        className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                        title="Delete"
                      >
                        {deletingId === video.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {deleteError && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {deleteError}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Recording"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.title}"? The video will be deleted from both the LMS and Mux. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        loading={deletingId !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      {editingVideo && (
        <EditVideoModal
          video={editingVideo}
          topics={topics}
          isOpen={true}
          onClose={() => setEditingVideo(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
