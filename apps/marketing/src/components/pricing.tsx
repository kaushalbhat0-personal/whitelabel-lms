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
  'Student and admin walkthrough call',
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
      <div className="overflow-hidden rounded-hero border border-ink/10 bg-paper text-center shadow-[0_24px_48px_-24px_rgb(28_25_23/0.22)]">
        <div className="border-b border-line/70 bg-cream/70 px-8 py-2.5" aria-hidden="true">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-teal">Founding Client Offer</p>
        </div>
        <div className="p-8 sm:p-12">
          <p className="font-display text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
            ₹1,20,000 <span className="font-sans text-xl font-semibold text-ink-soft">one-time</span>
          </p>
          <p className="mt-3 text-base font-medium text-ink-soft">
            A white-label LMS for your academy · First 10 deployments · hosting and provider costs separate
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/demo" size="lg">
              Get Instant Demo Access
            </Button>
            <Button href="/contact" variant="secondary" size="lg">
              Talk to Us
            </Button>
          </div>
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

      <div className="mt-8 border border-line bg-ink p-6 text-cream sm:p-8">
        <h3 className="font-display text-xl font-semibold tracking-tight">Not custom LMS development.</h3>
        <p className="mt-2 max-w-3xl text-base leading-relaxed opacity-90">
          You are not paying us to build an LMS from scratch. You get a finished LMS that we configure, brand, and
          deploy for your academy.
        </p>
      </div>
    </div>
  );
}
