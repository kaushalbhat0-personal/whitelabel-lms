'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Accessible FAQ accordion (MKT-01D). Local client island — no dependency,
 * independent toggles, button semantics with aria-expanded/controls.
 */
export const faqs = [
  {
    q: 'Is this a SaaS subscription?',
    a: 'No. The LMS is deployed as a separate installation for your academy — on infrastructure you control — rather than a shared MicroNest-hosted subscription you rent per month.',
  },
  {
    q: 'Who owns the LMS environment?',
    a: 'You do. Your academy controls the domain, hosting, database, storage, provider accounts, credentials, and all student and business data. We configure everything and hand it over with documentation and a walkthrough.',
  },
  {
    q: 'Can you use our branding?',
    a: 'Yes. Your business name, logo, favicon, brand colors, business details, currency, locale, timezone, and tax and invoice identity are configured across student views, admin views, emails, invoices, and certificates.',
  },
  {
    q: 'Can we use our own domain?',
    a: 'Yes. Your students and staff use your own domain (for example, learn.youracademy.com), set up with normal domain and DNS configuration during deployment.',
  },
  {
    q: 'What does ₹1,20,000 include?',
    a: 'The Founding Client Offer covers LMS deployment, client branding and business-identity configuration, domain and initial infrastructure configuration assistance, LMS verification, admin setup, a student/admin walkthrough, and handoff. It is a one-time fee for the first 10 deployments.',
  },
  {
    q: 'Do we pay hosting and provider costs separately?',
    a: 'Yes. Hosting, database, video, domain, and other third-party provider charges belong to your own accounts — you pay those providers directly. We never mark them up, and we never host your LMS on our infrastructure.',
  },
  {
    q: 'Is this a custom LMS built from scratch?',
    a: 'No — and that is the point. It is a finished LMS product that we configure, brand, and deploy for your academy, instead of billing you to build one from zero.',
  },
  {
    q: 'Can you help us deploy it?',
    a: 'Yes. MicroNest handles the full setup and deployment process — configuration, branding, deployment, verification, and handoff — so your team receives a working platform, not a project.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mt-10 divide-y divide-line rounded-card border border-line bg-paper shadow-card">
      {faqs.map((f, i) => {
        const expanded = open === i;
        return (
          <div key={f.q}>
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`faq-panel-${i}`}
                id={`faq-button-${i}`}
                onClick={() => setOpen(expanded ? null : i)}
                className="flex min-h-[44px] w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
              >
                <span className="text-base font-bold text-ink sm:text-lg">{f.q}</span>
                <ChevronDown
                  size={20}
                  aria-hidden="true"
                  className={`shrink-0 text-clay transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
            </h3>
            <div
              id={`faq-panel-${i}`}
              role="region"
              aria-labelledby={`faq-button-${i}`}
              hidden={!expanded}
              className="px-5 pb-5 sm:px-6"
            >
              <p className="max-w-3xl text-base leading-relaxed text-ink-soft">{f.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** FAQ JSON-LD — questions and answers exactly match the visible accordion. */
export function FaqSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}
