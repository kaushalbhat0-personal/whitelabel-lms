import { Check } from 'lucide-react';

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
      <ul className="mt-8 space-y-2.5">
        {points.map((item) => (
          <li key={item.title} className="flex items-start gap-3 text-base text-ink">
            <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
            <span>
              <strong className="font-semibold">{item.title}</strong>
              {item.detail ? <span className="text-ink-soft">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-soft">
        Security controls are designed to reduce unauthorized access; no system can guarantee absolute protection.
      </p>
    </div>
  );
}
