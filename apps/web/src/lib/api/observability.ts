import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface ErrorLogEntry {
  id: string;
  message: string;
  error_type: string;
  severity: string;
  stack_trace?: string;
  context?: Record<string, any>;
  user_id?: string;
  url?: string;
  method?: string;
  status_code?: number;
  resolved: boolean;
  created_at: string;
}

export interface EventLogEntry {
  id: string;
  event_type: string;
  source: string;
  severity: string;
  message: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface MetricSeries {
  metricName: string;
  values: number[];
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface DashboardOverview {
  recentErrors: ErrorLogEntry[];
  errorCountsByType: { errorType: string; count: number }[];
  errorCountsLast24h: number;
  eventCountsLast24h: number;
  slowestEndpoints: { endpoint: string; avgLatency: number; count: number }[];
  totalMetrics: number;
  openErrorCount: number;
  resolvedErrorCount: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export async function logError(data: {
  message: string;
  errorType: string;
  severity?: string;
  stackTrace?: string;
  context?: Record<string, any>;
  userId?: string;
}) {
  return fetchApi<ErrorLogEntry>(API_ROUTES.OBSERVABILITY_ERRORS, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function logEvent(data: {
  eventType: string;
  source: string;
  severity?: string;
  message: string;
  metadata?: Record<string, any>;
}) {
  return fetchApi<EventLogEntry>(API_ROUTES.OBSERVABILITY_EVENTS, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function trackMetric(data: {
  metricName: string;
  value: number;
  unit?: string;
  tags?: Record<string, any>;
  userId?: string;
}) {
  return fetchApi(API_ROUTES.OBSERVABILITY_METRICS, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getErrors(
  params: {
    page?: number;
    limit?: number;
    errorType?: string;
    severity?: string;
    resolved?: boolean;
    startDate?: string;
    endDate?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.errorType) query.set('errorType', params.errorType);
  if (params.severity) query.set('severity', params.severity);
  if (params.resolved !== undefined) query.set('resolved', String(params.resolved));
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);

  const qs = query.toString();
  return fetchApi<PaginatedResponse<ErrorLogEntry>>(`${API_ROUTES.OBSERVABILITY_ERRORS}${qs ? `?${qs}` : ''}`);
}

export async function getEvents(
  params: {
    page?: number;
    limit?: number;
    eventType?: string;
    source?: string;
    startDate?: string;
    endDate?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.eventType) query.set('eventType', params.eventType);
  if (params.source) query.set('source', params.source);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);

  const qs = query.toString();
  return fetchApi<PaginatedResponse<EventLogEntry>>(`${API_ROUTES.OBSERVABILITY_EVENTS}${qs ? `?${qs}` : ''}`);
}

export async function getMetrics(
  params: { metricName?: string; startDate?: string; endDate?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.metricName) query.set('metricName', params.metricName);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);

  const qs = query.toString();
  return fetchApi<MetricSeries>(`${API_ROUTES.OBSERVABILITY_METRICS}${qs ? `?${qs}` : ''}`);
}

export async function getObservabilityDashboard() {
  return fetchApi<DashboardOverview>(API_ROUTES.OBSERVABILITY_DASHBOARD);
}

export async function resolveError(id: string) {
  return fetchApi<{ resolved: boolean }>(`${API_ROUTES.OBSERVABILITY_ERRORS}/${id}/resolve`, {
    method: 'PATCH',
  });
}

export interface ReconcileResult {
  checkedGroups: number;
  autoResolvedRows: number;
  stillActiveGroups: number;
  skippedCriticalGroups: number;
  staleDays: number;
}

export async function reconcileErrors(staleDays?: number) {
  return fetchApi<ReconcileResult>(`${API_ROUTES.OBSERVABILITY_ERRORS}/reconcile`, {
    method: 'PATCH',
    body: JSON.stringify(staleDays !== undefined ? { staleDays } : {}),
  });
}

export async function reopenError(id: string) {
  return fetchApi<{ resolved: boolean }>(`${API_ROUTES.OBSERVABILITY_ERRORS}/${id}/reopen`, {
    method: 'PATCH',
  });
}
