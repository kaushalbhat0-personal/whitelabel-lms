import { fetchApi } from '@/lib/api-client';

export type DetectionType =
  | 'visibilitychange_hidden'
  | 'window_blur'
  | 'window_focus_lost'
  | 'printscreen_key'
  | 'devtools_open'
  | 'get_display_media'
  | 'multiple_displays';

export type ContextType = 'recording' | 'live_session' | 'test';

export async function reportScreenRecordingViolation(
  contextType: ContextType,
  detectionType: DetectionType,
  contextId?: string,
  details?: Record<string, any>,
) {
  return fetchApi('/screen-recording/violation', {
    method: 'POST',
    body: JSON.stringify({
      contextType,
      detectionType,
      contextId,
      details,
    }),
  });
}

export async function getScreenRecordingViolations(
  params?: { userId?: string; contextType?: string; limit?: number },
): Promise<any[]> {
  const searchParams = new URLSearchParams();
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.contextType) searchParams.set('contextType', params.contextType);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  const result = await fetchApi<{ items: any[]; total: number; page: number; limit: number }>(
    `/screen-recording/violations${query ? `?${query}` : ''}`,
  );
  return result?.items ?? [];
}

export async function getViolationCounters(userId?: string) {
  const query = userId ? `?userId=${userId}` : '';
  return fetchApi<any[]>(`/screen-recording/counters${query}`);
}

export async function getAllRiskScores(limit?: number) {
  const query = limit ? `?limit=${limit}` : '';
  return fetchApi<any[]>(`/screen-recording/risk-scores${query}`);
}

export async function getRiskScore(userId: string) {
  return fetchApi<{
    overall_score: number;
    recording_score: number;
    live_session_score: number;
    test_score: number;
    total_violations: number;
    violations_24h: number;
    violations_7d: number;
  } | null>(`/screen-recording/risk-score/${userId}`);
}
