import { getStudents } from '@/lib/api/users';
import { StudentsPageClient } from '@/components/admin/students/students-page-client';

export const dynamic = 'force-dynamic';

export default async function AdminStudentsPage() {
  let students: any[] = [];
  let total = 0;
  let loadError: string | null = null;

  try {
    const result = await getStudents();
    students = result.items;
    total = result.total;
  } catch (e: any) {
    loadError = e?.message || 'Failed to load students. Please refresh.';
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-red-700">{loadError}</p>
        <p className="mt-1 text-xs text-red-600">This is a load error, not an empty list. Check your connection and try again.</p>
        <a href="/admin/students" className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-100">Retry</a>
      </div>
    );
  }

  return (
    <StudentsPageClient
      initialStudents={students}
      initialTotal={total}
    />
  );
}
