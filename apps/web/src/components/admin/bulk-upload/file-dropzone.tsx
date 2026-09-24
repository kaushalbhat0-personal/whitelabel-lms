'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download, AlertCircle } from 'lucide-react';
import { uploadStudentsCsv, getJobStatus, type RowResult } from '@/lib/api/bulk-upload';
import { getAllBatches, type Batch } from '@/lib/api/courses';
import { API_ROUTES } from '@/lib/constants';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const POLL_INTERVAL = 2000;
const MAX_POLL_MS = 30000;

interface FileDropzoneProps {
  onUploadSuccess: () => void;
}

export function FileDropzone({ onUploadSuccess }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<{
    totalRows: number;
    successCount: number;
    failureCount: number;
    warningCount: number;
    results: RowResult[];
    failures: { email: string; error: string }[];
    destinationBatchLabel?: string;
  } | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;
  const selectedBatchLabel = selectedBatch
    ? `${selectedBatch.name} — ${selectedBatch.course?.name ?? 'Unknown course'}`
    : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBatchesLoading(true);
        setBatchesError('');
        const res = await getAllBatches({ isActive: true, limit: 200 });
        if (!cancelled) setBatches(res.items ?? []);
      } catch (err: any) {
        if (!cancelled) setBatchesError(err?.message || 'Failed to load batches');
      } finally {
        if (!cancelled) setBatchesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!selectedBatchId) {
        setError('Please select a destination batch before uploading.');
        return;
      }
      setError('');
      setSummary(null);
      setIsUploading(true);

      const allowedTypes = [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];

      if (!allowedTypes.includes(file.type) && !file.name.endsWith('.csv') && !file.name.endsWith('.xlsx')) {
        setError('Please upload a .csv or .xlsx file');
        setIsUploading(false);
        return;
      }

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('batchId', selectedBatchId);

        const { jobId, totalRows } = await uploadStudentsCsv(formData);

        // Poll for job results
        const pollStart = Date.now();
        let jobResult = await getJobStatus(jobId);

        while (
          jobResult &&
          jobResult.status === 'processing' &&
          Date.now() - pollStart < MAX_POLL_MS
        ) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          jobResult = await getJobStatus(jobId);
        }

        if (!jobResult) {
          setError('Upload job not found. Please refresh to check results.');
        } else if (jobResult.status === 'failed') {
          setError('Upload processing failed. Please try again.');
        } else if (jobResult.status === 'processing') {
          setError('Upload is taking longer than expected. Please refresh to check results.');
        } else {
          const warningCount = jobResult.results.filter((r: RowResult) => r.warning).length;
          setSummary({
            totalRows: jobResult.totalRows,
            successCount: jobResult.successCount,
            failureCount: jobResult.failureCount,
            warningCount,
            results: jobResult.results || [],
            failures: jobResult.failures || [],
            destinationBatchLabel: selectedBatchLabel,
          });
        }
      } catch (err: any) {
        setError(err.message || 'Upload failed');
      } finally {
        setIsUploading(false);
        onUploadSuccess();
      }
    },
    [onUploadSuccess, selectedBatchId, selectedBatchLabel],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      if (inputRef.current) inputRef.current.value = '';
    },
    [handleUpload],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Upload Students</h2>
        <a
          href={`${API_URL}${API_ROUTES.BULK_UPLOAD}/template`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Template
        </a>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-gray-500">
        Upload a CSV or Excel file with columns:{' '}
        <span className="inline-flex flex-wrap gap-1 align-middle">
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">Name</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">Email</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">Phone <span className="font-normal text-gray-500">optional</span></span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">Course Name <span className="font-normal text-gray-500">optional</span></span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">Batch Name <span className="font-normal text-gray-500">optional</span></span>
        </span>{' '}
        CSV batch/course columns are informational only when a destination batch is selected.
      </p>

      <div className="mb-4">
        <label htmlFor="bulk-destination-batch" className="block text-sm font-medium text-gray-700">
          Destination Batch <span className="text-red-500">*</span>
        </label>
        <select
          id="bulk-destination-batch"
          value={selectedBatchId}
          onChange={(e) => setSelectedBatchId(e.target.value)}
          disabled={batchesLoading}
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
          aria-label="Destination Batch"
        >
          <option value="">{batchesLoading ? 'Loading batches...' : 'Select destination batch'}</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} — {b.course?.name ?? 'Unknown course'}
            </option>
          ))}
        </select>
        {batchesLoading && <p className="mt-1 text-xs text-gray-400">Loading active batches...</p>}
        {batchesError && <p className="mt-1 text-xs text-red-600">{batchesError}</p>}
        {!batchesLoading && !batchesError && batches.length === 0 && (
          <p className="mt-1 text-xs text-amber-600">No active batches found. Create a batch first.</p>
        )}
        {selectedBatch && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Entire CSV will be imported to: {selectedBatchLabel}
          </p>
        )}
        {!selectedBatchId && !batchesLoading && batches.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">Select a batch to enable upload.</p>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!selectedBatchId) return;
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          if (!selectedBatchId) {
            e.preventDefault();
            setError('Please select a destination batch before uploading.');
            return;
          }
          onDrop(e);
        }}
        onClick={() => {
          if (!selectedBatchId) {
            setError('Please select a destination batch before uploading.');
            return;
          }
          inputRef.current?.click();
        }}
        role="button"
        tabIndex={selectedBatchId ? 0 : -1}
        aria-label="Upload CSV or Excel file"
        aria-disabled={!selectedBatchId}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && selectedBatchId) { e.preventDefault(); inputRef.current?.click(); } }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 sm:p-10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
          !selectedBatchId
            ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
            : isDragging
              ? 'cursor-pointer border-brand-500 bg-brand-50'
              : 'cursor-pointer border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={onFileSelect}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <p className="text-sm font-medium">Uploading & processing...</p>
          </div>
        ) : (
          <>
            <Upload className="mb-2 h-8 w-8 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">
              Drop your file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Supports .csv and .xlsx files
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          {summary.destinationBatchLabel && (
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Imported to: {summary.destinationBatchLabel}
            </div>
          )}
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
            <CheckCircle className="h-4 w-4 text-green-600" />
            Upload complete
          </div>
          <div className="grid grid-cols-4 gap-4 text-center text-sm">
            <div>
              <p className="text-lg font-bold text-gray-900">{summary.totalRows}</p>
              <p className="text-xs text-gray-500">Total Rows</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-600">
                {summary.successCount - summary.warningCount}
              </p>
              <p className="text-xs text-gray-500">Created</p>
            </div>
            <div>
              <p className="text-lg font-bold text-amber-600">
                {summary.warningCount}
              </p>
              <p className="text-xs text-gray-500">Warnings</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-600">
                {summary.failureCount}
              </p>
              <p className="text-xs text-gray-500">Failed</p>
            </div>
          </div>

          {summary.results.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-gray-200 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Row Details
              </p>
              {summary.results.map((r, i) => {
                if (r.status === 'failure') {
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-2.5 text-sm"
                    >
                      <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                      <div>
                        <p className="font-medium text-red-800">
                          Row {r.rowNumber} ({r.email})
                        </p>
                        <p className="text-red-600">{r.error}</p>
                      </div>
                    </div>
                  );
                }
                if (r.warning) {
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                      <div>
                        <p className="font-medium text-amber-800">
                          Row {r.rowNumber} ({r.email})
                        </p>
                        <p className="text-amber-600">{r.warning}</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
