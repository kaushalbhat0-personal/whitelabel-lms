'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AdminDataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T, index: number) => React.ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  width?: string;
}

interface AdminDataTableProps<T> {
  columns: AdminDataTableColumn<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  emptyState?: React.ReactNode;
  loading?: boolean;
  loadingRowCount?: number;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onRowClick?: (item: T) => void;
  bulkActions?: { label: string; onClick: (selected: T[]) => void; variant?: 'default' | 'danger' }[];
  exportCsv?: boolean;
  csvFilename?: string;
  csvHeaders?: string[];
  getCsvRow?: (item: T) => string[];
  showSearch?: boolean;
  showPagination?: boolean;
  searchKeys?: string[];
  className?: string;
}

export function AdminDataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyState,
  loading = false,
  loadingRowCount = 5,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  page = 1,
  pageSize = 20,
  total,
  onPageChange,
  onRowClick,
  bulkActions,
  exportCsv = false,
  csvFilename = 'export.csv',
  csvHeaders,
  getCsvRow,
  showSearch = true,
  showPagination = true,
  searchKeys,
  className,
}: AdminDataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!columnMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColumnMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [columnMenuOpen]);

  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.key));
  const allSelected = data.length > 0 && data.every((item) => selectedIds.has(keyExtractor(item)));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map(keyExtractor)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sortedData = useMemo(() => {
    let arr = [...data];
    const query = (searchValue ?? '').trim().toLowerCase();
    if (query && searchKeys && searchKeys.length > 0) {
      arr = arr.filter((item) =>
        searchKeys.some((key) =>
          String((item as Record<string, unknown>)[key] ?? '').toLowerCase().includes(query),
        ),
      );
    }
    if (sortKey && sortDir) {
      arr.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortKey];
        const bVal = (b as Record<string, unknown>)[sortKey];
        if (aVal == null || bVal == null) return 0;
        const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return arr;
  }, [data, sortKey, sortDir, searchValue, searchKeys]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortKey(key);
        setSortDir('desc');
      } else if (sortDir === 'desc') {
        setSortKey(null);
        setSortDir(null);
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey, sortDir]);

  const handleExportCsv = () => {
    if (!getCsvRow) return;
    const headers = csvHeaders ?? columns.map((c) => c.header);
    const rows = data.map(getCsvRow);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = total ? Math.ceil(total / pageSize) : 1;

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortKey !== columnKey) return <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40 group-hover:opacity-100" />;
    return sortDir === 'asc'
      ? <ChevronUp className="ml-1 h-3 w-3 shrink-0 text-brand-600" />
      : sortDir === 'desc'
        ? <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-brand-600" />
        : <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />;
  };

  const toolbarVisible = showSearch || bulkActions || exportCsv || columns.length > 0;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Toolbar */}
      {toolbarVisible && (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch && onSearchChange && (
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
              <input
                type="text"
                value={searchValue ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-xl border border-surface-border bg-white pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              />
            </div>
          )}

          {bulkActions && selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">{selectedIds.size} selected</span>
              {bulkActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    const selected = data.filter((d) => selectedIds.has(keyExtractor(d)));
                    action.onClick(selected);
                    setSelectedIds(new Set());
                  }}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    action.variant === 'danger'
                      ? 'bg-red-50 text-red-600 hover:bg-red-100'
                      : 'bg-brand-50 text-brand-600 hover:bg-brand-100',
                  )}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {exportCsv && (
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors min-h-[44px]"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setColumnMenuOpen(!columnMenuOpen)}
              aria-expanded={columnMenuOpen}
              aria-haspopup="true"
              className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted transition-colors min-h-[44px]"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Columns
            </button>
            {columnMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColumnMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-xl border border-surface-border bg-white shadow-lg py-1">
                  {columns.map((col) => (
                    <button
                      key={col.key}
                      onClick={() => {
                        setHiddenColumns((prev) => {
                          const next = new Set(prev);
                          if (next.has(col.key)) next.delete(col.key); else next.add(col.key);
                          return next;
                        });
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-surface-muted transition-colors"
                    >
                      {hiddenColumns.has(col.key) ? (
                        <Square className="h-3.5 w-3.5 text-text-muted" />
                      ) : (
                        <CheckSquare className="h-3.5 w-3.5 text-brand-600" />
                      )}
                      {col.header}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div
        className="overflow-x-auto rounded-xl border border-surface-border bg-surface-card scrollbar-thin"
        role="region"
        aria-label="Data table"
        tabIndex={0}
      >
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-surface-muted">
              {bulkActions && (
                <th className="px-2 py-2 w-12">
                  <button
                    onClick={toggleSelectAll}
                    aria-label="Select all rows"
                    className="flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] hover:bg-surface-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 transition-colors"
                  >
                    {allSelected ? <CheckSquare className="h-4 w-4 text-brand-600" aria-hidden="true" /> : <Square className="h-4 w-4 text-text-muted" aria-hidden="true" />}
                  </button>
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted group',
                    col.sortable && 'cursor-pointer select-none hover:bg-surface-border/50',
                    col.className,
                    col.hideOnMobile && 'hidden md:table-cell',
                  )}
                  style={col.width ? { width: col.width } : undefined}
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
          <tbody className="divide-y divide-surface-border">
            {loading
              ? Array.from({ length: loadingRowCount }).map((_, i) => (
                  <tr key={i}>
                    {bulkActions && <td className="px-3 py-3"><div className="h-4 w-4 rounded bg-surface-muted animate-pulse" /></td>}
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={cn('px-4 py-3', col.hideOnMobile && 'hidden md:table-cell')}>
                        <div className="h-4 rounded bg-surface-muted animate-pulse w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : sortedData.length === 0
                ? (
                    <tr>
                      <td colSpan={visibleColumns.length + (bulkActions ? 1 : 0)} className="px-4 py-16">
                        {emptyState ?? (
                          <div className="text-center">
                            <p className="text-sm text-text-muted">No data available</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                : sortedData.map((item, index) => (
                    <tr
                      key={keyExtractor(item)}
                      className={cn(
                        'transition-colors',
                        selectedIds.has(keyExtractor(item)) ? 'bg-brand-50/30' : 'hover:bg-surface-muted/50',
                        onRowClick && 'cursor-pointer',
                      )}
                      onClick={onRowClick ? () => onRowClick(item) : undefined}
                    >
                      {bulkActions && (
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => toggleSelect(keyExtractor(item))}
                            aria-label={`Select row ${keyExtractor(item)}`}
                            className="flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] hover:bg-surface-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 transition-colors"
                          >
                            {selectedIds.has(keyExtractor(item)) ? <CheckSquare className="h-4 w-4 text-brand-600" aria-hidden="true" /> : <Square className="h-4 w-4 text-text-muted" aria-hidden="true" />}
                          </button>
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td key={col.key} className={cn('px-4 py-3 text-sm text-text-secondary', col.hideOnMobile && 'hidden md:table-cell', col.className)}>
                          {col.render ? col.render(item, index) : String((item as Record<string, unknown>)[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {showPagination && total && totalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-surface-border bg-white px-5 py-3">
          <p className="text-xs text-text-muted">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange?.(Math.max(1, page - 1))}
              disabled={page <= 1}
              className={cn(
                'flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors min-h-[44px]',
                page <= 1
                  ? 'border-surface-border text-text-muted cursor-not-allowed'
                  : 'border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary',
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => onPageChange?.(p)}
                  className={cn(
                    'flex items-center justify-center min-h-[44px] min-w-[44px] w-11 h-11 rounded-lg text-xs font-medium transition-colors',
                    p === page
                      ? 'bg-brand-600 text-white'
                      : 'text-text-secondary hover:bg-surface-muted',
                  )}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className={cn(
                'flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors min-h-[44px]',
                page >= totalPages
                  ? 'border-surface-border text-text-muted cursor-not-allowed'
                  : 'border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary',
              )}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
