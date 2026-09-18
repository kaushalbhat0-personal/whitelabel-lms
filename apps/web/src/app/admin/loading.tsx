import { AdminCardSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons';

export default function AdminLoading() {
  return (
    <div className="space-y-6">
      {/* Header placeholder — mirrors AdminPageHeader */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-7 w-48 rounded-lg bg-surface-border motion-safe:animate-pulse" />
          <div className="h-4 w-64 rounded bg-surface-muted motion-safe:animate-pulse" />
        </div>
        <div className="h-9 w-32 shrink-0 rounded-xl bg-surface-muted motion-safe:animate-pulse" />
      </div>

      {/* Stat cards placeholder — mirrors AdminSection + 3 StatCards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-surface-border bg-surface-card p-5 space-y-3">
            <div className="h-3 w-24 rounded bg-surface-muted motion-safe:animate-pulse" />
            <div className="h-7 w-16 rounded bg-surface-muted motion-safe:animate-pulse" />
            <div className="h-3 w-32 rounded bg-surface-muted motion-safe:animate-pulse" />
          </div>
        ))}
      </div>

      {/* Table placeholder */}
      <AdminTableSkeleton rows={5} cols={5} />
    </div>
  );
}
