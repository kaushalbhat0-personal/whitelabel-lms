export type DerivedState = 'scheduled' | 'starting_soon' | 'live' | 'ended' | 'cancelled';

export function deriveSessionState(session: { start_time: string; duration_minutes?: number; status: string }, nowMs: number = Date.now()): DerivedState {
  if (session.status === 'cancelled') return 'cancelled';
  const start = new Date(session.start_time).getTime();
  const end = start + (session.duration_minutes ?? 60) * 60000;
  if (nowMs >= end || session.status === 'ended') {
    // ended status is terminal, but time-based ended also counts
    // if status is 'ended' but time still before end, treat as ended
    if (session.status === 'ended') return 'ended';
    if (nowMs >= end) return 'ended';
  }
  if (nowMs >= start && nowMs < end) return 'live';
  if (nowMs >= start - 15 * 60 * 1000 && nowMs < start) return 'starting_soon';
  return 'scheduled';
}

export function getRelativeTime(startTime: string, nowMs: number = Date.now()): string {
  const diff = new Date(startTime).getTime() - nowMs;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Starts in ${days}d`;
  if (hours > 0) return `Starts in ${hours}h`;
  if (mins > 0) return `Starts in ${mins}m`;
  return 'Starting now';
}

export function getTimeLabel(session: { start_time: string; duration_minutes?: number; status: string }, nowMs: number = Date.now()): string {
  const state = deriveSessionState(session, nowMs);
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'ended') return 'Ended';
  if (state === 'live') return 'Live Now';
  if (state === 'starting_soon') return 'Starting soon';
  return getRelativeTime(session.start_time, nowMs);
}

export function isJoinable(session: { start_time: string; duration_minutes?: number; status: string }, nowMs: number = Date.now()): boolean {
  if (session.status === 'cancelled' || session.status === 'ended') return false;
  const start = new Date(session.start_time).getTime();
  const end = start + (session.duration_minutes ?? 60) * 60000;
  return nowMs >= start - 15 * 60 * 1000 && nowMs <= end;
}

export function canShowJoin(session: { start_time: string; duration_minutes?: number; status: string }, nowMs: number = Date.now()): boolean {
  return (session.status === 'live' || session.status === 'scheduled') && isJoinable(session, nowMs);
}

export function isUpcomingByTime(session: { start_time: string; duration_minutes?: number; status: string }, nowMs: number = Date.now()): boolean {
  if (session.status === 'cancelled' || session.status === 'ended') return false;
  const end = new Date(session.start_time).getTime() + (session.duration_minutes ?? 60) * 60000;
  return nowMs <= end;
}
