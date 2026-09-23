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
import { getBatchCurriculum } from '@/lib/api/recordings';

interface EditVideoModalProps {
  video: AdminVideo;
  topics: Topic[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updated: AdminVideo) => void;
}

export function EditVideoModal({
  video,
  topics: _topics,
  isOpen,
  onClose,
  onSaved,
}: EditVideoModalProps) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [allBatches, setAllBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [addedBatchCategories, setAddedBatchCategories] = useState<Record<string, string>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Phase 2: per-batch category loading mirrors upload-recording-modal
  const [batchCategories, setBatchCategories] = useState<Record<string, string[]>>({});
  const [loadingBatchCategories, setLoadingBatchCategories] = useState<Record<string, boolean>>({});
  const [creatingNewByBatch, setCreatingNewByBatch] = useState<Record<string, boolean>>({});
  const [newCategoryInputByBatch, setNewCategoryInputByBatch] = useState<Record<string, string>>({});

  const normalizeDisplay = (s: string) => s.trim().replace(/\s+/g, ' ');
  const normalizeKey = (s: string) => normalizeDisplay(s).toLowerCase();
  const findCanonical = (input: string, existing: string[]) => {
    const key = normalizeKey(input);
    return existing.find((e) => normalizeKey(e) === key) ?? null;
  };

  // Reset form state whenever the modal opens for a (potentially different) video
  useEffect(() => {
    if (isOpen) {
      setTitle(video.title);
      setDescription(video.description ?? '');
      setError('');
      setSaving(false);
      setDropdownOpen(false);
      setSelectedBatchIds(
        new Set((video.recording_batches ?? []).map((b) => b.batch_id)),
      );
      setAddedBatchCategories({});
      setBatchCategories({});
      setLoadingBatchCategories({});
      setCreatingNewByBatch({});
      setNewCategoryInputByBatch({});
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
        // Clean per-batch category state for removed batches
        setBatchCategories((prevBatch) => {
          const copy = { ...prevBatch };
          delete copy[id];
          return copy;
        });
        setLoadingBatchCategories((prevLoad) => {
          const copy = { ...prevLoad };
          delete copy[id];
          return copy;
        });
        setCreatingNewByBatch((prevC) => {
          const copy = { ...prevC };
          delete copy[id];
          return copy;
        });
        setNewCategoryInputByBatch((prevN) => {
          const copy = { ...prevN };
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

  // Load categories for newly added batches only (not already assigned)
  useEffect(() => {
    if (addedBatchIds.length === 0) return;
    const toFetch = addedBatchIds.filter((id) => batchCategories[id] === undefined && !loadingBatchCategories[id]);
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const batchId of toFetch) {
        setLoadingBatchCategories((prev) => ({ ...prev, [batchId]: true }));
        try {
          const cats = await getBatchCurriculum(batchId);
          const names: string[] = (cats ?? []).map((c: any) => c.category);
          if (cancelled) return;
          setBatchCategories((prev) => ({ ...prev, [batchId]: names }));
          // Initialize default: first existing or General, preserving any manual choice already made
          setAddedBatchCategories((prev) => {
            if (prev[batchId] && prev[batchId] !== 'General') return prev;
            // If we set General earlier as placeholder, upgrade to first category when available
            if (names.length > 0) {
              // Respect any non-General manual value already set; otherwise use first existing
              const current = prev[batchId];
              if (current && current !== 'General' && names.includes(current)) return prev;
              const hasCanonical = current ? findCanonical(current, names) : null;
              if (hasCanonical) return prev;
              return { ...prev, [batchId]: names[0] };
            }
            return prev;
          });
        } catch {
          if (!cancelled) setBatchCategories((prev) => ({ ...prev, [batchId]: [] }));
        } finally {
          if (!cancelled) setLoadingBatchCategories((prev) => ({ ...prev, [batchId]: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedBatchIds.join(',')]);

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
      // For newly-added batches, include batch-specific sectionName with canonical resolution.
      if (added.length > 0 || removed.length > 0) {
        const assignments = [
          ...added.map((batchId) => {
            const existingCats = batchCategories[batchId] ?? [];
            let raw: string;
            if (creatingNewByBatch[batchId]) {
              raw = newCategoryInputByBatch[batchId] ?? '';
            } else {
              raw = addedBatchCategories[batchId] ?? 'General';
            }
            const display = normalizeDisplay(raw) || 'General';
            const canonical = findCanonical(display, existingCats) ?? display;
            return {
              batchId,
              assigned: true as const,
              sectionName: canonical,
            };
          }),
          ...removed.map((batchId) => ({ batchId, assigned: false as const })),
        ];
        await updateRecordingBatchCurriculum(video.id, assignments);
      }

      // Topic cleanup (Phase 3): do NOT send topicId — preserve existing topic_id by omitting the field.
      const updated = await updateVideoMetadata(video.id, {
        title: title.trim(),
        description: description.trim() || undefined,
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
              const cats = batchCategories[batchId] ?? [];
              const isCreating = !!creatingNewByBatch[batchId];
              const isLoading = !!loadingBatchCategories[batchId];
              const selectedCat = addedBatchCategories[batchId] ?? (cats[0] ?? 'General');
              return (
                <div key={batchId} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                  <div className="text-xs font-semibold text-gray-600">{batchName}</div>
                  {isLoading ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading categories...
                    </div>
                  ) : !isCreating ? (
                    <select
                      value={selectedCat}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__CREATE_NEW__') {
                          setCreatingNewByBatch((prev) => ({ ...prev, [batchId]: true }));
                          setNewCategoryInputByBatch((prev) => ({ ...prev, [batchId]: '' }));
                        } else {
                          setAddedBatchCategories((prev) => ({ ...prev, [batchId]: val }));
                        }
                      }}
                      disabled={saving}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
                      aria-label={`Category for ${batchName}`}
                    >
                      {cats.length === 0 && <option value="General">General</option>}
                      {cats.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__CREATE_NEW__">+ Create New Category</option>
                    </select>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={newCategoryInputByBatch[batchId] ?? ''}
                        onChange={(e) => setNewCategoryInputByBatch((prev) => ({ ...prev, [batchId]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const raw = newCategoryInputByBatch[batchId] ?? '';
                            const display = normalizeDisplay(raw);
                            if (!display) return;
                            const canonical = findCanonical(display, cats);
                            const finalCat = canonical ?? display;
                            setAddedBatchCategories((prev) => ({ ...prev, [batchId]: finalCat }));
                            if (!canonical && display && !cats.includes(display)) {
                              setBatchCategories((prev) => ({ ...prev, [batchId]: [...cats, display] }));
                            }
                            setCreatingNewByBatch((prev) => ({ ...prev, [batchId]: false }));
                          }
                          if (e.key === 'Escape') {
                            setCreatingNewByBatch((prev) => ({ ...prev, [batchId]: false }));
                          }
                        }}
                        disabled={saving}
                        placeholder="New category name"
                        autoFocus
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
                        aria-label={`New category for ${batchName}`}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const raw = newCategoryInputByBatch[batchId] ?? '';
                            const display = normalizeDisplay(raw);
                            if (!display) return;
                            const canonical = findCanonical(display, cats);
                            const finalCat = canonical ?? display;
                            setAddedBatchCategories((prev) => ({ ...prev, [batchId]: finalCat }));
                            if (!canonical && display && !cats.includes(display)) {
                              setBatchCategories((prev) => ({ ...prev, [batchId]: [...cats, display] }));
                            }
                            setCreatingNewByBatch((prev) => ({ ...prev, [batchId]: false }));
                          }}
                          disabled={saving || !(newCategoryInputByBatch[batchId]?.trim())}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          Use Category
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreatingNewByBatch((prev) => ({ ...prev, [batchId]: false }))}
                          disabled={saving}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                      {(() => {
                        const raw = newCategoryInputByBatch[batchId] ?? '';
                        if (!raw.trim()) return null;
                        const display = normalizeDisplay(raw);
                        const canonical = findCanonical(display, cats);
                        if (canonical) {
                          return <p className="text-xs text-amber-600">Matches existing &ldquo;{canonical}&rdquo; — will reuse that category.</p>;
                        }
                        return null;
                      })()}
                    </div>
                  )}
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
