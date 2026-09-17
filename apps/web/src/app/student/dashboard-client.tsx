'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Video,
  Radio,
  Clock,
  Calendar,
  ExternalLink,
  PlayCircle,
  Trophy,
  BarChart3,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { PageContainer } from '@/components/shared/PageContainer';
import { MobileHeader } from '@/components/shared/MobileHeader';
import { ErrorBoundary } from '@/components/debug/ErrorBoundary';
import { type LiveSession, requestJoinToken, getSessionJoinUrl } from '@/lib/api/live-sessions';
import { type StudentCourse } from '@/lib/api/courses';
import { type StudentVideo, type StudentBatchRecordings } from '@/lib/api/videos';
import { type PaymentPlan } from '@/lib/api/payments';
import { CourseProgressHero } from '@/components/student/dashboard/CourseProgressHero';
import { ContinueLearningCard } from '@/components/student/dashboard/ContinueLearningCard';
import { NextActionCard } from '@/components/student/dashboard/NextActionCard';
import { LearningJourney } from '@/components/student/dashboard/LearningJourney';
import { AssessmentProgress } from '@/components/student/dashboard/AssessmentProgress';
import { RecentLearning } from '@/components/student/dashboard/RecentLearning';
import { StatCard } from '@/components/ui/StatCard';
import { deriveSessionState, canShowJoin, getTimeLabel, isJoinable } from '@/lib/session-status';

