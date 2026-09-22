'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  X,
  Loader2,
  Calendar,
  Clock,
  ChevronDown,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { getAllBatches, type Batch } from '@/lib/api/courses';
import { scheduleSession } from '@/lib/api/sessions';

interface ScheduleSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const formSchema = z.object({
  title: z.string().min(3, 'Meeting topic must be at least 3 characters'),
  startDate: z.string().min(1, 'Please select a date'),
  startTime: z.string().min(1, 'Please select a time'),
  duration: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

export function ScheduleSessionModal({
  isOpen,
  onClose,
  onSuccess,
}: ScheduleSessionModalProps) {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [durationHours, setDurationHours] = useState(1);
  const [durationMins, setDurationMins] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      startDate: '',
      startTime: '',
      duration: '60',
    },
  });

  const fetchBatches = useCallback(async () => {
    setLoadingBatches(true);
    setFetchError('');
    try {
      const result = await getAllBatches({ isActive: true, limit: 200 });
      setBatches(result.items);
    } catch {
      setFetchError('Failed to load batches');
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      reset();
      setSelectedBatchIds(new Set());
      setDropdownOpen(false);
      setFetchError('');
      setDurationHours(1);
      setDurationMins(0);
      fetchBatches();
    }
  }, [isOpen, reset, fetchBatches]);

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedBatchIds(new Set(batches.map((b) => b.id)));
  };

  const deselectAll = () => {
    setSelectedBatchIds(new Set());
  };

  const onSubmit = async (data: FormValues) => {
    if (selectedBatchIds.size === 0) {
      toast.error('Please select at least one batch');
      return;
    }

    try {
      const startTime = new Date(`${data.startDate}T${data.startTime}`);
      const totalDurationMinutes = durationHours * 60 + durationMins;
      const payload = {
        title: data.title,
        startTime: startTime.toISOString(),
        durationMinutes: totalDurationMinutes,
        batchIds: Array.from(selectedBatchIds),
      };
      await scheduleSession(payload);
      toast.success('Class scheduled successfully');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to schedule class');
    }
  };

  const selectedLabels = batches
    .filter((b) => selectedBatchIds.has(b.id))
    .map((b) => b.name);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto overscroll-contain"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90dvh] max-h-[90svh] overflow-y-auto overscroll-contain rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 sm:px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Schedule Live Class</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="flex items-center justify-center rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 min-h-[44px] min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-4 sm:px-6 py-5 space-y-5">
          {fetchError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {fetchError}
            </div>
          )}

          {/* Batch Multi-Select */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Batches <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-left focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
                  ) : batches.length === 0 ? (
                    <div className="py-4 text-center text-sm text-gray-400">
                      No active batches
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-2">
                        <button
                          type="button"
                          onClick={selectAll}
                          className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:text-brand-700 min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={deselectAll}
                          className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          Deselect All
                        </button>
                        <span className="ml-auto text-xs text-gray-400">
                          {selectedBatchIds.size} selected
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {batches.map((b) => (
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
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {selectedBatchIds.size === 0 && isSubmitting && (
              <p className="mt-1 text-xs text-red-500">Please select at least one batch</p>
            )}
          </div>

          {/* Meeting Topic */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Meeting Topic <span className="text-red-500">*</span>
            </label>
            <input
              {...register('title')}
              placeholder="e.g. Nifty Options Strategy"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>
            )}
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  {...register('startDate')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pl-10 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              </div>
              {errors.startDate && (
                <p className="mt-1 text-xs text-red-500">{errors.startDate.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Time <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="time"
                  {...register('startTime')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pl-10 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              </div>
              {errors.startTime && (
                <p className="mt-1 text-xs text-red-500">{errors.startTime.message}</p>
              )}
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Duration
            </label>
            <div className="grid grid-cols-2 gap-4">
              <select
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} hr{i + 1 > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
              <select
                value={durationMins}
                onChange={(e) => setDurationMins(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {m} min{m > 0 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Scheduling...' : 'Schedule Class'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
