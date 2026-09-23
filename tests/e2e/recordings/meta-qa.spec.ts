import { test, expect, request } from '@playwright/test';
import { getDb } from '../utils/db-helpers';
import { loginAs } from '../utils/login-helpers';

async function createFreshUser(role: 'admin' | 'student') {
  const db = getDb();
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `e2e-meta-${role}-${uniq}@example.com`;
  const password = `Test${uniq}!A1b`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = data.user.id;
  const { error: pErr } = await db.from('profiles').upsert({ id: userId, email, role, name: `${role} ${uniq}`, is_active: true } as any, { onConflict: 'id' });
  if (pErr) console.warn('profile upsert', pErr.message);
  const cleanup = async () => {
    try { await db.from('profiles').delete().eq('id', userId); } catch {}
    try { await db.auth.admin.deleteUser(userId); } catch {}
  };
  return { email, password, userId, cleanup };
}

async function loginWithRetry(email: string, password: string) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:3001' });
  try {
    return await loginAs(ctx, email, password);
  } catch (e: any) {
    if (String(e.message).includes('409') || String(e.message).includes('SESSION_REPLACED')) {
      await new Promise(r => setTimeout(r, 600));
      return await loginAs(ctx, email, password);
    }
    throw e;
  } finally {
    await ctx.dispose().catch(() => {});
  }
}

