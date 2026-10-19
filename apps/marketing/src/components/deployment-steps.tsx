/**
 * Five-step deployment timeline (MKT-01C).
 *
 * Semantic ordered list; connectors are decorative (aria-hidden).
 * Horizontal on desktop, vertical on mobile. No timelines promised.
 */
const steps = [
  { title: 'Map your setup', text: 'We map your courses, students, branding and provider accounts.' },
  { title: 'We configure your LMS', text: 'Courses structure, batches, fees, tests, and settings.' },
  { title: 'We apply your branding', text: 'Name, logo, colors, domain, and document identity.' },
  { title: 'We deploy and verify it', text: 'On infrastructure you control, checked end to end before handoff.' },
  { title: 'We hand it over to you', text: 'Admin access, documentation, and a walkthrough with your team.' },
];

export function DeploymentSteps() {
  return (
    <div>
      <ol className="mt-10 grid gap-8 md:grid-cols-5 md:gap-4">
      {steps.map((s, i) => (
        <li key={s.title} className="relative">
          <div aria-hidden="true" className="hidden md:block">
            {i < steps.length - 1 ? (
              <span className="absolute left-12 top-6 h-px w-[calc(100%-3rem)] bg-line" />
            ) : null}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-paper text-lg font-bold text-clay shadow-card">
            {String(i + 1).padStart(2, '0')}
          </div>
          <h3 className="mt-4 text-lg font-bold text-ink">{s.title}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{s.text}</p>
        </li>
      ))}
      </ol>
      <p className="mt-8 max-w-3xl text-base leading-relaxed text-ink-soft">
        You create the accounts you own; we configure them for the LMS.
      </p>
    </div>
  );
}
