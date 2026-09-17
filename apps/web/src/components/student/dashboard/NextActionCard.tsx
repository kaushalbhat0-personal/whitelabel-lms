'use client';

import Link from 'next/link';
import { ClipboardList, Radio, Video, Trophy, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type NextAction =
  | { type: 'continue_video'; id: string; title: string; pct?: number; reason?: string }
  | { type: 'join_live'; id: string; title: string; status: string; reason?: string; startTime?: string }
  | { type: 'pending_test'; id: string; title: string; reason?: string }
  | { type: 'view_result'; id: string; title: string; pct: number; reason?: string }
  | { type: 'start_learning'; title: string; reason?: string };

export function NextActionCard({ action }: { action: NextAction }) {
  const iconMap = {
    continue_video: Video,
    join_live: Radio,
    pending_test: ClipboardList,
    view_result: Trophy,
    start_learning: Video,
  };

  let href = '/student/videos';
  let cta = 'Go';
  let description = action.title;
  let reason = (action as any).reason as string | undefined;

  if (action.type === 'continue_video') {
    href = `/student/videos/${action.id}`;
    cta = action.pct != null && action.pct > 0 ? 'Continue' : 'Start';
    description = action.title;
    if (!reason) reason = action.pct != null ? `${action.pct}% completed — pick up where you left off` : 'Continue your learning';
  } else if (action.type === 'join_live') {
    href = `/student/live-sessions/${action.id}`;
    cta = action.status === 'live' || action.status === 'starting_soon' ? 'Join Now' : 'View details';
    if (!reason) reason = action.status === 'live' ? 'Live now — join immediately' : action.status === 'starting_soon' ? 'Starting soon — join opens now' : undefined;
  } else if (action.type === 'pending_test') {
    href = `/student/tests/attempt/${action.id}`;
    cta = 'Start Test';
    if (!reason) reason = 'Requires your attention';
  } else if (action.type === 'view_result') {
    href = `/student/results`;
    cta = 'View Results';
    if (!reason) reason = `You scored ${action.pct}% — review your results`;
  } else if (action.type === 'start_learning') {
    href = '/student/videos';
    cta = 'Browse Videos';
    if (!reason) reason = 'Your learning journey starts here';
  }

  const Icon = iconMap[action.type];

  const isLive = action.type === 'join_live' && (action.status === 'live' || action.status === 'starting_soon');
  const isJoinable = isLive;
  return (
    <Card padding="lg" className="relative overflow-hidden border border-surface-border bg-surface-card hover:shadow-card-hover transition-shadow">
      {isLive && <span className="absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />}
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isLive ? 'bg-red-50' : 'bg-brand-50'}`}>
          <Icon className={`h-4 w-4 ${isLive ? 'text-red-600' : 'text-brand-600'}`} aria-hidden="true" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Next Up</p>
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-bold leading-tight text-text-primary">{description}</p>
      {reason && <p className="mt-1 text-xs leading-relaxed text-text-secondary">{reason}</p>}
      {action.type === 'continue_video' && action.pct != null && !reason?.includes('%') && (
        <p className="text-xs text-text-muted mt-1">{action.pct}% completed</p>
      )}
      <Link href={href} className="mt-4 inline-flex" aria-label={`${cta}: ${description}`}>
        <Button size="md" variant={isJoinable ? 'primary' : 'primary'} className={`min-h-[44px] ${isLive ? 'motion-safe:animate-pulse-soft' : ''}`}>
          {cta}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Link>
    </Card>
  );
}
