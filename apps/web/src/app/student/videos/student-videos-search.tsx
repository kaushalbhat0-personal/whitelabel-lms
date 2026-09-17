'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

export function StudentVideoSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get('search') ?? '';
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    const t = setTimeout(() => {
      const current = searchParams.get('search') ?? '';
      if (value === current) return;
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set('search', value.trim());
      else params.delete('search');
      const q = params.toString();
      router.replace(`/student/videos${q ? `?${q}` : ''}`);
    }, 300);
    return () => clearTimeout(t);
  }, [value, router, searchParams]);

  const clear = () => {
    setValue('');
    router.replace('/student/videos');
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <label htmlFor="video-search" className="sr-only">
          Search recordings
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input
          id="video-search"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by title or description"
          className="w-full rounded-xl border border-surface-border bg-white py-2.5 pl-9 pr-9 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
