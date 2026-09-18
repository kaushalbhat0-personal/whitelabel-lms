'use client';

import { Fragment, useEffect, useRef, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Activity,
  BarChart3,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Info,
  AlertCircle,
  Zap,
  Server,
  Mail,
  Clock,
  RotateCw,
  Send,
  Timer,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getObservabilityDashboard,
  getErrors,
  getEvents,
  resolveError,
  reopenError,
  reconcileErrors,
  type DashboardOverview,
  type ErrorLogEntry,
  type EventLogEntry,
  type ReconcileResult,
} from '@/lib/api/observability';
import { getEmailQueueStats, type EmailQueueStats } from '@/lib/api/email-logs';

type Tab = 'errors' | 'events' | 'email-queue';
type ErrorFilter = 'open' | 'resolved' | 'all';

const AUTO_REFRESH_INTERVAL = 30_000;

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  error: 'text-orange-600 bg-orange-50 border-orange-200',
  warning: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  info: 'text-blue-600 bg-blue-50 border-blue-200',
  debug: 'text-gray-600 bg-gray-50 border-gray-200',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  error: 'bg-orange-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
  debug: 'bg-gray-500',
};

function SeverityBadge({ severity }: { severity: string }) {
  const key = severity?.toLowerCase() || 'info';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
      SEVERITY_COLORS[key] || SEVERITY_COLORS.info,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT[key] || SEVERITY_DOT.info)} />
      {severity}
    </span>
  );
}

function StatusBadge({ resolved }: { resolved: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
      resolved
        ? 'bg-green-50 text-green-700 border border-green-200'
        : 'bg-red-50 text-red-700 border border-red-200',
    )}>
      {resolved ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {resolved ? 'Resolved' : 'Open'}
    </span>
  );
}

