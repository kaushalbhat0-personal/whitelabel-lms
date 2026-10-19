import { Disc3, Radio, SlidersHorizontal } from 'lucide-react';

/**
 * Learning flexibility section (MKT-02A, editorial treatment MKT-02B).
 *
 * Recorded-only vs recorded + Zoom live classes. Numbered editorial rows —
 * visually distinct from the card-based sections around them.
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
      <ol className="grid gap-x-10 gap-y-8 md:grid-cols-3">
        {options.map((o, i) => (
          <li key={o.title} className="border-t-2 border-ink pt-5">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="font-display text-sm font-semibold tracking-widest text-clay">
                {String(i + 1).padStart(2, '0')}
              </span>
              <o.icon size={20} className="text-teal" aria-hidden="true" />
            </div>
            <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">{o.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{o.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-8 border-l-2 border-clay bg-cream py-3 pl-4 pr-4 text-[15px] font-medium leading-relaxed text-ink">
        Zoom and other provider accounts belong to you — you pay those providers directly. They are never included in
        the one-time deployment fee.
      </p>
    </div>
  );
}
