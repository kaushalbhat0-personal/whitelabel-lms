import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface StudentVideo {
  id: string;
  title: string;
  description?: string;
  topic_id?: string;
  sort_order: number;
  status: string;
  created_at: string;
  topics?: { name: string } | null;
  progress: {
    watched_seconds: number;
    completed: boolean;
    last_watched_at: string | null;
  };
}

export interface AdminVideo {
  id: string;
  title: string;
  description?: string;
  topic_id?: string;
  mux_playback_id?: string;
  mux_asset_id?: string;
  sort_order: number;
  status: string;
  duration_seconds?: number;
  created_at: string;
  topics?: { name: string } | null;
  recording_batches?: {
    batch_id: string;
    batches?: { name: string } | null;
  }[];
}

export interface Topic {
  id: string;
  name: string;
  description?: string;
  sort_order: number;
  recordings?: { count: number }[];
}

export interface AdminVideosResponse {
  items: AdminVideo[];
  total: number;
  page: number;
  limit: number;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  recording: { id: string; title: string; status: string; created_at: string };
}

export interface PlaybackResponse {
  url: string;
  thumbnail: string;
  sessionId: string;
  expiresAt: string;
}

export interface GroupedRecordingProgress {
  watchedSeconds: number;
  completed: boolean;
  lastWatchedAt: string | null;
}

export interface GroupedRecording {
  id: string;
  title: string;
  description?: string;
  muxPlaybackId?: string;
  durationSeconds?: number;
  sortOrder: number;
  createdAt: string;
  progress: GroupedRecordingProgress;
}

export interface StudentSection {
  sectionName: string | null;
  recordings: GroupedRecording[];
}

export interface StudentBatchRecordings {
  batchId: string;
  batchName: string;
  sections: StudentSection[];
}

export async function getAdminVideos(params?: {
  topicId?: string;
  search?: string;
  status?: string;
  batchId?: string;
  published?: string;
  sort?: string;
  page?: number;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.topicId) searchParams.set('topicId', params.topicId);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.batchId) searchParams.set('batchId', params.batchId);
  if (params?.published) searchParams.set('published', params.published);
  if (params?.sort) searchParams.set('sort', params.sort);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<AdminVideosResponse>(
    `${API_ROUTES.ADMIN_RECORDINGS}/all${query ? `?${query}` : ''}`,
  );
}

export async function assignRecordingToBatches(
  recordingId: string,
  batchIds: string[],
) {
  return fetchApi<{ assignedCount: number }>(
    `${API_ROUTES.ADMIN_RECORDINGS}/${recordingId}/batches`,
    { method: 'POST', body: JSON.stringify({ batchIds }) },
  );
}

export async function removeRecordingFromBatches(
  recordingId: string,
  batchIds: string[],
) {
  return fetchApi<{ removedCount: number }>(
    `${API_ROUTES.ADMIN_RECORDINGS}/${recordingId}/batches`,
    { method: 'DELETE', body: JSON.stringify({ batchIds }) },
  );
}

export async function updateRecordingBatchCurriculum(
  recordingId: string,
  assignments: { batchId: string; assigned: boolean }[],
) {
  return fetchApi<{ updated: boolean }>(
    `${API_ROUTES.ADMIN_RECORDINGS}/${recordingId}/batch-curriculum`,
    { method: 'PATCH', body: JSON.stringify({ assignments }) },
  );
}

export async function getVideoTopics() {
  return fetchApi<Topic[]>(`${API_ROUTES.ADMIN_TOPICS}`);
}

export async function getMuxUploadUrl(title: string) {
  return fetchApi<UploadUrlResponse>(`${API_ROUTES.ADMIN_UPLOAD_URL}`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function updateVideoMetadata(
  videoId: string,
  data: { title?: string; description?: string; topicId?: string | null },
) {
  return fetchApi<AdminVideo>(`${API_ROUTES.ADMIN_RECORDINGS}/${videoId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteVideo(videoId: string) {
  return fetchApi<{ deleted: boolean }>(`${API_ROUTES.ADMIN_RECORDINGS}/${videoId}`, {
    method: 'DELETE',
  });
}

export async function bulkDeleteVideos(recordingIds: string[]) {
  return fetchApi<{ deleted: string[]; failed: { id: string; error: string }[]; total: number }>(
    `${API_ROUTES.ADMIN_RECORDINGS}/bulk`,
    {
      method: 'POST',
      body: JSON.stringify({ recordingIds }),
    },
  );
}

export async function getMyVideos(topicId?: string, search?: string) {
  const params = new URLSearchParams();
  if (topicId) params.set('topicId', topicId);
  if (search) params.set('search', search);
  const q = params.toString();
  return fetchApi<StudentVideo[]>(`${API_ROUTES.RECORDINGS}/my${q ? `?${q}` : ''}`);
}

export async function getMyDashboardRecordings(search?: string) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const q = params.toString();
  return fetchApi<{ flat: StudentVideo[]; grouped: StudentBatchRecordings[] }>(`${API_ROUTES.RECORDINGS}/my/dashboard${q ? `?${q}` : ''}`);
}

export async function getMyVideosGrouped(search?: string) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const q = params.toString();
  return fetchApi<StudentBatchRecordings[]>(`${API_ROUTES.RECORDINGS}/my/grouped${q ? `?${q}` : ''}`);
}

export async function getVideoPlaybackUrl(videoId: string) {
  return fetchApi<PlaybackResponse>(`${API_ROUTES.RECORDINGS}/${videoId}/play`);
}

export async function updateVideoProgress(
  videoId: string,
  watchedSeconds: number,
  completed?: boolean,
) {
  return fetchApi(`${API_ROUTES.RECORDINGS}/${videoId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ watchedSeconds, completed }),
  });
}

export interface BatchVideo {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  status: string;
  createdAt: string;
}

export async function getBatchVideos(batchId: string) {
  return fetchApi<BatchVideo[]>(`${API_ROUTES.RECORDINGS}/batch/${batchId}`);
}

export interface StudentCurriculumContent {
  title: string;
  description?: string;
  duration_seconds?: number;
  status?: string;
}

export interface StudentCurriculumItem {
  id: string;
  content_id?: string;
  content_type: string;
  category_name: string;
  module_name?: string;
  sort_order: number;
  pdf_url?: string;
  pdf_title?: string;
  content?: StudentCurriculumContent;
}

export interface StudentCurriculumCategory {
  category: string;
  items: StudentCurriculumItem[];
}

export async function getStudentBatchCurriculum(batchId: string) {
  return fetchApi<StudentCurriculumCategory[]>(
    `${API_ROUTES.BATCHES}/${batchId}/curriculum`,
  );
}
