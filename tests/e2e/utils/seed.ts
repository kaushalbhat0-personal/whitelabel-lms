import { getDb } from './db-helpers';
import { nextSeq } from './counter';

export interface SeedContext {
  batchAId: string;
  batchBId: string;
  topicId: string;
  courseId: string;
}

export async function seedTestData(): Promise<SeedContext> {
  const db = getDb();
  const seq = nextSeq();

  const courseId = crypto.randomUUID();
  const batchAId = crypto.randomUUID();
  const batchBId = crypto.randomUUID();
  const topicId = crypto.randomUUID();

  const { error: courseError } = await db.from('courses').insert({
    id: courseId,
    name: `E2E-Course-${String(seq).padStart(3, '0')}`,
    description: 'E2E test course',
    is_active: true,
  });
  if (courseError) {
    console.error('Failed to create course:', courseError.message);
  }

  const { error: topicError } = await db.from('topics').insert({
    id: topicId,
    name: `E2E-Topic-${String(seq).padStart(3, '0')}`,
    sort_order: 0,
  });
  if (topicError) {
    console.error('Failed to create topic:', topicError.message);
  }

  const { error: batchError } = await db.from('batches').insert([
    { id: batchAId, name: `E2E-Batch-A-${String(seq).padStart(3, '0')}`, description: 'Test batch A', is_active: true, course_id: courseId },
    { id: batchBId, name: `E2E-Batch-B-${String(seq).padStart(3, '0')}`, description: 'Test batch B', is_active: true, course_id: courseId },
  ]);
  if (batchError) {
    console.error('Failed to create batches:', batchError.message);
  }

  return { batchAId, batchBId, topicId, courseId };
}

export async function enrollStudentInBatch(
  db: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  batchId: string,
): Promise<void> {
  await db.from('batch_students').insert({
    user_id: userId,
    batch_id: batchId,
  });
}

export async function teardownTestData(context: SeedContext): Promise<void> {
  const db = getDb();

  await Promise.all([
    db.from('batch_students').delete().in('batch_id', [context.batchAId, context.batchBId]),
    db.from('batches').delete().in('id', [context.batchAId, context.batchBId]),
    db.from('topics').delete().eq('id', context.topicId),
    db.from('courses').delete().eq('id', context.courseId),
  ]);
}
