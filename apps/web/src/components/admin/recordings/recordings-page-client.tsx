'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Video, BarChart3, Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { type AdminVideo, type Topic, getAdminVideos } from '@/lib/api/videos';
import { getAllBatches, type Batch } from '@/lib/api/courses';
import { AdminPageHeader } from '@/components/shared/AdminPageHeader';
import { AdminSection } from '@/components/shared/AdminSection';
import { AdminStatCard } from '@/components/shared/AdminStatCard';
import { RecordingsTable } from './recordings-table';
import { ManualUploadButton } from './manual-upload-button';

interface RecordingsPageClientProps {
  initialVideos: AdminVideo[];
  total: number;
  topics: Topic[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
];

const PUBLISHED_OPTIONS = [
  { value: '', label: 'All (assigned or not)' },
  { value: 'true', label: 'Published (assigned to batches)' },
  { value: 'false', label: 'Unpublished (no batch)' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

const PAGE_SIZES = [10, 25, 50, 100];

const selectClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

export function RecordingsPageClient({ initialVideos, total, topics }: RecordingsPageClientProps) {
  const [videos, setVideos] = useState<AdminVideo[]>(initialVideos);
  const [videoCount, setVideoCount] = useState(total);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [topicId, setTopicId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [published, setPublished] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const inFlight = useRef(0);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, topicId, batchId, published, sort, pageSize]);

  // Load batches for the batch filter
  useEffect(() => {
    let active = true;
    getAllBatches({ isActive: true, limit: 200 })
      .then((r) => { if (active) setBatches(r.items); })
      .catch(() => { /* filter dropdown just stays empty */ });
    return () => { active = false; };
  }, []);

  // Fetch recordings (guards against race conditions)
  useEffect(() => {
    const reqId = ++inFlight.current;
    setLoading(true);
    setFetchError('');
    getAdminVideos({
      search: debouncedSearch || undefined,
      status: status || undefined,
      topicId: topicId || undefined,
      batchId: batchId || undefined,
      published: published || undefined,
      sort: sort || undefined,
      page,
      limit: pageSize,
    })
      .then((r) => {
        if (inFlight.current !== reqId) return;
        setVideos(r.items);
        setVideoCount(r.total);
      })
      .catch(() => {
        if (inFlight.current !== reqId) return;
        setFetchError('Failed to load recordings. Please try again.');
      })
      .finally(() => {
        if (inFlight.current === reqId) setLoading(false);
      });
  }, [debouncedSearch, status, topicId, batchId, published, sort, page, pageSize, reloadToken]);

  const refreshVideos = useCallback(() => {
    // Re-fetch current view after a mutation (e.g. new upload)
    setReloadToken((t) => t + 1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(videoCount / pageSize));
  const startIdx = videoCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, videoCount);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Recordings" description="Manage auto-imported Zoom recordings and manually uploaded videos." actions={<ManualUploadButton onUploadComplete={refreshVideos} />} />

      <AdminSection title="Overview">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AdminStatCard label="Total Recordings" value={videoCount} icon={Video} iconColor="bg-brand-50 text-brand-600" />
          <AdminStatCard label="Topics" value={topics.length} icon={BarChart3} iconColor="bg-blue-50 text-blue-600" />
        </div>
      </AdminSection>

      <AdminSection title="Recordings">
        {/* Filter bar */}
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className={selectClass}>
            <option value="">All topics</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={published} onChange={(e) => setPublished(e.target.value)} className={selectClass}>
            {PUBLISHED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={selectClass}>
            <option value="">All batches</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectClass}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {fetchError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{fetchError}</div>
        )}

        {loading && videos.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl border bg-white py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <RecordingsTable initialVideos={videos} total={videoCount} topics={topics} loading={loading} onChanged={refreshVideos} />
        )}

        {/* Pagination */}
        {videoCount > 0 && (
          <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-gray-100 pt-4 sm:flex-row">
            <p className="text-sm text-gray-500">
              Showing <span className="font-medium text-gray-900">{startIdx}</span>–<span className="font-medium text-gray-900">{endIdx}</span> of{' '}
              <span className="font-medium text-gray-900">{videoCount}</span>
            </p>
            <div className="flex items-center gap-3">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className={selectClass}
                title="Rows per page"
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
              </select>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <span className="px-2 text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </AdminSection>
    </div>
  );
}
