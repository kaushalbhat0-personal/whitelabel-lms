'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  Upload,
  FileVideo,
  Loader2,
  CheckCircle,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { getAllBatches, type Batch } from '@/lib/api/courses';
import { createRecording } from '@/lib/api/recordings';
import { tusUpload } from '@/lib/upload/tus-uploader';

interface UploadRecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type UploadPhase =
  | { phase: 'idle' }
  | { phase: 'requesting_url' }
  | { phase: 'uploading'; progress: number }
  | { phase: 'success' }
  | { phase: 'error'; message: string };

const ACCEPTED_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
];

export function UploadRecordingModal({
  isOpen,
  onClose,
  onComplete,
}: UploadRecordingModalProps) {
  const router = useRouter();
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('General');
  const [moduleName, setModuleName] = useState('');
  const [displayTitle, setDisplayTitle] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [phase, setPhase] = useState<UploadPhase>({ phase: 'idle' });

  const fetchBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const result = await getAllBatches({ isActive: true, limit: 200 });
      setBatches(result.items);
    } catch {
      // silent
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setFile(null);
      setSelectedBatchIds(new Set());
      setDropdownOpen(false);
      setCategoryName('General');
      setModuleName('');
      setDisplayTitle('');
      setIsPublished(true);
      setPhase({ phase: 'idle' });
      fetchBatches();
    }
  }, [isOpen, fetchBatches]);

  const handleClose = () => {
    if (phase.phase === 'uploading') {
      xhrRef.current?.abort();
    }
    onClose();
  };

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedBatchIds(new Set(batches.map((b) => b.id)));
  const deselectAll = () => setSelectedBatchIds(new Set());

  const isValid = title.trim().length >= 2 && file !== null && selectedBatchIds.size > 0;

  const handleSubmit = async () => {
    if (!file || !isValid) return;

    setPhase({ phase: 'requesting_url' });

    try {
      const { uploadUrl, upload } = await createRecording(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          batchIds: Array.from(selectedBatchIds),
          categoryName: categoryName.trim() || undefined,
          moduleName: moduleName.trim() || undefined,
          isPublished,
          titleOverride: displayTitle.trim() || undefined,
        },
      );

      setPhase({ phase: 'uploading', progress: 0 });

      // Phase 7E: the API returns a protocol handle. Bunny uses resumable TUS
      // (its raw PUT endpoint requires the secret AccessKey header and can
      // never be browser-facing); legacy handles stay plain XHR PUT.
      if (upload?.kind === 'tus') {
        await tusUpload({
          endpoint: upload.url,
          headers: upload.headers ?? {},
          file,
          onProgress: (fraction) =>
            setPhase({ phase: 'uploading', progress: Math.round(fraction * 100) }),
          registerXhr: (xhr) => {
            xhrRef.current = xhr;
          },
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setPhase({ phase: 'uploading', progress: Math.round((e.loaded / e.total) * 100) });
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed with status ${xhr.status}`));
          });

          xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
          xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });
      }

      setPhase({ phase: 'success' });
      toast.success('Recording uploaded successfully');
      setTimeout(() => {
        onComplete();
        router.refresh();
      }, 2000);
    } catch (err: any) {
      setPhase({ phase: 'error', message: err.message || 'Upload failed' });
    }
  };

  const isSubmitting =
    phase.phase === 'requesting_url' ||
    phase.phase === 'uploading';

  const selectedLabels = batches
    .filter((b) => selectedBatchIds.has(b.id))
    .map((b) => b.name);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl md:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 sm:px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Upload Recording</h2>
          <button onClick={handleClose} aria-label="Close dialog" className="flex items-center justify-center rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 min-h-[44px] min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Nifty Breakout Strategy"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              rows={3}
              placeholder="Optional notes about this recording..."
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            />
          </div>

          {/* File picker */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Video File <span className="text-red-500">*</span>
            </label>
            <label
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 transition-colors ${
                isSubmitting
                  ? 'cursor-not-allowed border-gray-200 bg-gray-50'
                  : 'border-gray-300 hover:border-brand-400 hover:bg-brand-50/30'
              }`}
            >
              {file ? (
                <div className="flex items-center gap-3">
                  <FileVideo className="h-8 w-8 text-brand-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 h-8 w-8 text-gray-400" />
                  <p className="text-sm font-medium text-gray-600">Click to select a video file</p>
                  <p className="mt-1 text-xs text-gray-400">MP4, MOV, AVI, MKV, or WebM</p>
                </>
              )}
              <input
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                disabled={isSubmitting}
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {/* Batches multi-select */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Assign to Batches <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                disabled={isSubmitting}
                className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-left focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
              >
                <span className={selectedLabels.length === 0 ? 'text-gray-400' : 'text-gray-900'}>
                  {selectedLabels.length === 0
                    ? loadingBatches
                      ? 'Loading batches...'
                      : 'Select batches...'
                    : selectedLabels.join(', ')}
                </span>
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                  {loadingBatches ? (
                    <div className="flex items-center justify-center py-4 text-sm text-gray-400">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-2">
                        <button type="button" onClick={selectAll} className="text-xs font-medium text-brand-600 hover:text-brand-700">Select All</button>
                        <button type="button" onClick={deselectAll} className="text-xs font-medium text-gray-500 hover:text-gray-700">Deselect All</button>
                        <span className="ml-auto text-xs text-gray-400">{selectedBatchIds.size} selected</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {batches.map((b) => (
                          <label key={b.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={selectedBatchIds.has(b.id)}
                              onChange={() => toggleBatch(b.id)}
                              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-gray-700">{b.name}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Category
            </label>
            <input
              type="text"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Week 1, Module 2"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            />
          </div>

          {/* Module */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Module
            </label>
            <input
              type="text"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Core Concepts"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            />
          </div>

          {/* Display Title */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Display Title <span className="text-xs text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={displayTitle}
              onChange={(e) => setDisplayTitle(e.target.value)}
              disabled={isSubmitting}
              placeholder="Leave blank to use the recording title"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            />
            <p className="mt-1 text-xs text-gray-400">Per-batch override. Curriculum shows this title instead of the recording title.</p>
          </div>

          {/* Publish toggle */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="publish-toggle"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="publish-toggle" className="text-sm font-medium text-gray-700">
              Publish immediately
            </label>
          </div>

          {/* Progress / Status */}
          {phase.phase === 'requesting_url' && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              Requesting upload URL...
            </div>
          )}

          {phase.phase === 'uploading' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Uploading video...</span>
                <span className="font-semibold text-brand-600">{phase.progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-2.5 rounded-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${phase.progress}%` }}
                />
              </div>
            </div>
          )}

          {phase.phase === 'success' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Recording uploaded and linked to batches!
            </div>
          )}

          {phase.phase === 'error' && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {phase.message}
            </div>
          )}

          </div>

        {/* Footer — fixed, always visible */}
        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-200 bg-white px-4 sm:px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {phase.phase === 'uploading' ? 'Cancel' : 'Close'}
          </button>
          {phase.phase !== 'success' && (
            <button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
              className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {phase.phase === 'requesting_url'
                ? 'Requesting...'
                : phase.phase === 'uploading'
                  ? `Uploading ${phase.progress}%`
                  : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload & Assign
                    </>
                  )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