function SummaryCard({ title, value, icon: Icon, color, subtitle }: {
  title: string;
  value: string | number;
  icon: any;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold text-text-primary">{value ?? '-'}</p>
          {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
        </div>
        <div className={cn('rounded-xl p-3', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}

export default function AdminMonitoringPage() {
  const [activeTab, setActiveTab] = useState<Tab>('errors');
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('open');

  const [dashboard, setDashboard] = useState<DashboardOverview | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);

  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorsPage, setErrorsPage] = useState(1);
  const [errorsLimit] = useState(20);
  const [loadingErrors, setLoadingErrors] = useState(false);

  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsLimit] = useState(15);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const [queueStats, setQueueStats] = useState<EmailQueueStats | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());

  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const resolving = useRef(new Set<string>());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true);
    setDashboardError(false);
    try { const data = await getObservabilityDashboard(); setDashboard(data); setLastUpdated(new Date()); }
    catch { setDashboardError(true); }
    finally { setLoadingDashboard(false); }
  }, []);

  const loadErrors = useCallback(async (page: number, filter: ErrorFilter) => {
    setLoadingErrors(true);
    try {
      const resolvedParam = filter === 'all' ? undefined : filter === 'resolved';
      const r = await getErrors({ page, limit: errorsLimit, resolved: resolvedParam });
      setErrors(r.items);
      setErrorsTotal(r.total);
    } catch { setErrors([]); }
    finally { setLoadingErrors(false); }
  }, [errorsLimit]);

  const loadEvents = useCallback(async (page: number) => {
    setLoadingEvents(true);
    try { const r = await getEvents({ page, limit: eventsLimit }); setEvents(r.items); setEventsTotal(r.total); }
    catch { setEvents([]); }
    finally { setLoadingEvents(false); }
  }, [eventsLimit]);

  const loadQueueStats = useCallback(async () => {
    setLoadingQueue(true);
    try { setQueueStats(await getEmailQueueStats()); }
    catch { setQueueStats(null); }
    finally { setLoadingQueue(false); }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === 'errors') loadErrors(errorsPage, errorFilter);
    if (activeTab === 'email-queue') loadQueueStats();
  }, [activeTab, errorsPage, errorFilter, loadErrors, loadQueueStats]);

  useEffect(() => {
    if (activeTab === 'events') loadEvents(eventsPage);
  }, [activeTab, eventsPage, loadEvents]);

  useEffect(() => {
    const interval = setInterval(async () => {
      await loadDashboard();
      if (activeTab === 'errors') await loadErrors(errorsPage, errorFilter);
      if (activeTab === 'events') await loadEvents(eventsPage);
      if (activeTab === 'email-queue') await loadQueueStats();
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadDashboard, loadErrors, loadEvents, loadQueueStats, activeTab, errorsPage, errorFilter, eventsPage]);

  const handleResolve = async (id: string) => {
    if (resolving.current.has(id)) return;
    resolving.current.add(id);
    setErrors((prev) => prev.filter((e) => e.id !== id));
    setErrorsTotal((prev) => Math.max(0, prev - 1));
    try {
      await resolveError(id);
      await loadDashboard();
    } catch {
      await loadErrors(errorsPage, errorFilter);
    } finally {
      resolving.current.delete(id);
    }
  };

  const handleReopen = async (id: string) => {
    if (resolving.current.has(id)) return;
    resolving.current.add(id);
    setErrors((prev) =>
      prev.map((e) => (e.id === id ? { ...e, resolved: false, resolved_at: undefined, resolved_by: undefined } : e)),
    );
    try {
      await reopenError(id);
      await loadDashboard();
    } catch {
      await loadErrors(errorsPage, errorFilter);
    } finally {
      resolving.current.delete(id);
    }
  };

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadDashboard(),
      activeTab === 'errors' ? loadErrors(errorsPage, errorFilter) : Promise.resolve(),
      activeTab === 'events' ? loadEvents(eventsPage) : Promise.resolve(),
      activeTab === 'email-queue' ? loadQueueStats() : Promise.resolve(),
    ]);
  }, [loadDashboard, loadErrors, loadEvents, loadQueueStats, activeTab, errorsPage, errorFilter, eventsPage]);

  const handleReconcile = useCallback(async () => {
    if (reconciling) return;
    setReconciling(true);
    setReconcileError(null);
    setReconcileResult(null);
    try {
      const result = await reconcileErrors();
      setReconcileResult(result);
      // Force fresh server reload after reconciliation
      await Promise.all([
        loadDashboard(),
        loadErrors(errorsPage, errorFilter),
        activeTab === 'events' ? loadEvents(eventsPage) : Promise.resolve(),
        activeTab === 'email-queue' ? loadQueueStats() : Promise.resolve(),
      ]);
      setLastUpdated(new Date());
    } catch (err: any) {
      setReconcileError(err?.message ?? 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  }, [reconciling, loadDashboard, loadErrors, loadEvents, loadQueueStats, activeTab, errorsPage, errorFilter, eventsPage]);

  const errorsTotalPages = Math.ceil(errorsTotal / errorsLimit);
  const eventsTotalPages = Math.ceil(eventsTotal / eventsLimit);

  const formatTime = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const lastUpdatedSeconds = lastUpdated ? Math.floor((now - lastUpdated.getTime()) / 1000) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Monitoring Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">System observability, error tracking, event logging, and email queue monitoring</p>
          {lastUpdatedSeconds !== null && (
            <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
              <RefreshCw className="h-3 w-3" />
              Last updated {lastUpdatedSeconds < 5 ? 'just now' : `${lastUpdatedSeconds} seconds ago`}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-surface-border bg-surface-card p-1 w-fit flex-wrap">
        <button onClick={() => setActiveTab('errors')} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors', activeTab === 'errors' ? 'bg-brand-navy text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted')}>
          <AlertTriangle className="h-4 w-4" />Error Log
        </button>
        <button onClick={() => setActiveTab('events')} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors', activeTab === 'events' ? 'bg-brand-navy text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted')}>
          <Activity className="h-4 w-4" />Event Log
        </button>
        <button onClick={() => setActiveTab('email-queue')} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors', activeTab === 'email-queue' ? 'bg-brand-navy text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted')}>
          <Mail className="h-4 w-4" />Email Queue
        </button>
      </div>

      {activeTab === 'errors' && (
        <div className="space-y-6">
          {loadingDashboard ? (
            <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-4 border-surface-border border-t-brand-navy" /></div>
          ) : dashboardError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-red-500 mb-2" />
              <p className="text-sm font-medium text-red-700">Failed to load dashboard data.</p>
              <button onClick={loadDashboard} className="mt-3 text-sm font-medium text-red-600 underline hover:text-red-800">Retry</button>
            </div>
          ) : dashboard ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  title="Open Errors"
                  value={dashboard.openErrorCount}
                  icon={AlertTriangle}
                  color={dashboard.openErrorCount > 0 ? 'bg-red-600' : 'bg-green-600'}
                  subtitle={dashboard.openErrorCount === 0 ? 'No active incidents' : undefined}
                />
                <SummaryCard title="Resolved Errors" value={dashboard.resolvedErrorCount} icon={CheckCircle2} color="bg-green-600" />
                <SummaryCard title="Error Rate (24h)" value={dashboard.errorCountsLast24h} icon={Activity} color="bg-blue-600" />
                <SummaryCard
                  title="Slowest Endpoint"
                  value={dashboard.slowestEndpoints[0]?.endpoint ? `${dashboard.slowestEndpoints[0].avgLatency}ms` : '—'}
                  icon={Timer}
                  color="bg-purple-600"
                  subtitle={dashboard.slowestEndpoints[0]?.endpoint ?? undefined}
                />
              </div>

              {dashboard.openErrorCount === 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500 mb-2" />
                  <p className="text-lg font-semibold text-emerald-800">No Active Incidents</p>
                  <p className="text-sm text-emerald-600 mt-1">All system errors have been resolved.</p>
                </div>
              )}

              {dashboard.errorCountsByType.length > 0 && (
                <div className="rounded-xl border border-surface-border bg-surface-card p-6">
                  <h2 className="mb-4 text-lg font-semibold text-text-primary">Errors by Type</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {dashboard.errorCountsByType.map((item) => (
                      <div key={item.errorType} className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-muted/50 p-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg bg-red-100 p-2"><Zap className="h-4 w-4 text-red-600" /></div>
                          <div><p className="text-sm font-medium text-text-primary">{item.errorType}</p><p className="text-xs text-text-muted">errors</p></div>
                        </div>
                        <span className="text-xl font-bold text-text-primary">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dashboard.slowestEndpoints.length > 0 && (
                <div className="rounded-xl border border-surface-border bg-surface-card p-6">
                  <h2 className="mb-4 text-lg font-semibold text-text-primary">Slowest Endpoints (avg latency)</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-surface-border bg-surface-muted">
                          <th className="px-4 py-3 text-left font-medium text-text-secondary">Endpoint</th>
                          <th className="px-4 py-3 text-left font-medium text-text-secondary">Avg Latency</th>
                          <th className="px-4 py-3 text-left font-medium text-text-secondary">Requests</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-border">
                        {dashboard.slowestEndpoints.map((ep) => (
                          <tr key={ep.endpoint}>
                            <td className="px-4 py-3 text-sm text-text-primary font-mono">{ep.endpoint}</td>
                            <td className="px-4 py-3 text-sm"><span className={cn('font-semibold', ep.avgLatency > 1000 ? 'text-red-600' : ep.avgLatency > 500 ? 'text-yellow-600' : 'text-green-600')}>{ep.avgLatency}ms</span></td>
                            <td className="px-4 py-3 text-sm text-text-secondary">{ep.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-surface-border bg-surface-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-text-primary">Error Log</h2>
                  <div className="flex items-center gap-2">
                    {loadingErrors && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
                    <button
                      onClick={handleRefresh}
                      disabled={loadingDashboard || loadingErrors || reconciling}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-muted hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loadingDashboard ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                    <button
                      onClick={handleReconcile}
                      disabled={reconciling || loadingDashboard}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {reconciling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      {reconciling ? 'Reconciling...' : 'Reconcile Errors'}
                    </button>
                    <div className="flex gap-1 rounded-lg border border-surface-border p-0.5">
                      {(['open', 'resolved', 'all'] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => { setErrorFilter(f); setErrorsPage(1); }}
                          className={cn(
                            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                            errorFilter === f
                              ? 'bg-brand-navy text-white shadow-sm'
                              : 'text-text-muted hover:text-text-primary',
                          )}
                        >
                          {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {reconcileError && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {reconcileError}
                  </div>
                )}
                {reconcileResult && (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <p className="text-sm font-semibold text-emerald-800">Reconciliation complete</p>
                    <p className="mt-1 text-xs text-emerald-700">
                      Checked: {reconcileResult.checkedGroups} groups · Auto-resolved: {reconcileResult.autoResolvedRows} errors · Still active: {reconcileResult.stillActiveGroups} groups · Skipped critical: {reconcileResult.skippedCriticalGroups} groups · Stale threshold: {reconcileResult.staleDays} days
                    </p>
                    {reconcileResult.autoResolvedRows === 0 && (
                      <p className="mt-1 text-xs text-text-muted">No stale errors found.</p>
                    )}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border bg-surface-muted">
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">Message</th>
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">Count</th>
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">Severity</th>
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">Last Seen</th>
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {errors.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-text-muted">
                          {loadingErrors ? (
                            <div className="flex justify-center"><div className="h-6 w-6 animate-spin rounded-full border-4 border-surface-border border-t-brand-navy" /></div>
                          ) : 'No errors found.'}
                        </td></tr>
                      ) : (
                        (() => {
                          const grouped = new Map<string, { ids: string[]; messages: Set<string>; firstSeen: string; lastSeen: string; count: number; resolved: boolean; entry: ErrorLogEntry }>();
                          for (const err of errors) {
                            const key = `${err.message}|${err.url ?? ''}`;
                            const existing = grouped.get(key);
                            if (existing) {
                              existing.ids.push(err.id);
                              existing.count++;
                              if (err.created_at < existing.firstSeen) existing.firstSeen = err.created_at;
                              if (err.created_at > existing.lastSeen) existing.lastSeen = err.created_at;
                              if (!err.resolved) existing.resolved = false;
                            } else {
                              grouped.set(key, {
                                ids: [err.id],
                                messages: new Set([err.message]),
                                firstSeen: err.created_at,
                                lastSeen: err.created_at,
                                count: 1,
                                resolved: err.resolved,
                                entry: err,
                              });
                            }
                          }
                          return Array.from(grouped.entries()).map(([key, g]) => {
                            const err = g.entry;
                            return (
                              <Fragment key={key}>
                                <tr onClick={() => setExpandedRow(expandedRow === key ? null : key)} className="cursor-pointer hover:bg-surface-muted/50 transition-colors">
                                  <td className="px-4 py-3 max-w-xs truncate text-text-primary">{err.message || '-'}</td>
                                  <td className="px-4 py-3">
                                    <span className="inline-flex items-center justify-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-text-secondary">{g.count}</span>
                                  </td>
                                  <td className="px-4 py-3"><SeverityBadge severity={err.severity} /></td>
                                  <td className="px-4 py-3"><StatusBadge resolved={g.resolved} /></td>
                                  <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">{formatTime(g.lastSeen)}</td>
                                  <td className="px-4 py-3">
                                    {g.resolved ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleReopen(err.id); }}
                                        className="rounded-lg border border-surface-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-muted hover:text-text-primary transition-colors"
                                      >
                                        Reopen
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleResolve(err.id); }}
                                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                                      >
                                        Resolve
                                      </button>
                                    )}
                                  </td>
                                </tr>
                                {expandedRow === key && (
                                  <tr className="bg-surface-muted/30">
                                    <td colSpan={6} className="px-4 py-4">
                                      <div className="rounded-lg border border-surface-border bg-surface-card p-4 space-y-2">
                                        <div className="grid grid-cols-3 gap-4 text-sm">
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">URL</span>
                                            <p className="text-text-primary font-mono text-xs mt-0.5">{err.url || '—'}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Method</span>
                                            <p className="text-text-primary text-xs mt-0.5">{err.method || '—'}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Status Code</span>
                                            <p className="text-text-primary text-xs mt-0.5">{err.status_code ?? '—'}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Error Type</span>
                                            <p className="text-text-primary text-xs mt-0.5">{err.error_type}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">First Seen</span>
                                            <p className="text-text-primary text-xs mt-0.5">{new Date(g.firstSeen).toLocaleString('en-IN')}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Last Seen</span>
                                            <p className="text-text-primary text-xs mt-0.5">{new Date(g.lastSeen).toLocaleString('en-IN')}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Occurrences</span>
                                            <p className="text-text-primary text-xs mt-0.5">{g.count}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">IDs</span>
                                            <p className="text-text-primary text-xs mt-0.5 font-mono">{g.ids.length} record(s)</p>
                                          </div>
                                        </div>
                                        {err.stack_trace && (
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Stack Trace</span>
                                            <pre className="mt-0.5 text-xs text-text-secondary font-mono whitespace-pre-wrap bg-surface-muted rounded-lg p-3 max-h-48 overflow-y-auto">{err.stack_trace}</pre>
                                          </div>
                                        )}
                                        {err.context && Object.keys(err.context).length > 0 && (
                                          <div>
                                            <span className="text-xs font-medium text-text-muted">Context</span>
                                            <pre className="mt-0.5 text-xs text-text-secondary font-mono whitespace-pre-wrap bg-surface-muted rounded-lg p-3 max-h-32 overflow-y-auto">{JSON.stringify(err.context, null, 2)}</pre>
                                          </div>
                                        )}
                                        {g.ids.length > 1 && (
                                          <div className="flex gap-2 mt-2">
                                            <span className="text-xs text-text-muted">All {g.ids.length} occurrences share this error message.</span>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          });
                        })()
                      )}
                    </tbody>
                  </table>
                </div>
                {errorsTotalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-surface-border pt-4 mt-4">
                    <p className="text-xs text-text-muted">Showing {(errorsPage - 1) * errorsLimit + 1}–{Math.min(errorsPage * errorsLimit, errorsTotal)} of {errorsTotal}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setErrorsPage((p) => Math.max(1, p - 1))} disabled={errorsPage <= 1} className={cn('flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', errorsPage <= 1 ? 'border-surface-border text-text-muted cursor-not-allowed' : 'border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary')}>
                        <ChevronLeft className="h-3.5 w-3.5" />Previous
                      </button>
                      <button onClick={() => setErrorsPage((p) => Math.min(errorsTotalPages, p + 1))} disabled={errorsPage >= errorsTotalPages} className={cn('flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', errorsPage >= errorsTotalPages ? 'border-surface-border text-text-muted cursor-not-allowed' : 'border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary')}>
                        Next<ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {activeTab === 'events' && (
        <div className="rounded-xl border border-surface-border bg-surface-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Event Log</h2>
            {loadingEvents && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-muted">
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Event Type</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Source</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Severity</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {loadingEvents ? (
                  <tr><td colSpan={5} className="px-4 py-12"><div className="flex justify-center"><div className="h-6 w-6 animate-spin rounded-full border-4 border-surface-border border-t-brand-navy" /></div></td></tr>
                ) : events.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-text-muted">No events recorded.</td></tr>
                ) : events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">{formatTime(ev.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                        <Info className="h-3 w-3" />{ev.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{ev.source || <span className="text-text-muted">—</span>}</td>
                    <td className="px-4 py-3"><SeverityBadge severity={ev.severity} /></td>
                    <td className="px-4 py-3 text-xs text-text-secondary max-w-xs truncate">{ev.message || <span className="text-text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {eventsTotalPages > 1 && (
            <div className="flex items-center justify-between border-t border-surface-border pt-4 mt-4">
              <p className="text-xs text-text-muted">Showing {(eventsPage - 1) * eventsLimit + 1}–{Math.min(eventsPage * eventsLimit, eventsTotal)} of {eventsTotal}</p>
              <div className="flex gap-2">
                <button onClick={() => setEventsPage((p) => Math.max(1, p - 1))} disabled={eventsPage <= 1} className={cn('flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', eventsPage <= 1 ? 'border-surface-border text-text-muted cursor-not-allowed' : 'border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary')}>
                  <ChevronLeft className="h-3.5 w-3.5" />Previous
                </button>
                <button onClick={() => setEventsPage((p) => Math.min(eventsTotalPages, p + 1))} disabled={eventsPage >= eventsTotalPages} className={cn('flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', eventsPage >= eventsTotalPages ? 'border-surface-border text-text-muted cursor-not-allowed' : 'border-surface-border text-text-secondary hover:bg-surface-muted hover:text-text-primary')}>
                  Next<ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'email-queue' && (
        <div className="space-y-6">
          {loadingQueue ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : queueStats ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <SummaryCard title="In Queue" value={queueStats.inQueue} icon={Timer} color="bg-purple-600" />
                <SummaryCard title="Pending" value={queueStats.pending} icon={Clock} color="bg-amber-500" />
                <SummaryCard title="Retrying" value={queueStats.retrying} icon={RotateCw} color="bg-blue-600" />
                <SummaryCard title="Failed" value={queueStats.failed} icon={XCircle} color="bg-red-600" />
                <SummaryCard title="Total" value={queueStats.total} icon={Send} color="bg-brand-navy" />
              </div>

              {queueStats.inQueue > 0 && (
                <div className="rounded-xl border border-surface-border bg-surface-card p-6">
                  <h2 className="mb-4 text-lg font-semibold text-text-primary">Queue Status</h2>
                  <div className="space-y-3">
                    {queueStats.pending > 0 && (
                      <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <Clock className="h-5 w-5 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium text-amber-800">{queueStats.pending} emails pending processing</p>
                          <p className="text-xs text-amber-600">These emails are awaiting delivery attempt</p>
                        </div>
                      </div>
                    )}
                    {queueStats.retrying > 0 && (
                      <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                        <RotateCw className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">{queueStats.retrying} emails currently retrying</p>
                          <p className="text-xs text-blue-600">Failed emails being retried after admin action</p>
                        </div>
                      </div>
                    )}
                    {queueStats.failed > 0 && (
                      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                        <XCircle className="h-5 w-5 text-red-600" />
                        <div>
                          <p className="text-sm font-medium text-red-800">{queueStats.failed} emails permanently failed</p>
                          <p className="text-xs text-red-600">These may need investigation. Visit Email Center for details.</p>
                        </div>
                      </div>
                    )}
                    {queueStats.inQueue === 0 && (
                      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <div>
                          <p className="text-sm font-medium text-emerald-800">Queue is clear</p>
                          <p className="text-xs text-emerald-600">No pending or retrying emails in the queue</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-surface-border bg-surface-card p-6">
                <h2 className="text-lg font-semibold text-text-primary mb-2">Email Queue Summary</h2>
                <p className="text-sm text-text-muted">
                  The email queue shows real-time state of all email deliveries. Use the{' '}
                  <a href="/admin/email-logs" className="text-brand-600 underline hover:text-brand-700">
                    Email Center
                  </a>{' '}
                  to view details, retry failed emails, and monitor delivery analytics.
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-surface-border bg-surface-card p-6">
              <div className="text-center py-8">
                <Mail className="mx-auto h-8 w-8 text-text-muted" />
                <p className="mt-2 text-sm text-text-secondary">Failed to load email queue stats</p>
                <button onClick={loadQueueStats} className="mt-3 text-sm font-medium text-brand-600 underline hover:text-brand-700">
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
