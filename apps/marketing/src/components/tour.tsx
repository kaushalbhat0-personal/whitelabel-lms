import { Award, ClipboardCheck, LayoutDashboard, Receipt, Video } from 'lucide-react';

/**
 * Editorial product tour (MKT-01C).
 *
 * Static alternating rows — no carousel, no tabs, no client JS.
 * Visuals are honest CSS compositions from confirmed UI patterns with
 * fictional data (same policy as the hero preview). Each visual is
 * aria-hidden; the adjacent copy carries the meaning.
 */

const stops = [
  {
    id: 'learn',
    icon: Video,
    eyebrow: 'Learn',
    title: 'Give students a structured learning experience.',
    text: 'Courses, batches, video learning, progress tracking, and results — one continuous journey instead of scattered links and downloads.',
    visual: <LearnVisual />,
  },
  {
    id: 'assess',
    icon: ClipboardCheck,
    eyebrow: 'Assess',
    title: 'Assess understanding without leaving the LMS.',
    text: 'Tests, a reusable question bank, auto-grading for objective questions, and results students and teachers can both see.',
    visual: <AssessVisual />,
  },
  {
    id: 'manage',
    icon: LayoutDashboard,
    eyebrow: 'Manage',
    title: 'Run the academy from one place.',
    text: 'Students, courses, batches, sessions, announcements, and analytics — the daily operation of the institute in a single admin view.',
    visual: <ManageVisual />,
  },
  {
    id: 'collect',
    icon: Receipt,
    eyebrow: 'Collect',
    title: 'Keep fee collection organized.',
    text: 'Fee plans, EMI tracking, recorded payments, and GST invoices and receipts — finance without the spreadsheet.',
    visual: <CollectVisual />,
  },
  {
    id: 'prove',
    icon: Award,
    eyebrow: 'Prove',
    title: 'Give students something they can verify.',
    text: 'Certificates issued on completion, each with a public verification page employers and institutes can check.',
    visual: <ProveVisual />,
  },
];

export function ProductTour() {
  return (
    <div className="mt-12 space-y-10 sm:space-y-14">
      {stops.map((s, i) => (
        <article
          key={s.id}
          aria-labelledby={`tour-${s.id}`}
          className={`grid items-center gap-6 lg:grid-cols-2 lg:gap-12 ${i % 2 === 1 ? '' : ''}`}
        >
          <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-teal">
              <s.icon size={16} aria-hidden="true" />
              {s.eyebrow}
            </p>
            <h3 id={`tour-${s.id}`} className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {s.title}
            </h3>
            <p className="mt-3 max-w-lg text-lg leading-relaxed text-ink-soft">{s.text}</p>
          </div>
          <div className={i % 2 === 1 ? 'lg:order-1' : ''}>{s.visual}</div>
        </article>
      ))}
    </div>
  );
}

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="overflow-hidden rounded-card border border-line bg-paper shadow-card transition-shadow duration-200 hover:shadow-card-hover"
    >
      <div className="border-b border-line bg-sand/60 px-4 py-2.5" aria-hidden="true">
        <div className="h-2 w-24 rounded-full bg-line" />
      </div>
      <div className="p-4 sm:p-5" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

function Bar({ width, color = 'bg-teal' }: { width: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-sand">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function LearnVisual() {
  return (
    <Frame label="Illustrative course list with progress bars and a video lesson row.">
      {[
        { t: 'Rotational Mechanics · 12 lessons', p: 72 },
        { t: 'Organic Chemistry · 9 lessons', p: 45 },
      ].map((c) => (
        <div key={c.t} className="mb-3 rounded-card border border-line bg-cream p-3 last:mb-0">
          <p className="truncate text-sm font-semibold text-ink">{c.t}</p>
          <div className="mt-2">
            <Bar width={c.p} />
          </div>
        </div>
      ))}
    </Frame>
  );
}

function AssessVisual() {
  return (
    <Frame label="Illustrative test result: score, auto-graded answers, and time taken.">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-ink">Weekly Test · Physics</p>
        <p className="text-2xl font-bold text-teal">86%</p>
      </div>
      <div className="mt-3 space-y-2">
        {[
          { t: 'Correct · auto-graded', p: 100, c: 'bg-teal' },
          { t: 'Review · teacher', p: 60, c: 'bg-clay' },
        ].map((r) => (
          <div key={r.t}>
            <p className="mb-1 text-xs text-ink-soft">{r.t}</p>
            <Bar width={r.p} color={r.c} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

function ManageVisual() {
  return (
    <Frame label="Illustrative admin overview: student count, active batches, and pending fees.">
      <div className="grid grid-cols-3 gap-2">
        {[
          { v: '1,240', l: 'Students' },
          { v: '18', l: 'Batches' },
          { v: '₹86k', l: 'Fees due' },
        ].map((s) => (
          <div key={s.l} className="rounded-card bg-cream p-3 text-center">
            <p className="text-lg font-bold text-ink">{s.v}</p>
            <p className="text-xs text-ink-soft">{s.l}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-card border border-line p-3">
        <p className="text-xs font-semibold text-ink">New announcement drafted</p>
        <p className="mt-0.5 truncate text-xs text-ink-soft">Holiday schedule · all batches</p>
      </div>
    </Frame>
  );
}

function CollectVisual() {
  return (
    <Frame label="Illustrative fee ledger: installment plan with paid and upcoming entries.">
      {[
        { t: 'Installment 1 of 6 · paid', done: true },
        { t: 'Installment 2 of 6 · due 5th', done: false },
        { t: 'Installment 3 of 6 · upcoming', done: false },
      ].map((r) => (
        <div key={r.t} className="mb-2 flex items-center gap-2 rounded-card bg-cream p-2.5 text-sm last:mb-0">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.done ? 'bg-teal' : 'bg-line'}`} />
          <span className="truncate text-ink">{r.t}</span>
        </div>
      ))}
    </Frame>
  );
}

function ProveVisual() {
  return (
    <Frame label="Illustrative certificate card with verification badge.">
      <div className="flex items-center gap-3 rounded-card bg-ink p-4 text-cream">
        <Award size={28} className="shrink-0 text-sand" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">Course Completion Certificate</p>
          <p className="text-xs opacity-80">Verified · SHK-2026-0042</p>
        </div>
      </div>
    </Frame>
  );
}
