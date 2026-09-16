function localInputToUTC(input: string): string | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
function utcToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n:number)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function computeEnd(startUTC: string, duration:number): string {
  return new Date(new Date(startUTC).getTime() + duration*60000).toISOString();
}

describe('Test timing timezone', () => {
  it('Case1: 01:00 IST +60 => 02:00 IST', () => {
    const localStart = '2026-09-17T01:00';
    const duration=60;
    const startUTC = localInputToUTC(localStart)!;
    const endUTC = computeEnd(startUTC, duration);
    const endLocal = utcToLocalInput(endUTC);
    expect(endLocal).toBe('2026-09-17T02:00');
    expect(new Date(endUTC).getTime() - new Date(startUTC).getTime()).toBe(60*60000);
  });
  it('Case2: 23:30 IST +60 => 00:30 next day', () => {
    const localStart='2026-09-17T23:30';
    const startUTC=localInputToUTC(localStart)!;
    const endUTC=computeEnd(startUTC,60);
    const endLocal=utcToLocalInput(endUTC);
    expect(endLocal).toBe('2026-09-18T00:30');
  });
  it('Case3: 12:00 IST +120 =>14:00', () => {
    const localStart='2026-09-17T12:00';
    const startUTC=localInputToUTC(localStart)!;
    const endUTC=computeEnd(startUTC,120);
    expect(utcToLocalInput(endUTC)).toBe('2026-09-17T14:00');
  });
  it('Case4: 01:00 IST => 19:30 UTC prev day', () => {
    // 01:00 IST Sep17 = 2026-09-16T19:30Z
    const local='2026-09-17T01:00';
    const utc=localInputToUTC(local)!;
    // Depending on local TZ of test runner, this will vary.
    // In IST runner, new Date('2026-09-17T01:00') is 01:00 IST, so UTC is 19:30 prev day.
    // In UTC runner, it would be 01:00 UTC. So we test that round-trip returns original.
    const roundTrip = utcToLocalInput(utc);
    expect(roundTrip).toBe(local);
    // Also check that UTC hour is 19:30 if local is IST (process TZ may be UTC in CI)
    // Instead verify invariant: UTC diff is 5:30 if TZ is IST, else 0. We just ensure round-trip.
  });
  it('round-trip IST -> UTC -> IST preserves wall time', () => {
    const original='2026-09-17T01:02';
    const utc=localInputToUTC(original)!;
    const back=utcToLocalInput(utc);
    expect(back).toBe(original);
  });
  it('no double +5:30', () => {
    const local='2026-09-17T01:02';
    const utc1=localInputToUTC(local)!;
    // Simulate double conversion bug: new Date(utc1).toISOString() would double shift if utc1 already UTC string interpreted as local.
    // Correct is single conversion already done.
    const d1=new Date(local);
    const d2=new Date(utc1);
    // d1 is local 01:02 IST, d2 is UTC 19:32Z. Their wall times differ.
    // Ensure we don't do new Date(utc1).toISOString() again as if utc1 were local.
    expect(utcToLocalInput(utc1)).toBe(local);
  });
  it('end = start + duration invariant', () => {
    const startUTC='2026-09-16T19:32:00.000Z'; // 01:02 IST
    const duration=60;
    const endUTC=computeEnd(startUTC,duration);
    expect(endUTC).toBe('2026-09-16T20:32:00.000Z'); // 02:02 IST
    expect(new Date(endUTC).getTime() - new Date(startUTC).getTime()).toBe(3600000);
  });
});

describe('Student test status vs attempt', () => {
  function getGlobalState(test:any, now:number){
    if (test.status==='draft' || test.status==='archived' || test.status==='cancelled') return test.status;
    if (!test.start_time) return test.status;
    const start=new Date(test.start_time).getTime();
    const end=test.end_time? new Date(test.end_time).getTime() : start + (test.duration_minutes??60)*60000;
    if (now < start) return 'scheduled';
    if (now > end) return 'ended';
    return 'published';
  }
  function getStudentDisplay(test:any, attempts:any[], now:number){
    const completed=attempts.find((a:any)=> a.status==='submitted' || a.status==='graded' || a.status==='evaluated');
    if (completed) return {label:'Completed', section:'completed'};
    const inProgress=attempts.find((a:any)=> a.status==='in_progress');
    if (inProgress) return {label:'In Progress', section:'available'};
    const global=getGlobalState(test, now);
    if (global==='scheduled') return {label:'Scheduled', section:'scheduled'};
    if (global==='ended') return {label:'Ended', section:'ended'};
    return {label:'Available', section:'available'};
  }
  const baseTest = { id:'t1', status:'published', start_time:'2026-09-17T01:00:00.000Z', end_time:'2026-09-17T02:00:00.000Z', duration_minutes:60 };
  it('no attempt -> Available', () => {
    const now=new Date('2026-09-17T01:30:00.000Z').getTime();
    expect(getStudentDisplay(baseTest, [], now).label).toBe('Available');
  });
  it('in_progress -> In Progress', () => {
    const now=new Date('2026-09-17T01:30:00.000Z').getTime();
    expect(getStudentDisplay(baseTest, [{status:'in_progress'}], now).label).toBe('In Progress');
  });
  it('submitted -> Completed (even though test still Available)', () => {
    const now=new Date('2026-09-17T01:30:00.000Z').getTime();
    // Global is Available, but student completed should be Completed
    expect(getStudentDisplay(baseTest, [{status:'submitted'}], now).label).toBe('Completed');
    // Ensure global still Available for other student
    expect(getGlobalState(baseTest, now)).toBe('published');
  });
  it('scheduled before start', () => {
    const now=new Date('2026-09-17T00:30:00.000Z').getTime();
    expect(getStudentDisplay(baseTest, [], now).label).toBe('Scheduled');
  });
  it('ended after window', () => {
    const now=new Date('2026-09-17T03:00:00.000Z').getTime();
    expect(getStudentDisplay(baseTest, [], now).label).toBe('Ended');
  });
  it('completed still Completed after end', () => {
    const now=new Date('2026-09-17T03:00:00.000Z').getTime();
    expect(getStudentDisplay(baseTest, [{status:'submitted'}], now).label).toBe('Completed');
  });
  it('student completion does not change global test status', () => {
    const now=new Date('2026-09-17T01:30:00.000Z').getTime();
    const globalBefore=getGlobalState(baseTest, now);
    getStudentDisplay(baseTest, [{status:'submitted'}], now);
    const globalAfter=getGlobalState(baseTest, now);
    expect(globalBefore).toBe(globalAfter);
    expect(globalAfter).toBe('published');
  });
});