interface DashboardClientProps {
  name: string;
  nextClass: LiveSession | null;
  upcoming: LiveSession[];
  courses: StudentCourse[];
  recordings: StudentVideo[];
  results: unknown[];
  pastSessions: (LiveSession & { attendanceStatus?: string })[];
  paymentPlans: PaymentPlan[];
  grouped: StudentBatchRecordings[];
  myTestsTotal: number;
  myTests: any[];
  errors: {
    courses?: string | null;
    sessions?: string | null;
    recordings?: string | null;
    results?: string | null;
    payments?: string | null;
    grouped?: string | null;
    tests?: string | null;
  };
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
function getGreetingEmoji() {
  const h = new Date().getHours();
  if (h < 12) return '☀️';
  if (h < 17) return '🌤️';
  return '🌙';
}
function timeUntil(startTime: string) {
  const diff = new Date(startTime).getTime() - Date.now();
  if (diff <= 0) return 'Starting now';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function formatDueDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const days = Math.floor(diff / 86400000);
  if (days < 0) return `Overdue — due ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due in ${days} days`;
  return `Due ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export function DashboardClient({ name, nextClass, upcoming, courses, recordings, results, pastSessions, paymentPlans, grouped, myTestsTotal, myTests, errors }: DashboardClientProps) {
  const [greeting, setGreeting] = useState('');
  const [joining, setJoining] = useState(false);
  useEffect(() => setGreeting(getGreeting()), []);
  const router = useRouter();
  const handleRetry = () => router.refresh();

  const [joinError, setJoinError] = useState<string | null>(null);
  const handleJoin = async () => {
    if (!nextClass || joining) return;
    setJoining(true);
    setJoinError(null);
    const win = window.open('about:blank', '_blank');
    try {
      const { token } = await requestJoinToken(nextClass.id);
      const { joinUrl } = await getSessionJoinUrl(nextClass.id, token);
      if (!joinUrl || !joinUrl.includes('zoom.us')) throw new Error('Invalid join URL');
      if (win && !win.closed) {
        win.location.href = joinUrl;
        win.focus();
      } else {
        window.location.href = joinUrl;
      }
    } catch (err: any) {
      if (win && !win.closed) win.close();
      setJoinError(err?.message || 'Unable to join. Try again.');
    } finally { setJoining(false); }
  };

  const derivedState = nextClass ? deriveSessionState(nextClass, Date.now()) : null;
  const isLive = derivedState === 'live';
  const isStartingSoon = derivedState === 'starting_soon';
  const canJoin = nextClass ? canShowJoin(nextClass, Date.now()) : false;
  const timeLabel = nextClass ? getTimeLabel(nextClass, Date.now()) : '';
  const lastResult = results.length > 0 ? (results[0] as Record<string, unknown>) : null;

  // Real metrics — no fake data
  const total = recordings.length;
  const completed = recordings.filter((r) => r.progress?.completed).length;
  const inProgress = recordings.filter((r) => !r.progress?.completed && (r.progress?.watched_seconds ?? 0) > 0).length;
  const totalWatchedSeconds = recordings.reduce((acc, r) => acc + (r.progress?.watched_seconds || 0), 0);

  const primaryCourse = courses[0] ?? null;
  const primaryBatch = primaryCourse?.enrolledBatches?.[0] ?? primaryCourse?.batches?.[0] ?? null;
  const courseName = primaryCourse?.name ?? null;
  const batchName = primaryBatch?.name ?? null;

  // Continue item: most recent in-progress, or first unwatched
  const inProgressSorted = [...recordings]
    .filter((r) => !r.progress.completed && (r.progress.watched_seconds ?? 0) > 0)
    .sort((a, b) => {
      const at = a.progress.last_watched_at ? new Date(a.progress.last_watched_at).getTime() : 0;
      const bt = b.progress.last_watched_at ? new Date(b.progress.last_watched_at).getTime() : 0;
      return bt - at;
    });
  const notStarted = recordings.filter((r) => (r.progress.watched_seconds ?? 0) === 0 && !r.progress.completed);
  const continueItem = inProgressSorted[0] ?? notStarted[0] ?? null;
  const continueCardItem = continueItem
    ? {
        id: continueItem.id,
        title: continueItem.title,
        watchedSeconds: continueItem.progress.watched_seconds ?? 0,
        durationSeconds: (continueItem as any).duration_seconds ?? undefined,
        lastWatchedAt: continueItem.progress.last_watched_at ?? null,
      }
    : null;

  // Next action priority: live (if joinable) > continue > pending test > first unwatched
  // Use derivedState for live clarity, and pending test sorted by due date
  const sortedPendingTests = [...myTests]
    .filter((t: any) => t.status === 'published' || t.status === 'active')
    .sort((a: any, b: any) => {
      const ae = a.end_time ? new Date(a.end_time).getTime() : Infinity;
      const be = b.end_time ? new Date(b.end_time).getTime() : Infinity;
      return ae - be;
    });
  let nextAction: React.ComponentProps<typeof NextActionCard>['action'] = { type: 'start_learning', title: 'Browse videos to start', reason: 'Your learning journey starts here' };
  if (nextClass && (derivedState === 'live' || derivedState === 'starting_soon')) {
    const reason = derivedState === 'live' ? 'Live now — join immediately' : 'Starting soon — join opens now (15 min window)';
    nextAction = { type: 'join_live', id: nextClass.id, title: nextClass.topic, status: derivedState, reason, startTime: nextClass.start_time } as any;
  } else if (continueCardItem && continueCardItem.watchedSeconds > 0) {
    const pct = continueCardItem.durationSeconds ? Math.round((continueCardItem.watchedSeconds / continueCardItem.durationSeconds) * 100) : undefined;
    const reason = pct != null ? `${pct}% completed — pick up where you left off` : 'Continue where you left off';
    nextAction = { type: 'continue_video', id: continueCardItem.id, title: continueCardItem.title, pct, reason } as any;
  } else if (myTestsTotal > results.length) {
    const pendingTest = sortedPendingTests[0];
    if (pendingTest) {
      const dueReason = formatDueDate(pendingTest.end_time ?? null);
      const attemptsLeft = (pendingTest.max_attempts ?? 1) - (results.filter((r: any) => r.test_id === pendingTest.id).length);
      const reason = dueReason ? `${dueReason}${attemptsLeft > 0 ? ` · ${pendingTest.max_attempts ?? 1} attempt${(pendingTest.max_attempts ?? 1) !== 1 ? 's' : ''}` : ''}` : `${pendingTest.max_attempts ?? 1} attempt${(pendingTest.max_attempts ?? 1) !== 1 ? 's' : ''} · requires attention`;
      nextAction = { type: 'pending_test', id: pendingTest.id, title: pendingTest.title, reason } as any;
    } else if (notStarted[0]) nextAction = { type: 'continue_video', id: notStarted[0].id, title: notStarted[0].title, reason: 'Start your next lesson' } as any;
  } else if (notStarted[0]) {
    nextAction = { type: 'continue_video', id: notStarted[0].id, title: notStarted[0].title, reason: 'Start your next lesson' } as any;
  } else if (lastResult) {
    nextAction = { type: 'view_result', id: 'latest', title: String((lastResult as any).test_title || 'View results'), pct: Number((lastResult as any).percentage || 0), reason: `You scored ${Number((lastResult as any).percentage || 0)}% — review your results` } as any;
  }

  const isDuplicateContinue = nextAction.type === 'continue_video' && continueCardItem && (nextAction as any).id === continueCardItem.id;

  const completedTests = results.length;
  const pendingTests = Math.max(0, myTestsTotal - completedTests);

  const now = new Date();
  const overdueAmount = paymentPlans.reduce(
    (sum, plan) => sum + (plan.installments ?? []).reduce((s, inst) => (inst.status === 'pending' && new Date(inst.due_date) < now ? s + inst.amount : s), 0),
    0,
  );
  const upcomingDues = paymentPlans.reduce(
    (sum, plan) => sum + (plan.installments ?? []).reduce((s, inst) => (inst.status === 'pending' && new Date(inst.due_date) >= now ? s + inst.amount : s), 0),
    0,
  );
  const nextDueDate =
    paymentPlans
      .flatMap((p) => p.installments ?? [])
      .filter((i) => i.status === 'pending')
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0]?.due_date ?? null;

  const hasAnyContent = total > 0 || upcoming.length > 0 || myTestsTotal > 0;
  const isAllCaughtUp = !isDuplicateContinue && !canJoin && !isLive && !isStartingSoon && pendingTests === 0 && inProgress === 0 && completed === total && total > 0;

  return (
    <ErrorBoundary name="StudentDashboard">
      <>
        <MobileHeader title="Dashboard" />
        <PageContainer>
          <div className="space-y-6">
            {/* Welcome */}
            <div className="animate-fade-in-up">
              <div className="flex flex-col gap-3 rounded-card-lg bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 p-5 text-white md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden="true">{getGreetingEmoji()}</span>
                      <h1 className="text-lg font-bold md:text-xl">
                        {greeting}, <span className="text-white">{name}</span>
                      </h1>
                    </div>
                    <p className="mt-1 text-sm text-brand-200">
                      {courseName ? `${courseName}${batchName ? ` · ${batchName}` : ''}` : 'Continue your learning journey'}
                    </p>
                    <p className="text-xs text-brand-200/80">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs backdrop-blur-sm">
                    <BookOpen className="h-3.5 w-3.5 text-brand-200" aria-hidden="true" /> {courses.length} Courses
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs backdrop-blur-sm">
                    <Video className="h-3.5 w-3.5 text-brand-200" aria-hidden="true" /> {total} Videos
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs backdrop-blur-sm">
                    <BarChart3 className="h-3.5 w-3.5 text-brand-200" aria-hidden="true" /> {completedTests} Tests done
                  </span>
                </div>
              </div>
            </div>

            {isAllCaughtUp && (
              <Card padding="lg" className="text-center border-brand-200 bg-brand-50/30">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-text-primary">You&apos;re all caught up!</p>
                <p className="mt-1 text-xs text-text-muted">All videos completed and no pending tests. Check back for new content.</p>
                <Link href="/student/videos" className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-brand-700 border border-brand-200 hover:bg-brand-50">
                  Browse videos
                </Link>
              </Card>
            )}

            {/* Cockpit grid: Today’s focus first */}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                {!isDuplicateContinue && <NextActionCard action={nextAction} />}

                {errors.recordings ? (
                  <Alert variant="error" title="Couldn't load recordings" role="alert">
                    <p>Please try again.</p>
                    <button onClick={handleRetry} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-50">
                      Retry
                    </button>
                  </Alert>
                ) : (
                  <>
                    <ContinueLearningCard item={continueCardItem} />

                    {!isDuplicateContinue && continueCardItem && nextAction.type === 'continue_video' && (
                      <p className="text-xs text-text-muted -mt-3 px-1">Also: <Link href={`/student/videos/${(nextAction as any).id}`} className="font-medium text-brand-600 hover:text-brand-700">View in Next Up</Link> — same lesson</p>
                    )}

                    <RecentLearning recordings={recordings} />

                    <CourseProgressHero total={total} completed={completed} inProgress={inProgress} courseName={courseName} batchName={batchName} />
                  </>
                )}

                {errors.grouped ? (
                  <Alert variant="error" title="Couldn't load learning journey" role="alert">
                    <p>Please try again.</p>
                    <button onClick={handleRetry} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-50">
                      Retry
                    </button>
                  </Alert>
                ) : (
                  <div>
                    <h2 className="mb-3 text-sm font-semibold text-text-primary">Learning Journey</h2>
                    <LearningJourney data={grouped} />
                  </div>
                )}

                {errors.tests || errors.results ? (
                  <Alert variant="error" title="Couldn't load tests" role="alert">
                    <p>Please try again.</p>
                    <button onClick={handleRetry} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-50">
                      Retry
                    </button>
                  </Alert>
                ) : (
                  <AssessmentProgress availableCount={myTestsTotal} completedCount={completedTests} latest={lastResult} />
                )}
              </div>

              <div className="space-y-6">
                {errors.sessions ? (
                  <Alert variant="error" title="Couldn't load live sessions" role="alert">
                    <p>Please try again.</p>
                    <button onClick={handleRetry} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-50">
                      Retry
                    </button>
                  </Alert>
                ) : (
                  <div className="animate-fade-in-up" style={{ animationDelay: '120ms' }}>
                    <h2 className="mb-3 text-sm font-semibold text-text-primary">{isLive ? 'Live Now' : isStartingSoon ? 'Starting Soon' : nextClass ? 'Upcoming Class' : 'No Upcoming Classes'}</h2>
                    {nextClass ? (
                      <Card className="relative overflow-hidden" padding="lg" hover>
                        {(isLive || isStartingSoon) && (
                          <div className="absolute right-0 top-0 flex items-center gap-1.5 rounded-bl-card bg-red-500 px-3 py-1 text-2xs font-bold text-white">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
                            {isLive ? 'LIVE' : 'SOON'}
                          </div>
                        )}
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center gap-2">
                            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', isLive || isStartingSoon ? 'bg-red-50' : 'bg-brand-50')}>
                              <Radio className={cn('h-5 w-5', isLive || isStartingSoon ? 'text-red-500' : 'text-brand-600')} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-bold text-text-primary">{nextClass.topic}</h3>
                              <p className="text-xs text-text-muted">
                                {formatDate(nextClass.start_time)} · {formatTime(nextClass.start_time)} · {nextClass.duration_minutes} min
                              </p>
                            </div>
                          </div>
                          <p className={cn('text-xs font-medium', isLive ? 'text-red-600' : isStartingSoon ? 'text-amber-600' : 'text-text-muted')}>
                            {timeLabel}
                          </p>
                          {!isLive && !isStartingSoon && (
                            <p className="text-xs text-text-muted">Join opens 15 minutes before start</p>
                          )}
                          {(isStartingSoon || isLive) && canJoin && (
                            <p className="text-xs font-medium text-emerald-600">Join available now</p>
                          )}
                          {!canJoin && !isLive && !isStartingSoon && nextClass.status !== 'cancelled' && (
                            <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-secondary">
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                              Starts in {timeUntil(nextClass.start_time)}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {canJoin ? (
                              <Button variant="primary" size="md" loading={joining} onClick={handleJoin} className={cn('min-h-[44px]', isLive && 'motion-safe:animate-pulse-soft')}>
                                Join Now
                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            ) : isLive || isStartingSoon ? (
                              <Button variant="outline" size="md" loading={joining} onClick={handleJoin} className="min-h-[44px]">
                                Join Now
                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            ) : (
                              <Link href={`/student/live-sessions/${nextClass.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-surface-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-muted">
                                View Details
                              </Link>
                            )}
                          </div>
                          {joinError && <div><p className="text-xs font-medium text-red-600" role="alert">{joinError}</p><button onClick={handleJoin} className="mt-1 min-h-[44px] text-xs font-semibold text-brand-600 underline hover:text-brand-700">Retry</button></div>}
                        </div>
                      </Card>
                    ) : (
                      <Card className="text-center py-8">
                        <Calendar className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true" />
                        <p className="mt-2 text-sm text-text-secondary">All caught up! No upcoming classes.</p>
                        {!hasAnyContent && <p className="mt-1 text-xs text-text-muted">New sessions will appear here once scheduled.</p>}
                      </Card>
                    )}
                  </div>
                )}

                {/* Quick stats - real only */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Courses" value={courses.length} icon={<BookOpen className="h-5 w-5" />} iconColor="bg-brand-50 text-brand-600" />
                  <StatCard label="Completed" value={completed} icon={<CheckCircle2 className="h-5 w-5" />} iconColor="bg-emerald-50 text-emerald-600" />
                  <StatCard label="Watched" value={`${Math.floor(totalWatchedSeconds / 3600)}h`} icon={<Clock className="h-5 w-5" />} iconColor="bg-blue-50 text-blue-600" />
                  <StatCard label="Pending Tests" value={pendingTests} icon={<BarChart3 className="h-5 w-5" />} iconColor="bg-amber-50 text-amber-600" />
                </div>

                {/* Recent result */}
                {lastResult && (
                  <Card padding="lg" hover>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                          <Trophy className="h-5 w-5 text-brand-600" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{String((lastResult as any).test_title || (lastResult as any).title || 'Recent Test')}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                            <span>
                              {String((lastResult as any).obtained_marks || 0)}/{(lastResult as any).total_marks || 100}
                            </span>
                            <Badge variant={Number((lastResult as any).percentage || 0) >= 40 ? 'success' : 'error'} size="sm">
                              {Number((lastResult as any).percentage || 0)}%
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Link href="/student/results" className="min-h-[44px] flex items-center text-xs font-medium text-brand-600 hover:text-brand-700">
                        View
                      </Link>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Number((lastResult as any).percentage || 0))}%` }} />
                    </div>
                  </Card>
                )}

                {/* Payments */}
                {errors.payments ? (
                  <Alert variant="error" title="Couldn't load payments" role="alert">
                    <p>Please try again.</p>
                    <button onClick={handleRetry} className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-50">
                      Retry
                    </button>
                  </Alert>
                ) : (
                  paymentPlans.length > 0 && (
                    <div className="space-y-3">
                      <h2 className="text-sm font-semibold text-text-primary">Payments</h2>
                      <div className="grid grid-cols-1 gap-3">
                        <Card padding="md">
                          <div className="flex items-center gap-2">
                            <IndianRupee className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                            <span className="text-xs text-text-secondary">Upcoming Dues</span>
                          </div>
                          <p className="mt-1 text-lg font-bold text-text-primary">{formatCurrency(upcomingDues)}</p>
                        </Card>
                        {overdueAmount > 0 && (
                          <Card padding="md" className="border-status-error/30">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-status-error" aria-hidden="true" />
                              <span className="text-xs text-text-secondary">Overdue</span>
                            </div>
                            <p className="mt-1 text-lg font-bold text-status-error">{formatCurrency(overdueAmount)}</p>
                          </Card>
                        )}
                        {nextDueDate && (
                          <Card padding="md">
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-4 w-4 text-brand-500" aria-hidden="true" />
                              <span className="text-xs text-text-secondary">Next Due</span>
                            </div>
                            <p className="mt-1 text-sm font-bold text-text-primary">
                              {new Date(nextDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          </Card>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </PageContainer>
      </>
    </ErrorBoundary>
  );
}
