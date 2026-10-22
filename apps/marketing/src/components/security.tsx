import { Check, ShieldAlert } from 'lucide-react';

/**
 * Security & access section (MKT-02A).
 *
 * Factual client-deployment controls only: authenticated role-based access,
 * one active session per student, protected video playback, client-owned
 * infrastructure. No absolutes, no implementation internals (Redis/JWT/TTL).
 */
const points = [
  { title: 'Authenticated student and admin access', detail: '' },
  { title: 'Role-based permissions across the LMS', detail: '' },
  {
    title: 'One active session per student',
    detail: ' — normal deployments keep one active student session at a time, which helps prevent simultaneous use of the same student account.',
  },
  { title: 'Protected video playback', detail: '' },
  { title: 'Client-controlled infrastructure and data', detail: '' },
];

export function Security() {
  return (
    <div>
      <ul className="mt-8 grid gap-x-10 gap-y-3 sm:grid-cols-2">
        {points.map((item) => (
          <li key={item.title} className="flex items-start gap-3 border-t border-line pt-3 text-[15px] text-ink">
            <Check size={18} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
            <span>
              <strong className="font-semibold">{item.title}</strong>
              {item.detail ? <span className="text-ink-soft">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {/* Product callout: what a student sees when the same account is already
          active elsewhere. Genuine text (never color-only), LMS-styled card. */}
      <div className="mt-8 max-w-md animate-fade-in-up rounded-card border border-line bg-cream p-6 shadow-card">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          What students see
        </p>
        <div className="mt-3 flex items-start gap-3">
          <ShieldAlert size={22} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
          <div>
            <p className="text-lg font-bold text-ink">Login Denied</p>
            <p className="mt-1 text-base leading-relaxed text-ink-soft">
              Account already active on another device.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Please sign out from the other device before continuing.
            </p>
          </div>
        </div>
      </div>
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-soft">
        Security controls are designed to reduce unauthorized access; no system can guarantee absolute protection.
      </p>
    </div>
  );
}
