import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface LiveSession {
  id: string;
  zoom_webinar_id?: string;
  zoom_join_url?: string;
  zoom_start_url?: string;
  topic: string;
  agenda?: string;
  start_time: string;
  duration_minutes: number;
  host_user_id: string;
  status: string;
  created_at: string;
}

export interface LiveSessionWithDetails extends LiveSession {
  batchIds: string[];
  hostTeacher?: { id: string; name: string; email: string } | null;
}

export interface StudentSessions {
  upcoming: LiveSession[];
  past: (LiveSession & { attendanceStatus?: string })[];
}

export interface JoinTokenResponse {
  token: string;
  expiresInSeconds: number;
}

export interface JoinUrlResponse {
  joinUrl: string;
  sessionId: string;
}

export async function getMyDashboardSessions() {
  return fetchApi<StudentSessions>(`${API_ROUTES.LIVE_SESSIONS}/my/dashboard`);
}

export async function getMySessions() {
  return fetchApi<StudentSessions>(`${API_ROUTES.LIVE_SESSIONS}/my`);
}

export async function getSessionById(id: string) {
  return fetchApi<LiveSessionWithDetails>(`${API_ROUTES.LIVE_SESSIONS}/${id}`);
}

/**
 * Request a single-use join token for a live session.
 * Call this first, then pass the token to getSessionJoinUrl().
 */
export async function requestJoinToken(sessionId: string) {
  return fetchApi<JoinTokenResponse>(
    `${API_ROUTES.LIVE_SESSIONS}/${sessionId}/request-join`,
    { method: 'POST' },
  );
}

/**
 * Consume a single-use join token and get the Zoom join URL.
 * The token is valid for one use only and expires after 15 minutes.
 */
export async function getSessionJoinUrl(sessionId: string, token: string) {
  return fetchApi<JoinUrlResponse>(
    `${API_ROUTES.LIVE_SESSIONS}/${sessionId}/join`,
    { method: 'POST', body: JSON.stringify({ token }) },
  );
}

/**
 * Mark the user as having left a live session.
 */
export async function leaveSession(sessionId: string) {
  return fetchApi<{ left: boolean }>(
    `${API_ROUTES.LIVE_SESSIONS}/${sessionId}/leave`,
    { method: 'POST' },
  );
}
