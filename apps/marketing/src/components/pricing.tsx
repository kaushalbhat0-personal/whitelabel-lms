import { Check, Minus } from 'lucide-react';
import { Button } from './primitives';

/**
 * Full pricing section (MKT-01D). Single offer, factual inclusions and
 * exclusions, no countdown, no slot-count fiction, no checkout.
 */
const included = [
  'LMS deployment on your infrastructure',
  'Client branding and identity configuration',
  'Business details, currency, locale, and tax setup',
  'Domain configuration assistance',
  'Initial infrastructure configuration assistance',
  'End-to-end LMS verification',
  'Admin setup and first-admin walkthrough',
  'Student and admin walkthrough session',
  'Handoff with documentation',
];

const excluded = [
  'Hosting charges',
  'Database and provider charges',
  'Video infrastructure charges',
  'Domain registration fees',
  'Other third-party provider charges',
  'Content creation (courses, videos, tests)',
  'Custom feature development outside the existing LMS',
  'Ongoing infrastructure bills',
];

export function Pricing() {
  return (
    <div>
      <div className="rounded-hero border border-line bg-paper p-8 text-center shadow-card sm:p-12">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Founding Client Offer</p>
        <p className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          ₹1,20,000 <span className="text-xl font-semibold text-ink-soft">one-time</span>
        </p>
        <p className="mt-2 text-base font-medium text-ink-soft">First 10 deployments</p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button href="/contact" size="lg">
            Get Your LMS
          </Button>
          <Button href="/demo" variant="secondary" size="lg">
            See the Live Demo
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-line bg-paper p-6 shadow-card sm:p-8">
          <h3 className="text-xl font-bold text-ink">What is included</h3>
          <ul className="mt-5 space-y-2.5">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-ink">
                <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-line bg-paper p-6 shadow-card sm:p-8">
          <h3 className="text-xl font-bold text-ink">What is not included</h3>
          <ul className="mt-5 space-y-2.5">
            {excluded.map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-ink-soft">
                <Minus size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-card bg-sand p-4 text-base font-medium text-ink">
            Infrastructure and provider charges belong to your own accounts — you pay those providers directly.
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-card border border-line bg-ink p-6 text-cream sm:p-8">
        <h3 className="text-xl font-bold">Not custom LMS development.</h3>
        <p className="mt-2 max-w-3xl text-base leading-relaxed opacity-90">
          You are not paying us to build an LMS from scratch. You get a finished LMS that we configure, brand, and
          deploy for your academy.
        </p>
      </div>
    </div>
  );
}
