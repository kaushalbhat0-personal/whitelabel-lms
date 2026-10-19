import { Disc3, Radio, SlidersHorizontal } from 'lucide-react';

/**
 * Learning flexibility section (MKT-02A).
 *
 * Recorded-only vs recorded + Zoom live classes. Copy-only addition built
 * on existing card primitives — no visual-system change.
 */
const options = [
  {
    icon: Disc3,
    title: 'Recorded-only',
    text: 'Run a fully recorded LMS with no live-class infrastructure required. Courses, videos, tests, fees, and certificates work without any live setup.',
  },
  {
    icon: Radio,
    title: 'Live + recorded',
    text: 'Add Zoom-powered live classes alongside your recorded courses. Sessions, attendance, and recordings stay inside the same LMS.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Flexible deployment',
    text: 'Choose the setup that matches how your institute teaches. Configure live learning only if you need it.',
  },
];

export function Flexibility() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {options.map((o) => (
          <div key={o.title} className="rounded-card border border-line bg-paper p-6 shadow-card">
            <o.icon size={24} className="text-teal" aria-hidden="true" />
            <h3 className="mt-3 text-xl font-bold text-ink">{o.title}</h3>
            <p className="mt-2 text-base leading-relaxed text-ink-soft">{o.text}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 rounded-card border border-line bg-sand p-4 text-base font-medium text-ink">
        Zoom and other provider accounts belong to you — you pay those providers directly. They are never included in
        the one-time deployment fee.
      </p>
    </div>
  );
}
