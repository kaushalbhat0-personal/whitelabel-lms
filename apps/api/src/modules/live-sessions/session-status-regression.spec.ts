/**
 * Live session status regression — time-aware derivation
 * Start 00:20 IST (18:50Z previous day) duration 60 end 01:20
 * Tests mirror apps/web/src/lib/session-status.ts
 */
function deriveState(startIso: string, duration: number, status: string, nowMs: number) {
  if (status === 'cancelled') return 'cancelled';
  const start = new Date(startIso).getTime();
  const end = start + (duration ?? 60) * 60000;
  if (nowMs >= end || status === 'ended') {
    if (status === 'ended') return 'ended';
    if (nowMs >= end) return 'ended';
  }
  if (nowMs >= start && nowMs < end) return 'live';
  if (nowMs >= start - 15*60*1000 && nowMs < start) return 'starting_soon';
  return 'scheduled';
}
function getLabel(startIso: string, duration: number, status: string, nowMs: number) {
  const s = deriveState(startIso, duration, status, nowMs);
  if (s==='cancelled') return 'Cancelled';
  if (s==='ended') return 'Ended';
  if (s==='live') return 'Live Now';
  if (s==='starting_soon') return 'Starting soon';
  const diff = new Date(startIso).getTime() - nowMs;
  const mins=Math.floor(diff/60000); const hrs=Math.floor(mins/60); const days=Math.floor(hrs/24);
  if (days>0) return `Starts in ${days}d`;
  if (hrs>0) return `Starts in ${hrs}h`;
  if (mins>0) return `Starts in ${mins}m`;
  return 'Starting now';
}
describe('Live session time-aware status', () => {
  const startIso = new Date('2026-09-18T00:20:00+05:30').toISOString(); // 18:50Z 17th
  const duration = 60;
  const startMs = new Date(startIso).getTime();
  const endMs = startMs + 60*60000;
  it('12:00 -> Scheduled (20 min before, outside 15m window)', () => {
    const now = startMs - 20*60000; // 00:00
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('scheduled');
    expect(getLabel(startIso, duration, 'scheduled', now)).toMatch(/Starts in/);
  });
  it('12:19 -> Starting soon (1 min before)', () => {
    const now = startMs - 1*60000;
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('starting_soon');
  });
  it('12:20 -> Live Now', () => {
    const now = startMs;
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('live');
    expect(getLabel(startIso, duration, 'scheduled', now)).toBe('Live Now');
  });
  it('12:23 -> Live Now', () => {
    const now = startMs + 3*60000;
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('live');
  });
  it('13:19 -> Live Now (1 min before end)', () => {
    const now = endMs - 1*60000;
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('live');
  });
  it('13:20 -> Ended', () => {
    const now = endMs;
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('ended');
    expect(getLabel(startIso, duration, 'scheduled', now)).toBe('Ended');
  });
  it('13:21 -> Ended', () => {
    const now = endMs + 60000;
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('ended');
  });
  it('cancelled stays Cancelled even during live window', () => {
    const now = startMs + 10*60000;
    expect(deriveState(startIso, duration, 'cancelled', now)).toBe('cancelled');
    expect(getLabel(startIso, duration, 'cancelled', now)).toBe('Cancelled');
  });
  it('scheduled before 15min window shows Starts in', () => {
    const now = startMs - 30*60000; // 23:50 previous day
    expect(deriveState(startIso, duration, 'scheduled', now)).toBe('scheduled');
    expect(getLabel(startIso, duration, 'scheduled', now)).toMatch(/Starts in/);
  });
});
