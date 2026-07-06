import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _db: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!_db) {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment',
      );
    }
    _db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}

export async function deleteTestData(db: SupabaseClient, ids: {
  recordingIds?: string[];
  batchIds?: string[];
  userIds?: string[];
  topicIds?: string[];
}) {
  const ops: Promise<unknown>[] = [];

  if (ids.recordingIds?.length) {
    ops.push(
      db.from('batch_recording_curriculum').delete().in('content_id', ids.recordingIds).eq('content_type', 'recording'),
      db.from('recording_batches').delete().in('recording_id', ids.recordingIds),
      db.from('video_progress').delete().in('video_id', ids.recordingIds),
      db.from('recordings').delete().in('id', ids.recordingIds),
    );
  }

  if (ids.batchIds?.length) {
    ops.push(
      db.from('batch_students').delete().in('batch_id', ids.batchIds),
      db.from('recording_batches').delete().in('batch_id', ids.batchIds),
      db.from('batches').delete().in('id', ids.batchIds),
    );
  }

  if (ids.topicIds?.length) {
    ops.push(
      db.from('topics').delete().in('id', ids.topicIds),
    );
  }

  await Promise.all(ops);
}

export async function findRecordingById(db: SupabaseClient, id: string) {
  const { data } = await db.from('recordings').select('*').eq('id', id).single();
  return data;
}

export async function findBatchLinks(db: SupabaseClient, recordingId: string) {
  const { data } = await db.from('recording_batches').select('batch_id').eq('recording_id', recordingId);
  return data ?? [];
}

export async function findCurriculumEntries(db: SupabaseClient, recordingId: string) {
  const { data } = await db
    .from('batch_recording_curriculum')
    .select('*')
    .eq('content_id', recordingId)
    .eq('content_type', 'recording');
  return data ?? [];
}

export async function findStudentAccessibleRecordings(
  db: SupabaseClient,
  userId: string,
) {
  const { data: memberships } = await db
    .from('batch_students')
    .select('batch_id')
    .eq('user_id', userId);

  const batchIds = (memberships ?? []).map((b: any) => b.batch_id);
  if (!batchIds.length) return [];

  const { data: links } = await db
    .from('recording_batches')
    .select('recording_id')
    .in('batch_id', batchIds);

  const recordingIds = [...new Set((links ?? []).map((l: any) => l.recording_id))];
  if (!recordingIds.length) return [];

  const { data: recordings } = await db
    .from('recordings')
    .select('*')
    .in('id', recordingIds);

  return recordings ?? [];
}

export async function findProgress(db: SupabaseClient, userId: string, recordingId: string) {
  const { data } = await db
    .from('video_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('video_id', recordingId)
    .maybeSingle();
  return data;
}

export async function createRecordingInDb(
  db: SupabaseClient,
  overrides?: {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    mux_asset_id?: string | null;
    mux_playback_id?: string | null;
    mux_upload_id?: string | null;
    duration_seconds?: number;
  },
): Promise<string> {
  const id = overrides?.id ?? crypto.randomUUID();
  await db.from('recordings').insert({
    id,
    title: overrides?.title ?? 'E2E-DB-Seeded',
    description: overrides?.description ?? 'Seeded directly for E2E test',
    status: overrides?.status ?? 'ready',
    mux_asset_id: overrides?.mux_asset_id ?? 'e2e-fake-asset-id',
    mux_playback_id: overrides?.mux_playback_id ?? 'e2e-fake-playback-id',
    mux_upload_id: overrides?.mux_upload_id ?? null,
    duration_seconds: overrides?.duration_seconds ?? 300,
  });
  return id;
}

export async function assignRecordingToBatch(
  db: SupabaseClient,
  recordingId: string,
  batchId: string,
): Promise<void> {
  await db.from('recording_batches').insert({
    recording_id: recordingId,
    batch_id: batchId,
  });
}

export async function countRecordings(db: SupabaseClient): Promise<number> {
  const { count } = await db.from('recordings').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

export async function deleteRecordings(db: SupabaseClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.from('batch_recording_curriculum').delete().in('content_id', ids).eq('content_type', 'recording');
  await db.from('recording_batches').delete().in('recording_id', ids);
  await db.from('video_progress').delete().in('video_id', ids);
  await db.from('recordings').delete().in('id', ids);
}

export async function createPlaybackEvent(
  db: SupabaseClient,
  overrides: {
    recordingId: string;
    userId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.from('playback_events').insert({
    id,
    recording_id: overrides.recordingId,
    user_id: overrides.userId,
    event_type: overrides.eventType,
    metadata: overrides.metadata ?? {},
    created_at: new Date().toISOString(),
  });
  return id;
}

export async function createPlaybackViolation(
  db: SupabaseClient,
  overrides: {
    recordingId: string;
    userId: string;
    violationType: string;
    details?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await db.from('playback_violations').insert({
    id,
    recording_id: overrides.recordingId,
    user_id: overrides.userId,
    violation_type: overrides.violationType,
    details: overrides.details ?? 'E2E test violation',
    created_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`createPlaybackViolation failed: ${error.message} (${JSON.stringify(error)})`);
  }
  return id;
}

export async function bulkCreateRecordings(
  db: SupabaseClient,
  count: number,
  batchId: string,
): Promise<string[]> {
  const ids: string[] = [];
  const recordings: Array<Record<string, unknown>> = [];
  const links: Array<Record<string, unknown>> = [];

  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    recordings.push({
      id,
      title: `E2E-Stress-Recording-${i}`,
      description: 'Seeded for stress test',
      status: 'ready',
      mux_asset_id: `e2e-stress-asset-${i}`,
      mux_playback_id: `e2e-stress-playback-${i}`,
      duration_seconds: 300,
    });
    links.push({ recording_id: id, batch_id: batchId });
  }

  await db.from('recordings').insert(recordings);
  await db.from('recording_batches').insert(links);
  return ids;
}

export async function getPlaybackEvents(
  db: SupabaseClient,
  recordingId?: string,
): Promise<any[]> {
  let query = db.from('playback_events').select('*');
  if (recordingId) {
    query = query.eq('recording_id', recordingId);
  }
  const { data } = await query;
  return data ?? [];
}

export async function getPlaybackViolations(
  db: SupabaseClient,
): Promise<any[]> {
  const { data } = await db.from('playback_violations').select('*');
  return data ?? [];
}
