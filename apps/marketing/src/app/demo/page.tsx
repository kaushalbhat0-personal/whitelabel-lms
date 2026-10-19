import type { Metadata } from 'next';
import { siteConfig } from '@/site.config';
import { Button, PageShell, Section } from '@/components/primitives';

export const metadata: Metadata = {
  title: 'Live demo',
  description:
    'Explore the branded LMS before you commit. Request guided demo access and see the admin, student, and certificate experience.',
  alternates: { canonical: '/demo' },
};

const covers = [
  { title: 'Student experience', text: 'Courses, video lessons, progress, tests, and results — as your students would see them.' },
  { title: 'Admin experience', text: 'Students, batches, sessions, announcements, and analytics — as your team would run them.' },
  { title: 'Fees and certificates', text: 'Fee plans, invoices, receipts, and verifiable certificates — as your office would issue them.' },
];

export default function DemoPage() {
  return (
    <>
      <PageShell
        eyebrow="Live demo"
        title="See the LMS before you buy."
        lede="The live demo lets you explore the student and admin experience of a fully branded learning platform — the same product we deploy for academies."
      >
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href="/contact" size="lg">
            Request Demo Access
          </Button>
          <Button href="/contact" variant="secondary" size="lg">
            Get Your LMS
          </Button>
        </div>
      </PageShell>

      <Section aria-label="Launch the live demo" className="border-t border-line">
        {siteConfig.demoLoginUrl ? (
          <div className="rounded-card border border-line bg-paper p-6 shadow-card sm:p-8">
            <h2 className="text-2xl font-bold text-ink sm:text-3xl">Try the live demo now</h2>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-soft">
              The demo LMS opens on its own address with the demo login screen. Sign in with the demo
              student access shared through the demo access process to explore courses, video lessons,
              tests, and results as a student. Admin walkthroughs are available as a guided demo.
            </p>
            <div className="mt-6">
              <Button href={siteConfig.demoLoginUrl} size="lg">
                Launch Live Demo
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-line bg-paper p-6 shadow-card sm:p-8">
            <h2 className="text-2xl font-bold text-ink sm:text-3xl">Guided demo access</h2>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-soft">
              The hosted demo opens for real enquiries. Send us a request and we will provide access personally —
              there is no instant automated access, by design.
            </p>
            <div className="mt-6">
              <Button href="/contact" size="lg">
                Request Demo Access
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section aria-label="What the demo covers" className="border-t border-line">
        <h2 className="text-2xl font-bold text-ink sm:text-3xl">What you can explore</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {covers.map((c) => (
            <div key={c.title} className="rounded-card border border-line bg-paper p-6 shadow-card">
              <h3 className="text-lg font-bold text-ink">{c.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-ink-soft">{c.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-card border border-line bg-sand/60 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-ink">Want access to the demo?</h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-ink-soft">
            Launch the live demo and sign in with the demo student access shared through the demo access
            process — credentials are never published on this site. For an admin walkthrough, send us a
            request and we will arrange a guided demo personally.
          </p>
          <div className="mt-5">
            <Button href="/contact">Request Demo Access</Button>
          </div>
        </div>
      </Section>
    </>
  );
}
