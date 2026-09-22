import { getAllBatches } from '@/lib/api/courses';
import { BatchList } from '@/components/admin/batches/batch-list';

export const dynamic = 'force-dynamic';

export default async function AdminBatchesPage() {
  let batches: any[] = [];
  let total = 0;
  let loadError: string | null = null;

  try {
    const result = await getAllBatches({ isActive: false, page: 1, limit: 20 });
    batches = result.items;
    total = result.total;
  } catch (e: any) {
    loadError = e?.message || 'Failed to load batches.';
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-red-700">{loadError}</p>
        <p className="mt-1 text-xs text-red-600">This is a load error, not an empty list.</p>
        <a href="/admin/batches" className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-100">Retry</a>
      </div>
    );
  }

  return <BatchList initialBatches={batches} initialTotal={total} />;
}
