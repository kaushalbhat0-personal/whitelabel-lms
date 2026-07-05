import { fetchApi } from '@/lib/api-client';

export interface PlaybackEvent {
  id: string;
  user_id: string;
  recording_id: string;
  event_type: string;
  position_seconds: number | null;
  playback_session_id: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface PlaybackViolation {
  id: string;
  user_id: string;
  recording_id: string | null;
  violation_type: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  profiles?: { name: string; email: string };
}

export async function getPlaybackEvents(params?: {
  recordingId?: string;
  userId?: string;
}): Promise<PlaybackEvent[]> {
  const query = new URLSearchParams();
  if (params?.recordingId) query.set('recordingId', params.recordingId);
  if (params?.userId) query.set('userId', params.userId);
  const qs = query.toString();
  return fetchApi<PlaybackEvent[]>(`/playback/events${qs ? `?${qs}` : ''}`);
}

export async function getPlaybackViolations(params?: {
  userId?: string;
}): Promise<PlaybackViolation[]> {
  const query = new URLSearchParams();
  if (params?.userId) query.set('userId', params.userId);
  const qs = query.toString();
  return fetchApi<PlaybackViolation[]>(`/playback/violations${qs ? `?${qs}` : ''}`);
}