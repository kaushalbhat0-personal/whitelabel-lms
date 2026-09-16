import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface ScheduleSessionData {
  title: string;
  startTime: string;
  batchIds: string[];
}

export interface ScheduledSession {
  id: string;
  zoom_meeting_id?: string;
  zoom_webinar_id?: string;
  start_time: string;
  title: string;
  topic?: string;
  is_live?: boolean;
  status?: string;
  duration_minutes?: number;
  created_at: string;
  updated_at: string;
  batchNames: string[];
  joinUrl?: string;
  startUrl?: string;
}

export async function scheduleSession(
  data: ScheduleSessionData,
) {
  return fetchApi<ScheduledSession>(API_ROUTES.ADMIN_SESSIONS, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getSessions() {
  return fetchApi<ScheduledSession[]>(API_ROUTES.ADMIN_SESSIONS);
}

export async function deleteSession(id: string) {
  return fetchApi<{ deleted: boolean }>(`${API_ROUTES.ADMIN_SESSIONS}/${id}`, {
    method: 'DELETE',
  });
}
