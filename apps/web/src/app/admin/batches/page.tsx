import { getAllBatches } from '@/lib/api/courses';
import { BatchList } from '@/components/admin/batches/batch-list';

export const dynamic = 'force-dynamic';

export default async function AdminBatchesPage() {
  let batches: any[] = [];
  let total = 0;

  try {
    const result = await getAllBatches({ isActive: false, page: 1, limit: 20 });
    batches = result.items;
    total = result.total;
  } catch {
    // Render empty state
  }

  return <BatchList initialBatches={batches} initialTotal={total} />;
}
