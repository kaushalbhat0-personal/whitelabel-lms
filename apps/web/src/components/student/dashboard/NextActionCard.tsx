'use client';

import Link from 'next/link';
import { ClipboardList, Radio, Video, Trophy } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type NextAction =
  | { type: 'continue_video'; id: string; title: string; pct?: number }
  | { type: 'join_live'; id: string; title: string; status: string }
  | { type: 'pending_test'; id: string; title: string }
  | { type: 'view_result'; id: string; title: string; pct: number }
  | { type: 'start_learning'; title: string };

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

  if (action.type === 'continue_video') {
    href = `/student/videos/${action.id}`;
    cta = 'Continue';
    description = action.title;
  } else if (action.type === 'join_live') {
    href = `/student/live-sessions/${action.id}`;
    cta = action.status === 'live' ? 'Join Now' : 'View';
  } else if (action.type === 'pending_test') {
    href = `/student/tests/attempt/${action.id}`;
    cta = 'Start Test';
  } else if (action.type === 'view_result') {
    href = `/student/results`;
    cta = 'View Results';
  }

  const Icon = iconMap[action.type];

  const isLive = action.type === 'join_live' && action.status === 'live';
  return (
    <Card padding="lg" className="relative overflow-hidden border-l-4 border-l-brand-500 bg-gradient-to-br from-surface-card to-surface-muted/20 hover:shadow-card-hover transition-shadow">
      {isLive && <span className="absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />}
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isLive ? 'bg-red-50' : 'bg-brand-50'}`}>
          <Icon className={`h-4 w-4 ${isLive ? 'text-red-600' : 'text-brand-600'}`} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Next Up</p>
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-bold leading-tight text-text-primary">{description}</p>
      {action.type === 'continue_video' && action.pct != null && (
        <p className="text-xs text-text-muted mt-1">{action.pct}% completed</p>
      )}
      {isLive && <p className="text-xs font-medium text-red-600 mt-1">Live now</p>}
      <Link href={href} className="mt-4 inline-flex">
        <Button size="sm" variant={isLive ? 'primary' : 'outline'} className={isLive ? 'animate-pulse-soft' : ''}>
          {cta}
        </Button>
      </Link>
    </Card>
  );
}
