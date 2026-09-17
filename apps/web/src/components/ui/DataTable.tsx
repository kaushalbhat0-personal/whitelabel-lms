'use client';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  emptyState?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyState,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setCanScroll(el.scrollWidth > el.clientWidth);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [data]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else if (sortDir === 'desc') {
        setSortKey(null);
        setSortDir(null);
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedData = [...data];
  if (sortKey && sortDir) {
    sortedData.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortKey];
      const bVal = (b as Record<string, unknown>)[sortKey];
      if (aVal == null || bVal == null) return 0;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortKey !== columnKey) return <ChevronsUpDown className="ml-1 h-3 w-3 flex-shrink-0" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="ml-1 h-3 w-3 flex-shrink-0" />
    ) : (
      <ChevronDown className="ml-1 h-3 w-3 flex-shrink-0" />
    );
  };

  if (data.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-surface-border">
        {emptyState ?? (
          <div className="flex items-center justify-center py-12 text-sm text-text-muted">
            No data available
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label="Table content, scroll horizontally to see more"
        className="overflow-x-auto overflow-y-hidden rounded-xl border border-surface-border scrollbar-thin overscroll-x-contain focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        {canScroll && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white via-white/80 to-transparent md:hidden" aria-hidden="true" />
        )}
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="bg-surface-muted">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'table-header',
                    col.sortable && 'cursor-pointer select-none hover:bg-surface-border',
                    col.className,
                  )}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center">
                    {col.header}
                    {col.sortable && <SortIcon columnKey={col.key} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((item) => (
              <tr
                key={keyExtractor(item)}
                className={cn('table-row', onRowClick && 'cursor-pointer')}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('table-cell', col.className)}>
                    {col.render
                      ? col.render(item)
                      : String((item as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canScroll && (
        <p className="mt-2 text-[11px] text-text-muted md:hidden">Scroll horizontally to see more →</p>
      )}
    </div>
  );
}
