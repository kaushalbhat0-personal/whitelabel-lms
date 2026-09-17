import { Card } from '@/components/ui/Card';

export default function StudentLoading() {
  return (
    <div className="space-y-6 px-4 md:px-0 py-4 md:py-8">
      <div className="animate-pulse rounded-card-lg bg-surface-muted h-32" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card padding="lg">
            <div className="h-4 w-24 rounded bg-surface-muted animate-pulse" />
            <div className="mt-3 h-5 w-3/4 rounded bg-surface-muted animate-pulse" />
            <div className="mt-3 h-2 w-full rounded bg-surface-muted animate-pulse" />
            <div className="mt-4 h-9 w-32 rounded-xl bg-surface-muted animate-pulse" />
          </Card>
          <Card padding="lg">
            <div className="h-4 w-20 rounded bg-surface-muted animate-pulse" />
            <div className="mt-3 h-5 w-2/3 rounded bg-surface-muted animate-pulse" />
          </Card>
        </div>
        <div className="space-y-6">
          <Card padding="lg">
            <div className="h-4 w-28 rounded bg-surface-muted animate-pulse" />
            <div className="mt-4 h-20 rounded bg-surface-muted animate-pulse" />
          </Card>
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4].map(i=>(
              <div key={i} className="rounded-card border border-surface-border bg-surface-card p-5">
                <div className="h-3 w-12 rounded bg-surface-muted animate-pulse" />
                <div className="mt-3 h-6 w-8 rounded bg-surface-muted animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
