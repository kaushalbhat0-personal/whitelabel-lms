import { Award, ClipboardCheck, LayoutDashboard, Receipt, Video } from 'lucide-react';

/**
 * Editorial product tour (MKT-01C + MKT-01D-A).
 *
 * Static alternating rows — no carousel, no tabs, no client JS.
 * Learn/Assess/Manage/Collect visuals are REAL screenshots captured from
 * the live white-label LMS demo (MicroNest Services Academy, fictional
 * demo data) stored as static WebP assets under public/product/. The
 * Prove (certificate) visual remains an illustrative composition: no
 * qualifying certificate exists in demo data and none was created
 * for marketing. Each visual is aria-hidden; the adjacent copy carries
 * the meaning.
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

function Shot({ src, width, height }: { src: string; width: number; height: number }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      className="block h-auto w-full"
    />
  );
}

function LearnVisual() {
  return (
    <Frame label="Screenshot: MicroNest Services Academy course learning screen with demo curriculum.">
      <Shot src="/product/course-learning.webp" width={1440} height={900} />
    </Frame>
  );
}

function AssessVisual() {
  return (
    <Frame label="Screenshot: MicroNest Services Academy test result with score and question review.">
      <Shot src="/product/test-results.webp" width={1440} height={900} />
    </Frame>
  );
}

function ManageVisual() {
  return (
    <Frame label="Screenshot: MicroNest Services Academy admin course and batch management.">
      <Shot src="/product/admin-dashboard.webp" width={1440} height={900} />
    </Frame>
  );
}

function CollectVisual() {
  return (
    <Frame label="Screenshot: MicroNest Services Academy finance revenue overview.">
      <Shot src="/product/finance.webp" width={1440} height={470} />
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
