import { Check, Minus } from 'lucide-react';
import { Button } from './primitives';

/**
 * Dual-card commercial presentation (RCCF-MKT-05).
 *
 * Card 1 — Fully Managed Deployment (₹1,20,000 one-time): finished LMS
 * branded and launched onto infrastructure the client controls. MicroNest
 * retains the reusable product source; the client owns their deployment
 * environment, data, and provider accounts.
 *
 * Card 2 — Complete Codebase Handoff (₹2,00,000 one-time): everything in
 * the managed deployment plus the source code repository for the client's
 * own deployment and architecture handoff docs, so their developers can
 * customize and maintain it. No claim of underlying product-IP assignment,
 * resale, or sublicensing — deliberately unstated (no legal language added).
 *
 * MKT-04 CTA destinations preserved: managed → /demo, handoff → /contact
 * (sales enquiry, no reservation backend). Infrastructure/provider costs
 * stay separate (factual wording retained below).
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
      <div className="grid items-stretch gap-4 md:gap-6 lg:grid-cols-2">
        {/* ── Plan 1: Fully Managed Deployment ── */}
        <article className="flex flex-col rounded-hero border border-line bg-paper p-6 shadow-card sm:p-8">
          <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Fully Managed Deployment
          </h3>
          <p className="mt-1 text-sm font-bold uppercase tracking-[0.18em] text-teal">
            We launch it for you
          </p>
          <p className="mt-4 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            ₹1,20,000{' '}
            <span className="font-sans text-base font-semibold text-ink-soft">one-time</span>
          </p>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Finished LMS branded and launched onto infrastructure you control.
          </p>
          <ul className="mt-6 space-y-3 text-base leading-relaxed text-ink">
            <li className="flex items-start gap-3">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Includes:</strong> Complete branding setup, domain
                mapping, and end-to-end launch verification.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Support:</strong> 3 months of complimentary
                maintenance support included.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Updates:</strong> Optional ₹10,000/year annual support
                package for peaceful operations.
              </span>
            </li>
          </ul>
          <div className="mt-auto pt-7">
            <Button href="/demo" size="block" className="text-center leading-snug">
              Launch Instant Student Demo
            </Button>
            <p className="mt-3 text-center text-sm text-ink-soft">
              Explore the real LMS first — no signup required.
            </p>
          </div>
        </article>

        {/* ── Plan 2: Complete Codebase Handoff ── */}
        <article className="relative flex flex-col rounded-hero border-2 border-ink bg-cream p-6 shadow-card sm:p-8">
          <p className="absolute -top-3.5 left-6 inline-flex items-center rounded-full bg-ink px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-cream">
            For Teams With Developers
          </p>
          <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Complete Codebase Handoff
          </h3>
          <p className="mt-1 text-sm font-bold uppercase tracking-[0.18em] text-teal">
            Maximum control of your deployment
          </p>
          <p className="mt-4 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            ₹2,00,000{' '}
            <span className="font-sans text-base font-semibold text-ink-soft">one-time</span>
          </p>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Accelerate your internal roadmap with the complete source code for your deployment.
          </p>
          <ul className="mt-6 space-y-3 text-base leading-relaxed text-ink">
            <li className="flex items-start gap-3">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Includes:</strong> Full source code repository access
                + architecture handoff documentation.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Control:</strong> Your internal developers can
                customize, extend, rewrite, and maintain your deployment.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Independence:</strong> No ongoing maintenance fees or
                recurring check-ins are required.
              </span>
            </li>
          </ul>
          <div className="mt-auto pt-7">
            <Button href="/contact" size="block" className="text-center leading-snug">
              Reserve 1 of 10 Founding Slots (Get Admin Access)
            </Button>
            <p className="mt-3 text-center text-sm text-ink-soft">
              A sales enquiry — no automated booking, we reply personally.
            </p>
          </div>
        </article>
      </div>

      <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-ink-soft">
        The LMS keeps working with or without a maintenance plan — maintenance is optional. Hosting and
        provider costs belong to your own accounts and are separate from both packages.
      </p>

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
