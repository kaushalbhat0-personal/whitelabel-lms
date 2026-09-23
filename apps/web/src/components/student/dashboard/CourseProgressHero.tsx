'use client';

import Link from 'next/link';
import { BookOpen, CheckCircle2, Play, ChevronRight, TrendingUp, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { StudentBatchRecordings, StudentSection } from '@/lib/api/videos';

type MarkerState = 'completed' | 'current' | 'upcoming';

function getSectionMarkerState(section: StudentSection, idx: number, perSection: number, pct: number): MarkerState {
  const sCompleted = section.recordings.filter((r) => r.progress.completed).length;
  const sInProgress = section.recordings.filter((r) => !r.progress.completed && r.progress.watchedSeconds > 0).length;
  const sectionPctStart = idx * perSection;
  const sectionPctEnd = (idx + 1) * perSection;
  if (sCompleted === section.recordings.length && section.recordings.length > 0) return 'completed';
  if (sInProgress > 0 || (pct > sectionPctStart && pct < sectionPctEnd)) return 'current';
  if (pct >= sectionPctEnd) return 'completed';
  return 'upcoming';
}

interface Props {
  total: number;
  completed: number;
  inProgress: number;
  courseName?: string | null;
  batchName?: string | null;
  grouped?: StudentBatchRecordings[];
}

export function CourseProgressHero({ total, completed, inProgress, courseName, batchName, grouped }: Props) {
  const pctCourse = total > 0 ? Math.round((completed / total) * 100) : 0;
  const remainingCourse = Math.max(0, total - completed - inProgress);

  if (total === 0) {
    return (
      <Card padding="lg">
        <div className="text-center py-4">
          <BookOpen className="mx-auto h-8 w-8 text-text-muted" />
          <p className="mt-2 text-sm font-medium text-text-primary">Your learning journey starts here</p>
          <p className="text-xs text-text-muted mt-1">Enroll in a batch to track progress</p>
          <Link href="/student/courses" className="mt-3 inline-flex text-xs font-medium text-brand-600 hover:text-brand-700">
            Browse courses <ChevronRight className="ml-1 h-3 w-3" />
          </Link>
        </div>
      </Card>
    );
  }

  // Primary batch — Phase C: Hero must represent ONE coherent batch
  const primaryBatch = (() => {
    if (!grouped || grouped.length === 0) return null;
    const byName = batchName ? grouped.find((b) => b.batchName === batchName) : null;
    return byName ?? grouped[0];
  })();
  const sections = primaryBatch?.sections ?? [];
  const hasSections = sections.length > 0;
  const n = sections.length;
  const perSection = n > 0 ? 100 / n : 25;

  // Ordered recordings in curriculum order (Phase A guarantees sort_order)
  const orderedRecordings = hasSections ? sections.flatMap((s) => s.recordings) : [];

  // Scoped progress — Phase C: totals must reflect primary batch only (fix 8/0% leakage)
  const scoped = (() => {
    if (!hasSections) return { total, completed, inProgress, remaining: remainingCourse, pct: pctCourse };
    const t = orderedRecordings.length;
    const c = orderedRecordings.filter((r) => r.progress.completed).length;
    const ip = orderedRecordings.filter((r) => !r.progress.completed && r.progress.watchedSeconds > 0).length;
    const rem = Math.max(0, t - c - ip);
    const p = t > 0 ? Math.round((c / t) * 100) : 0;
    return { total: t, completed: c, inProgress: ip, remaining: rem, pct: p };
  })();
  const pct = hasSections ? scoped.pct : pctCourse;
  const remaining = hasSections ? scoped.remaining : remainingCourse;
  // Display totals scoped when we have sections
  const displayTotal = hasSections ? scoped.total : total;
  const displayCompleted = hasSections ? scoped.completed : completed;
  const displayInProgress = hasSections ? scoped.inProgress : inProgress;

  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (pct / 100) * circumference;

  // Section-level indices (for markers/trend) — keep for visualization
  const currentIdxSection = hasSections
    ? (() => {
        let idx = sections.findIndex((s) => s.recordings.some((r) => !r.progress.completed && r.progress.watchedSeconds > 0));
        if (idx === -1) idx = sections.findIndex((s) => s.recordings.some((r) => !r.progress.completed));
        return idx;
      })()
    : -1;
  const currentSection = currentIdxSection !== -1 ? sections[currentIdxSection] : null;

  const nextIdxSection = hasSections
    ? sections.findIndex((s, idx) => {
        const prevDone = sections.slice(0, idx).every((ps) => ps.recordings.every((r) => r.progress.completed));
        return !s.recordings.every((r) => r.progress.completed) && prevDone && s !== currentSection;
      })
    : -1;
  const nextSection = nextIdxSection !== -1 ? sections[nextIdxSection] : null;

  // Recording-aware Current/Next (Phase B) — overrides section labels when single category has many recordings
  const currentRecording =
    orderedRecordings.find((r) => !r.progress.completed && r.progress.watchedSeconds > 0) ??
    orderedRecordings.find((r) => !r.progress.completed) ??
    null;
  const currentLabel =
    currentRecording?.title ??
    currentSection?.sectionName ??
    (inProgress > 0 ? 'In progress' : remaining > 0 ? 'Not started' : 'Completed');

  const nextRecording = (() => {
    if (!currentRecording) return null;
    const curIdx = orderedRecordings.findIndex((r) => r.id === currentRecording.id);
    if (curIdx === -1) return null;
    return orderedRecordings.slice(curIdx + 1).find((r) => !r.progress.completed) ?? null;
  })();
  const nextLabel =
    nextRecording?.title ??
    nextSection?.sectionName ??
    (remaining > 1 ? `${remaining} remaining` : remaining === 1 ? '1 remaining' : null);

  // Keep section indices for marker state (currentIdx for markers)
  const currentIdx = currentIdxSection;
  const nextIdx = nextIdxSection;

  // Phase C: when single category holds many recordings, checkpoints must be recordings (not one section name)
  const useRecordingMarkers = n === 1 && orderedRecordings.length > 1;
  const effectiveCount = useRecordingMarkers ? orderedRecordings.length : n;

  // Fallback when no sections: 4 equal quartile steps (generic % labels, not module identities)
  const fallbackCheckpoints = !hasSections
    ? Array.from({ length: 4 }, (_, i) => ({
        label: `M${i + 1}`,
        shortLabel: `${(i + 1) * 25}%`,
        state: (i * 25 < pct ? 'completed' : i * 25 === pct ? 'current' : 'upcoming') as 'completed' | 'current' | 'upcoming',
        x: (i / 3) * 180 + 10,
        y: Math.max(10, Math.min(34, 32 - (pct / 100) * 14 - (i / 4) * 4 + Math.sin(i * 0.9) * 1.5)),
      }))
    : null;

  // ── True continuous trend: x based on actual curriculum index; y rises with overall pct + gentle undulation ──
  // Line spans full course 0..effectiveCount-1 regardless of how many markers are labeled.
  const fullCoursePoints: { x: number; y: number }[] = hasSections
    ? useRecordingMarkers
      ? orderedRecordings.map((_, idx) => {
          const x = effectiveCount > 1 ? (idx / (effectiveCount - 1)) * 180 + 10 : 100;
          const baseY = 32 - (pct / 100) * 14 - (idx / effectiveCount) * 4;
          const y = Math.max(10, Math.min(34, baseY + Math.sin(idx * 0.9) * 1.5));
          return { x, y };
        })
      : n === 1
        ? [{ x: 100, y: Math.max(10, Math.min(34, 32 - (pct / 100) * 14 + Math.sin(0) * 1.5)) }]
        : sections.map((_, idx) => {
            const x = (idx / (n - 1)) * 180 + 10;
            const baseY = 32 - (pct / 100) * 14 - (idx / n) * 4;
            const y = Math.max(10, Math.min(34, baseY + Math.sin(idx * 0.9) * 1.5));
            return { x, y };
          })
    : fallbackCheckpoints
      ? fallbackCheckpoints.map((c) => ({ x: c.x, y: c.y }))
      : [];

  const fullPathD =
    fullCoursePoints.length > 1 ? `M ${fullCoursePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}` : '';

  // ── Semantic markers: at most ~5, each MUST correspond to a real section index, x = true position ──
  type Marker = { sectionIndex: number; label: string; state: 'completed' | 'current' | 'upcoming'; x: number; y: number };
  const markers: Marker[] = (() => {
    if (!hasSections) {
      // Fallback markers = same as fallback checkpoints (already positioned)
      return (
        fallbackCheckpoints?.map((c, i) => ({
          sectionIndex: i,
          label: c.label,
          state: c.state,
          x: c.x,
          y: c.y,
        })) ?? []
      );
    }
    if (n === 1) {
      if (useRecordingMarkers) {
        const rCount = orderedRecordings.length;
        // Helper to derive marker state per recording
        const recState = (r: any, idx: number): MarkerState => {
          if (r.progress.completed) return 'completed';
          if (!r.progress.completed && r.progress.watchedSeconds > 0) return 'current';
          if (currentRecording && r.id === currentRecording.id) return 'current';
          // If pct indicates progress beyond this recording, mark completed for visual continuity
          if (pct >= 100) return 'completed';
          return 'upcoming';
        };
        if (rCount <= 5) {
          return orderedRecordings.map((r, idx) => {
            const raw = r.title ?? `R${idx + 1}`;
            const pt = fullCoursePoints[idx];
            return { sectionIndex: idx, label: raw.length > 14 ? raw.slice(0, 14) + '…' : raw, state: recState(r, idx), x: pt.x, y: pt.y };
          });
        }
        // >5 recordings in single category: adaptive sampling (first, current, next, last + gap)
        const curIdxRec = currentRecording ? orderedRecordings.findIndex((r) => r.id === currentRecording.id) : -1;
        const nextIdxRec = nextRecording ? orderedRecordings.findIndex((r) => r.id === nextRecording.id) : -1;
        const idxSet = new Set<number>();
        idxSet.add(0);
        idxSet.add(rCount - 1);
        if (curIdxRec !== -1) idxSet.add(curIdxRec);
        if (nextIdxRec !== -1) idxSet.add(nextIdxRec);
        if (idxSet.size < 5) {
          const sorted = [...idxSet].sort((a, b) => a - b);
          let bestGap = -1;
          let bestMid = -1;
          for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1] - sorted[i];
            if (gap > bestGap) { bestGap = gap; bestMid = Math.floor((sorted[i] + sorted[i + 1]) / 2); }
          }
          if (bestGap > 2 && bestMid !== -1 && !idxSet.has(bestMid) && idxSet.size < 5) idxSet.add(bestMid);
        }
        let selected = [...idxSet].sort((a, b) => a - b);
        if (selected.length > 5) selected = selected.slice(0, 5);
        return selected.map((idx) => {
          const r = orderedRecordings[idx];
          const raw = r.title ?? `R${idx + 1}`;
          const pt = fullCoursePoints[idx];
          return { sectionIndex: idx, label: raw.length > 14 ? raw.slice(0, 14) + '…' : raw, state: recState(r, idx), x: pt.x, y: pt.y };
        });
      }
      const s = sections[0];
      const sCompleted = s.recordings.filter((r) => r.progress.completed).length;
      const sInProgress = s.recordings.filter((r) => !r.progress.completed && r.progress.watchedSeconds > 0).length;
      let state: 'completed' | 'current' | 'upcoming' = 'upcoming';
      if (sCompleted === s.recordings.length && s.recordings.length > 0) state = 'completed';
      else if (sInProgress > 0 || pct > 0) state = 'current';
      else if (pct >= 100) state = 'completed';
      const raw = s.sectionName ?? 'M1';
      return [{ sectionIndex: 0, label: raw.length > 14 ? raw.slice(0, 14) + '…' : raw, state, x: 100, y: fullCoursePoints[0].y }];
    }
    if (n <= 5) {
      return sections.map((s, idx) => {
        const state = getSectionMarkerState(s, idx, perSection, pct);
        const raw = s.sectionName ?? `M${idx + 1}`;
        const pt = fullCoursePoints[idx];
        return {
          sectionIndex: idx,
          label: raw.length > 14 ? raw.slice(0, 14) + '…' : raw,
          state,
          x: pt.x,
          y: pt.y,
        };
      });
    }
    // n > 5: adaptive semantic markers — must include first, current, next, last; one extra gap anchor if needed
    const idxSet = new Set<number>();
    idxSet.add(0);
    idxSet.add(n - 1);
    if (currentIdx !== -1) idxSet.add(currentIdx);
    if (nextIdx !== -1) idxSet.add(nextIdx);

    // One additional meaningful anchor if sparse (largest gap > 2)
    if (idxSet.size < 5) {
      const sorted = [...idxSet].sort((a, b) => a - b);
      let bestGap = -1;
      let bestMid = -1;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1] - sorted[i];
        if (gap > bestGap) {
          bestGap = gap;
          bestMid = Math.floor((sorted[i] + sorted[i + 1]) / 2);
        }
      }
      // Only add if gap meaningfully >2 (so ellipsis matters) and mid not already present and keeps max 5
      if (bestGap > 2 && bestMid !== -1 && !idxSet.has(bestMid) && idxSet.size < 5) {
        // Avoid adding immediately adjacent to current/next when they're already clustered — keep distance at least 1
        idxSet.add(bestMid);
      }
    }

    // Ensure we never exceed 5 after gap insertion (cap)
    let selected = [...idxSet].sort((a, b) => a - b);
    if (selected.length > 5) selected = selected.slice(0, 5); // defensive; should not happen with current logic (max 5)

    return selected.map((idx) => {
      const s = sections[idx];
      const state = getSectionMarkerState(s, idx, perSection, pct);
      const raw = s.sectionName ?? `M${idx + 1}`;
      const pt = fullCoursePoints[idx];
      return {
        sectionIndex: idx,
        label: raw.length > 14 ? raw.slice(0, 14) + '…' : raw,
        state,
        x: pt.x,
        y: pt.y,
      };
    });
  })();

  // For marker label positioning: need gap/ellipsis data when markers non-contiguous
  const markerGaps: { between: [number, number]; midX: number }[] = (() => {
    if (!hasSections || n <= 5 || markers.length < 2) return [];
    const gaps: { between: [number, number]; midX: number }[] = [];
    for (let i = 0; i < markers.length - 1; i++) {
      if (markers[i + 1].sectionIndex - markers[i].sectionIndex > 1) {
        const midX = (markers[i].x + markers[i + 1].x) / 2;
        gaps.push({ between: [markers[i].sectionIndex, markers[i + 1].sectionIndex], midX });
      }
    }
    return gaps;
  })();

  const showDisclosure = hasSections && effectiveCount > 5;
  const ariaLabel = hasSections
    ? `${pct}% complete. ${displayCompleted} completed, ${displayInProgress} in progress, ${remaining} not started. ${effectiveCount} steps total. Current position ${currentLabel}${nextLabel ? `, next up ${nextLabel}` : ''}.`
    : `${pct}% complete. ${completed} completed, ${inProgress} in progress, ${remaining} not started. Current position ${currentLabel}${nextLabel ? `, next up ${nextLabel}` : ''}.`;

  return (
    <Card padding="lg" className="overflow-hidden transition-shadow hover:shadow-card-hover">
      {/* Header: Learning Momentum */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Learning Momentum</p>
          </div>
          <p className="mt-1 text-[11px] leading-none text-text-muted">Your learning is moving forward.</p>
          {courseName && <p className="mt-2 text-sm font-medium text-text-primary truncate">{courseName}</p>}
          {batchName && <p className="text-xs text-text-muted truncate">{batchName}</p>}
        </div>
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center" aria-hidden>
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" strokeWidth="4" className="fill-none stroke-brand-100" />
            <circle
              cx="32"
              cy="32"
              r="28"
              strokeWidth="4"
              className="fill-none stroke-brand-600 motion-safe:transition-all motion-safe:duration-[900ms] motion-safe:ease-out"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span className="absolute text-sm font-bold text-brand-700">{pct}%</span>
        </div>
      </div>

      {/* Momentum visual — continuous true course trend + limited semantic markers */}
      <div
        className="mt-4 rounded-xl border border-surface-border bg-surface-muted/30 px-3 py-3 sm:px-4"
        role="img"
        aria-label={ariaLabel}
      >
        <div className="relative">
          <svg viewBox="0 0 200 40" className="h-[48px] w-full sm:h-[56px]" preserveAspectRatio="none" aria-hidden>
            {/* baseline */}
            <line x1="10" y1="36" x2="190" y2="36" stroke="currentColor" className="text-surface-border" strokeWidth="0.7" opacity="0.9" />
            {fullCoursePoints.length > 1 && (
              <path
                d={fullPathD}
                fill="none"
                stroke="currentColor"
                className="text-brand-600"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* semantic markers — x = true sectionIndex position, not display order */}
            {markers.map((m) => (
              <g key={`m-${m.sectionIndex}`}>
                {/* halo for current — not color-only */}
                {m.state === 'current' && <circle cx={m.x} cy={m.y} r={6} className="fill-brand-600/10" />}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={m.state === 'current' ? 4.2 : 3.4}
                  className={
                    m.state === 'completed'
                      ? 'fill-brand-600 stroke-white'
                      : m.state === 'current'
                        ? 'fill-white stroke-brand-600'
                        : 'fill-white stroke-surface-border'
                  }
                  strokeWidth={m.state === 'current' ? 2 : 1.4}
                />
                {m.state === 'completed' && <circle cx={m.x} cy={m.y} r={1.2} className="fill-white" />}
              </g>
            ))}
            {/* ellipsis for non-contiguous gaps — subtle, inside SVG so it scales with trend */}
            {markerGaps.map((g, i) => (
              <text key={`gap-${i}`} x={g.midX} y={34} textAnchor="middle" className="fill-text-muted" fontSize="6" aria-hidden>
                …
              </text>
            ))}
          </svg>

          {/* Labels: positional when hasSections, grid fallback otherwise */}
          {hasSections ? (
            <div className="relative mt-1 h-6 w-full select-none overflow-hidden">
              {/* tiny track dots + labels absolutely positioned at true x; edge labels anchored to avoid 320px clipping */}
              {markers.map((m, i) => {
                const isSingle = markers.length === 1;
                const isFirst = !isSingle && i === 0 && m.sectionIndex === 0;
                const isLast = !isSingle && i === markers.length - 1 && m.sectionIndex === n - 1;
                let style: React.CSSProperties;
                let containerClass: string;
                let textAlignClass: string;
                if (isSingle) {
                  style = { left: '50%', transform: 'translateX(-50%)', maxWidth: '88px' };
                  containerClass = 'absolute top-0 flex flex-col items-center';
                  textAlignClass = 'text-center';
                } else if (isFirst) {
                  style = { left: '0', transform: 'translateX(0)', maxWidth: '72px' };
                  containerClass = 'absolute top-0 flex flex-col items-start';
                  textAlignClass = 'text-left';
                } else if (isLast) {
                  style = { right: '0', left: 'auto', transform: 'translateX(0)', maxWidth: '72px' };
                  containerClass = 'absolute top-0 flex flex-col items-end';
                  textAlignClass = 'text-right';
                } else {
                  style = {
                    left: `${(m.x / 200) * 100}%`,
                    transform: 'translateX(-50%)',
                    maxWidth: markers.length > 3 ? '72px' : '88px',
                  };
                  containerClass = 'absolute top-0 flex flex-col items-center';
                  textAlignClass = 'text-center';
                }
                return (
                  <div key={`label-${m.sectionIndex}`} className={containerClass} style={style}>
                    <div
                      className={`h-1 w-6 rounded-full sm:w-8 ${m.state === 'completed' ? 'bg-brand-600' : m.state === 'current' ? 'bg-brand-600/60' : 'bg-surface-border'}`}
                      aria-hidden
                    />
                    <p
                      className={`mt-1 max-w-[72px] truncate ${textAlignClass} text-[10px] font-medium leading-tight sm:max-w-[88px] sm:text-xs`}
                      title={m.label}
                    >
                      <span className={m.state === 'completed' ? 'text-brand-700' : m.state === 'current' ? 'text-text-primary' : 'text-text-muted'}>
                        {m.label}
                      </span>
                    </p>
                  </div>
                );
              })}
              {/* ellipsis labels overlay between gaps (HTML layer for crisp rendering at small sizes) */}
              {markerGaps.map((g, i) => (
                <span
                  key={`el-${i}`}
                  className="pointer-events-none absolute top-[2px] select-none text-[10px] font-medium leading-none text-text-muted/60"
                  style={{ left: `${(g.midX / 200) * 100}%`, transform: 'translateX(-50%)' }}
                  aria-hidden
                >
                  …
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${markers.length}, minmax(0, 1fr))` }}>
              {markers.map((cp) => (
                <div key={`fb-${cp.sectionIndex}`} className="min-w-0 text-center">
                  <div
                    className={`mx-auto h-1 w-6 rounded-full sm:w-8 ${cp.state === 'completed' ? 'bg-brand-600' : cp.state === 'current' ? 'bg-brand-600/60' : 'bg-surface-border'}`}
                    aria-hidden
                  />
                  <p className="mt-1 truncate text-[10px] font-medium leading-tight sm:text-xs" title={cp.label}>
                    <span className={cp.state === 'completed' ? 'text-brand-700' : cp.state === 'current' ? 'text-text-primary' : 'text-text-muted'}>
                      {cp.label}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {showDisclosure && (
            <p className="mt-1 text-center text-[10px] leading-none text-text-muted/70">
              {n} modules · Key milestones shown
            </p>
          )}

          {/* Screen-reader truthful description — covers full course, not just displayed markers */}
          <p className="sr-only">
            {displayCompleted} of {displayTotal} completed, {displayInProgress} in progress, {remaining} not started. {hasSections ? `${effectiveCount} steps total.` : ''} Current position {currentLabel}
            {nextLabel ? `, next up ${nextLabel}` : ''}.
          </p>
        </div>

        {/* Current position + Next up — authoritative, never hover-only */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 border border-surface-border">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none">Current position</p>
              <p className="mt-1 truncate text-xs font-medium text-text-primary">{currentLabel}</p>
              {currentRecording && (() => {
                const secName = sections.find((s) => s.recordings.some((r) => r.id === currentRecording.id))?.sectionName;
                return secName ? <p className="mt-0.5 truncate text-[10px] leading-none text-text-muted">{secName}</p> : null;
              })()}
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 border border-surface-border">
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none">Next up</p>
              <p className="mt-1 truncate text-xs font-medium text-text-primary">{nextLabel ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs text-text-muted">
        <span className="font-medium text-text-primary">{displayCompleted} / {displayTotal}</span> completed · {displayInProgress} in progress · {remaining} remaining
        <span className="ml-1.5 hidden sm:inline text-brand-600">• {pct}% complete</span>
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 py-2">
          <div className="flex items-center justify-center gap-1 text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold">{displayCompleted}</span>
          </div>
          <p className="text-2xs text-emerald-600">Completed</p>
        </div>
        <div className="rounded-lg bg-brand-50 py-2">
          <div className="flex items-center justify-center gap-1 text-brand-700">
            <Play className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold">{displayInProgress}</span>
          </div>
          <p className="text-2xs text-brand-600">In Progress</p>
        </div>
        <div className="rounded-lg bg-surface-muted py-2">
          <span className="text-xs font-semibold text-text-secondary">{remaining}</span>
          <p className="text-2xs text-text-muted">Not Started</p>
        </div>
      </div>
    </Card>
  );
}
