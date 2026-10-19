import type { Metadata } from 'next';
import { siteConfig } from '@/site.config';
import { Button, PageShell, Section } from '@/components/primitives';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Request your branded LMS deployment. Contact MicroNest for pricing, timelines, and demo access for your institute.',
  alternates: { canonical: '/contact' },
};

const fields = [
  { id: 'contact-name', label: 'Your name', type: 'text', autoComplete: 'name', placeholder: 'Priya Sharma' },
  { id: 'contact-email', label: 'Email', type: 'email', autoComplete: 'email', placeholder: 'you@institute.com' },
  { id: 'contact-phone', label: 'Phone / WhatsApp', type: 'tel', autoComplete: 'tel', placeholder: '+91 …' },
  { id: 'contact-academy', label: 'Academy / business name', type: 'text', autoComplete: 'organization', placeholder: 'Sunrise Academy' },
  { id: 'contact-teaches', label: 'What do you teach?', type: 'text', autoComplete: 'off', placeholder: 'Class 12 physics, NEET…' },
  { id: 'contact-students', label: 'Approximate number of students', type: 'text', autoComplete: 'off', placeholder: 'e.g. 300' },
] as const;

export default function ContactPage() {
  return (
    <>
      <PageShell
        eyebrow="Contact"
        title="Let's get your LMS ready."
        lede="Tell us about your academy and we'll help you understand the setup, branding, and deployment process."
      />

      <Section aria-label="Contact options" className="border-t border-line">
        <div className="grid items-start gap-6 md:grid-cols-2">
          <div className="rounded-card border border-line bg-paper p-6 shadow-card sm:p-8">
            <h2 className="text-xl font-bold text-ink">Email us directly</h2>
            <p className="mt-3 text-base leading-relaxed text-ink-soft">
              The fastest way to start a conversation about your deployment — and how demo access is arranged.
            </p>
            <p className="mt-4">
              <a
                href={`mailto:${siteConfig.email}`}
                className="text-lg font-semibold text-clay-dark underline-offset-4 hover:underline"
              >
                {siteConfig.email}
              </a>
            </p>
            <div className="mt-6 border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">
              <p className="font-semibold text-ink">What happens next</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>We reply personally within a few working days.</li>
                <li>We understand your courses, students, and branding.</li>
                <li>We arrange guided demo access for your team.</li>
              </ol>
            </div>
          </div>

          {/* Prepared form shell — visibly unwired until a later phase, mailto fallback retained. */}
          <div className="rounded-card border border-line bg-paper p-6 shadow-card sm:p-8">
            <h2 className="text-xl font-bold text-ink">Enquiry form</h2>
            <p className="mt-2 rounded-card bg-sand p-3 text-sm font-medium text-ink">
              Online submission opens in the next update — email us directly for now, nothing you type here is sent
              anywhere.
            </p>
            <div className="mt-5 space-y-4">
              {fields.map((f) => (
                <div key={f.id}>
                  <label htmlFor={f.id} className="mb-1 block text-sm font-semibold text-ink">
                    {f.label}
                  </label>
                  <input
                    id={f.id}
                    name={f.id}
                    type={f.type}
                    autoComplete={f.autoComplete}
                    placeholder={f.placeholder}
                    className="input-shell"
                    disabled
                    tabIndex={-1}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="contact-message" className="mb-1 block text-sm font-semibold text-ink">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  name="message"
                  rows={4}
                  placeholder="Courses, students, city…"
                  className="input-shell"
                  disabled
                  tabIndex={-1}
                />
              </div>
            </div>
            <div className="mt-5">
              <Button href={`mailto:${siteConfig.email}`}>Email us instead</Button>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
