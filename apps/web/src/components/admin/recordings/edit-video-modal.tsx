'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { X, Loader2, ChevronDown } from 'lucide-react';
import {
  type AdminVideo,
  type Topic,
  updateVideoMetadata,
  updateRecordingBatchCurriculum,
} from '@/lib/api/videos';
import { getAllBatches, type Batch } from '@/lib/api/courses';

interface EditVideoModalProps {
  video: AdminVideo;
  topics: Topic[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updated: AdminVideo) => void;
}

export function EditVideoModal({
  video,
  topics,
  isOpen,
  onClose,
  onSaved,
}: EditVideoModalProps) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? '');
  const [topicId, setTopicId] = useState<string | ''>(video.topic_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [allBatches, setAllBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [addedBatchCategories, setAddedBatchCategories] = useState<Record<string, string>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Reset form state whenever the modal opens for a (potentially different) video
  useEffect(() => {
    if (isOpen) {
      setTitle(video.title);
      setDescription(video.description ?? '');
      setTopicId(video.topic_id ?? '');
      setError('');
      setSaving(false);
      setDropdownOpen(false);
      setSelectedBatchIds(
        new Set((video.recording_batches ?? []).map((b) => b.batch_id)),
      );
      setAddedBatchCategories({});
    }
  }, [isOpen, video]);

  const fetchBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const result = await getAllBatches({ isActive: true, limit: 200 });
      setAllBatches(result.items);
    } catch {
      // silent — batch add stays disabled
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchBatches();
  }, [isOpen, fetchBatches]);

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      const wasSelected = prev.has(id);
      if (wasSelected) {
        next.delete(id);
        setAddedBatchCategories((prevCat) => {
          const copy = { ...prevCat };
          delete copy[id];
          return copy;
        });
      } else {
        next.add(id);
        const isNewlyAdded = !(video.recording_batches ?? []).some((b) => b.batch_id === id);
        if (isNewlyAdded) {
          setAddedBatchCategories((prevCat) => ({
            ...prevCat,
            [id]: prevCat[id] ?? 'General',
          }));
        }
      }
      return next;
    });
  };

  const originalBatchIds = new Set((video.recording_batches ?? []).map((b) => b.batch_id));
  const addedBatchIds = [...selectedBatchIds].filter((id) => !originalBatchIds.has(id));

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const originalBatchIds = new Set(
        (video.recording_batches ?? []).map((b) => b.batch_id),
      );
      const added = [...selectedBatchIds].filter((id) => !originalBatchIds.has(id));
      const removed = [...originalBatchIds].filter((id) => !selectedBatchIds.has(id));

      // Phase 9: use atomic batch-curriculum endpoint — single transaction for add+remove.
      // For newly-added batches, include batch-specific sectionName (defaults to General).
      if (added.length > 0 || removed.length > 0) {
        const assignments = [
          ...added.map((batchId) => ({
            batchId,
            assigned: true as const,
            sectionName: (addedBatchCategories[batchId] ?? 'General').trim() || 'General',
          })),
          ...removed.map((batchId) => ({ batchId, assigned: false as const })),
        ];
        await updateRecordingBatchCurriculum(video.id, assignments);
      }

      const updated = await updateVideoMetadata(video.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        topicId: topicId || null,
      });

      const updatedBatchEntries = (video.recording_batches ?? [])
        .filter((b) => selectedBatchIds.has(b.batch_id))
        .concat(
          added.map((id) => {
            const name = allBatches.find((b) => b.id === id)?.name;
            return {
              batch_id: id,
              batches: name ? { name } : null,
            };
          }),
        );

      onSaved({
        ...video,
        ...updated,
        recording_batches: updatedBatchEntries,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const selectedLabels = allBatches
    .filter((b) => selectedBatchIds.has(b.id))
    .map((b) => b.name);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Video">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Topic
          </label>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">No topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Assigned Batches
          </label>

          {selectedLabels.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {selectedLabels.map((name) => {
                const id = allBatches.find((b) => b.name === name)?.id;
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700"
                  >
                    {name}
                    {id && (
                      <button
                        onClick={() => toggleBatch(id)}
                        disabled={saving}
                        className="rounded-full p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-600 disabled:opacity-40"
                        title={`Remove ${name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              disabled={saving || loadingBatches}
              className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-left focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            >
              <span className={selectedLabels.length === 0 ? 'text-gray-400' : 'text-gray-900'}>
                {loadingBatches
                  ? 'Loading batches...'
                  : selectedLabels.length > 0
                    ? `${selectedLabels.length} assigned`
                    : 'Select batches...'}
              </span>
              <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="max-h-48 overflow-y-auto">
                  {allBatches.length === 0 ? (
                    <div className="py-4 text-center text-sm text-gray-400">
                      No active batches
                    </div>
                  ) : (
                    allBatches.map((b) => (
                      <label
                        key={b.id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedBatchIds.has(b.id)}
                          onChange={() => toggleBatch(b.id)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span className="text-gray-700">{b.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Assigning a batch makes this recording visible to that batch&apos;s students.
          </p>
        </div>

        {addedBatchIds.length > 0 && (
          <div className="space-y-3 rounded-lg border border-surface-border bg-surface-muted p-3">
            <p className="text-xs font-semibold text-text-secondary">
              Category for newly added batches
            </p>
            <p className="text-xs text-text-muted">
              Choose where this recording appears in each new batch’s curriculum. Existing batches are untouched.
            </p>
            {addedBatchIds.map((batchId) => {
              const batchName = allBatches.find((b) => b.id === batchId)?.name ?? batchId;
              return (
                <div key={batchId}>
                  <label htmlFor={`category-${batchId}`} className="block text-xs font-medium text-text-secondary mb-1">
                    {batchName}
                  </label>
                  <input
                    id={`category-${batchId}`}
                    type="text"
                    value={addedBatchCategories[batchId] ?? 'General'}
                    onChange={(e) =>
                      setAddedBatchCategories((prev) => ({ ...prev, [batchId]: e.target.value }))
                    }
                    disabled={saving}
                    placeholder="e.g. Week 1, Trading Psychology"
                    list={`existing-categories-${batchId}`}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
                    aria-label={`Category for ${batchName}`}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
