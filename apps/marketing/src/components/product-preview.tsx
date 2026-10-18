import { Award, BarChart3, PlayCircle } from 'lucide-react';

/**
 * Illustrative product preview inside a browser frame (MKT-01B).
 *
 * NOT a screenshot: a clean CSS composition built only from confirmed
 * product UI patterns (course cards, progress, admin stats, certificate).
 * All names and numbers are fictional. If real redacted screenshots become
 * available, they replace <PreviewBody /> without changing the frame.
 */
export function ProductPreview() {
  return (
    <figure
      role="img"
      aria-label="Illustrative preview of the branded LMS: student courses with progress, an admin overview with student and fee statistics, and a verifiable certificate."
      className="overflow-hidden rounded-hero border border-line bg-paper shadow-card-hover"
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-sand/60 px-4 py-3" aria-hidden="true">
        <span className="h-3 w-3 rounded-full bg-line" />
        <span className="h-3 w-3 rounded-full bg-line" />
        <span className="h-3 w-3 rounded-full bg-line" />
        <span className="ml-3 hidden flex-1 truncate rounded-full bg-paper px-4 py-1 text-xs text-ink-soft sm:block">
          learn.youracademy.com
        </span>
      </div>
      <PreviewBody />
    </figure>
  );
}

function PreviewBody() {
  return (
    <div className="grid gap-4 p-4 sm:p-6" aria-hidden="true">
      {/* Student courses */}
      <div className="rounded-card border border-line p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-soft">My courses</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            { title: 'Physics — Class 12', progress: 72 },
            { title: 'Chemistry — Class 12', progress: 45 },
          ].map((c) => (
            <div key={c.title} className="rounded-card border border-line bg-cream p-3">
              <div className="flex items-center gap-2">
                <PlayCircle size={18} className="shrink-0 text-teal" />
                <p className="truncate text-sm font-semibold text-ink">{c.title}</p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand">
                <div className="h-full rounded-full bg-teal" style={{ width: `${c.progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-soft">{c.progress}% complete</p>
            </div>
          ))}
        </div>
      </div>

      {/* Admin overview + certificate */}
      <div className="grid gap-4 sm:grid-cols-5">
        <div className="rounded-card border border-line p-4 sm:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Admin overview</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: 'Students', value: '1,240' },
              { label: 'Batches', value: '18' },
              { label: 'Fees due', value: '₹86k' },
            ].map((s) => (
              <div key={s.label} className="rounded-card bg-cream p-2 text-center sm:p-3">
                <p className="flex items-center justify-center gap-1 text-base font-bold text-ink sm:text-lg">
                  <BarChart3 size={14} className="text-clay" />
                  {s.value}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-soft sm:text-xs">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-card border border-line bg-ink p-4 text-cream sm:col-span-2">
          <Award size={28} className="shrink-0 text-sand" />
          <div>
            <p className="text-sm font-bold">Certificate issued</p>
            <p className="text-xs opacity-80">Publicly verifiable</p>
          </div>
        </div>
      </div>
    </div>
  );
}