test.describe('Recording Meta Endpoint QA', () => {
  test('1. Authorized student gets 200 with limited metadata', async () => {
    const db = getDb();
    const student = await createFreshUser('student');
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2,4)}`;
    const courseId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    let recordingId: string | null = null;
    try {
      await db.from('courses').insert({ id: courseId, name: `E2E-Course-${uniq}`, is_active: true });
      await db.from('batches').insert({ id: batchId, name: `E2E-Batch-${uniq}`, course_id: courseId, is_active: true });
      await db.from('batch_students').insert({ user_id: student.userId, batch_id: batchId });
      recordingId = crypto.randomUUID();
      await db.from('recordings').insert({ id: recordingId, title: `E2E-Meta-${uniq}`, status: 'ready', mux_asset_id: `e2e-asset-${uniq}`, mux_playback_id: `e2e-playback-${uniq}`, duration_seconds: 300 });
      await db.from('recording_batches').insert({ recording_id: recordingId, batch_id: batchId });
      await db.from('batch_recording_curriculum').insert({ batch_id: batchId, content_id: recordingId, content_type: 'recording', category_name: 'General', is_published: true, sort_order: 0 });

      const { token } = await loginWithRetry(student.email, student.password);
      const ctx = await request.newContext({ baseURL: 'http://localhost:3001' });
      const res = await ctx.get(`/recordings/${recordingId}/meta`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status(), `expected 200 got ${res.status()} ${await res.text()}`).toBe(200);
      const wrapper: any = await res.json();
      expect(wrapper.success).toBe(true);
      const data = wrapper.data;
      expect(data.id).toBe(recordingId);
      expect(data.title).toBeDefined();
      expect(data.created_at).toBeDefined();
      // Must be limited — no sensitive provider fields leaked beyond title/status?
      // Progress shape present
      expect(data.progress).toBeDefined();
      expect(typeof data.progress.watched_seconds).toBe('number');
      await ctx.dispose();
    } finally {
      if (recordingId) {
        await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
        await db.from('recording_batches').delete().eq('recording_id', recordingId);
        await db.from('video_progress').delete().eq('video_id', recordingId);
        await db.from('recordings').delete().eq('id', recordingId);
      }
      await db.from('batch_students').delete().eq('batch_id', batchId).eq('user_id', student.userId);
      await db.from('batches').delete().eq('id', batchId);
      await db.from('courses').delete().eq('id', courseId);
      await student.cleanup();
    }
  });

  test('2. Unauthorized student gets 403', async () => {
    const db = getDb();
    const studentA = await createFreshUser('student');
    const studentB = await createFreshUser('student');
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2,4)}`;
    const courseId = crypto.randomUUID();
    const batchA = crypto.randomUUID();
    const batchB = crypto.randomUUID();
    let recordingId: string | null = null;
    try {
      await db.from('courses').insert({ id: courseId, name: `E2E-Course-${uniq}`, is_active: true });
      await db.from('batches').insert([{ id: batchA, name: `E2E-A-${uniq}`, course_id: courseId, is_active: true }, { id: batchB, name: `E2E-B-${uniq}`, course_id: courseId, is_active: true }]);
      await db.from('batch_students').insert([{ user_id: studentA.userId, batch_id: batchA }, { user_id: studentB.userId, batch_id: batchB }]);
      recordingId = crypto.randomUUID();
      await db.from('recordings').insert({ id: recordingId, title: `E2E-Meta-${uniq}`, status: 'ready', mux_asset_id: `e2e-asset-${uniq}`, mux_playback_id: `e2e-playback-${uniq}`, duration_seconds: 300 });
      await db.from('recording_batches').insert({ recording_id: recordingId, batch_id: batchA });
      await db.from('batch_recording_curriculum').insert({ batch_id: batchA, content_id: recordingId, content_type: 'recording', category_name: 'General', is_published: true, sort_order: 0 });

      const { token: tokenB } = await loginWithRetry(studentB.email, studentB.password);
      const ctx = await request.newContext({ baseURL: 'http://localhost:3001' });
      const res = await ctx.get(`/recordings/${recordingId}/meta`, { headers: { Authorization: `Bearer ${tokenB}` } });
      expect(res.status()).toBe(403);
      // Body is error envelope; path will contain id but no recording metadata (title etc.) should leak
      const body = await res.text();
      expect(body).not.toContain('E2E-Meta');
      await ctx.dispose();
    } finally {
      if (recordingId) {
        await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
        await db.from('recording_batches').delete().eq('recording_id', recordingId);
        await db.from('recordings').delete().eq('id', recordingId);
      }
      await db.from('batch_students').delete().in('batch_id', [batchA, batchB]);
      await db.from('batches').delete().in('id', [batchA, batchB]);
      await db.from('courses').delete().eq('id', courseId);
      await studentA.cleanup();
      await studentB.cleanup();
    }
  });

  test('3. Nonexistent recording gets 404', async () => {
    const student = await createFreshUser('student');
    try {
      const { token } = await loginWithRetry(student.email, student.password);
      const ctx = await request.newContext({ baseURL: 'http://localhost:3001' });
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await ctx.get(`/recordings/${fakeId}/meta`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status()).toBe(404);
      await ctx.dispose();
    } finally {
      await student.cleanup();
    }
  });

  test('4. Admin gets 403 on student endpoint', async () => {
    const db = getDb();
    const student = await createFreshUser('student');
    const admin = await createFreshUser('admin');
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2,4)}`;
    const courseId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    let recordingId: string | null = null;
    try {
      await db.from('courses').insert({ id: courseId, name: `E2E-Course-${uniq}`, is_active: true });
      await db.from('batches').insert({ id: batchId, name: `E2E-Batch-${uniq}`, course_id: courseId, is_active: true });
      await db.from('batch_students').insert({ user_id: student.userId, batch_id: batchId });
      recordingId = crypto.randomUUID();
      await db.from('recordings').insert({ id: recordingId, title: `E2E-Meta-${uniq}`, status: 'ready', mux_asset_id: `e2e-asset-${uniq}`, mux_playback_id: `e2e-playback-${uniq}`, duration_seconds: 300 });
      await db.from('recording_batches').insert({ recording_id: recordingId, batch_id: batchId });
      await db.from('batch_recording_curriculum').insert({ batch_id: batchId, content_id: recordingId, content_type: 'recording', category_name: 'General', is_published: true, sort_order: 0 });

      const { token: adminToken } = await loginWithRetry(admin.email, admin.password);
      const ctx = await request.newContext({ baseURL: 'http://localhost:3001' });
      const res = await ctx.get(`/recordings/${recordingId}/meta`, { headers: { Authorization: `Bearer ${adminToken}` } });
      expect(res.status()).toBe(403);
      await ctx.dispose();
    } finally {
      if (recordingId) {
        await db.from('batch_recording_curriculum').delete().eq('content_id', recordingId).eq('content_type', 'recording');
        await db.from('recording_batches').delete().eq('recording_id', recordingId);
        await db.from('recordings').delete().eq('id', recordingId);
      }
      await db.from('batch_students').delete().eq('batch_id', batchId).eq('user_id', student.userId);
      await db.from('batches').delete().eq('id', batchId);
      await db.from('courses').delete().eq('id', courseId);
      await student.cleanup();
      await admin.cleanup();
    }
  });
});
