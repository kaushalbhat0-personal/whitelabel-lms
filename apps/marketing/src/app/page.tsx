import type { Metadata } from 'next';
import {
  BadgeCheck,
  Banknote,
  BookOpen,
  ClipboardCheck,
  Database,
  GraduationCap,
  Handshake,
  HardDrive,
  KeyRound,
  Library,
  Mail,
  Palette,
  Radio,
  Rocket,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import { siteConfig } from '@/site.config';
import { Badge, Button, Container, Section } from '@/components/primitives';
import { ProductPreview } from '@/components/product-preview';
import { ProductTour } from '@/components/tour';
import { Flexibility } from '@/components/flexibility';
import { Security } from '@/components/security';
import { WhiteLabel } from '@/components/white-label';
import { DeploymentSteps } from '@/components/deployment-steps';
import { Pricing } from '@/components/pricing';
import { Faq, FaqSchema } from '@/components/faq';
import { StickyMobileCta } from '@/components/sticky-cta';

export const metadata: Metadata = {
  title: `${siteConfig.tagline} | ${siteConfig.brandName}`,
  description:
    'A complete branded LMS for coaching institutes and academies — courses, batches, tests, fees, and certificates, deployed on infrastructure you control.',
  alternates: { canonical: '/' },
};

const ownershipChips = ['Your brand', 'Your domain', 'Your infrastructure', 'Your data'];

const valueStrip = [
  {
    icon: Library,
    title: 'Finished LMS',
    text: 'Courses, assessments, fees, certificates and more — already built, not billed from scratch.',
  },
  {
    icon: BadgeCheck,
    title: 'Your Brand',
    text: 'Name, logo, domain, colors and business identity across every screen.',
  },
  {
    icon: Server,
    title: 'Your Infrastructure',
    text: 'Your hosting, database, storage, providers and student data.',
  },
];

const featureGroups = [
  {
    icon: BookOpen,
    title: 'Teach',
    text: 'Recorded courses with optional Zoom live classes. Recorded-only deployments need no live infrastructure.',
    items: ['Courses', 'Batches', 'Recorded video learning', 'Optional Zoom live classes'],
  },
  {
    icon: ClipboardCheck,
    title: 'Assess',
    text: 'Test often, grade fast, and track understanding.',
    items: ['Tests', 'Question bank', 'Auto-grading', 'Results'],
  },
  {
    icon: Users,
    title: 'Manage',
    text: 'The daily operation of the academy in one view.',
    items: ['Students', 'Attendance', 'Announcements', 'Analytics'],
  },
  {
    icon: Wallet,
    title: 'Collect',
    text: 'Fees, installments, and compliant billing.',
    items: ['Fee plans', 'EMI tracking', 'Payments', 'Invoices & receipts'],
  },
];

const ownedByYou = [
  { icon: GraduationCap, label: 'Your domain' },
  { icon: Server, label: 'Your hosting' },
  { icon: Database, label: 'Your database' },
  { icon: HardDrive, label: 'Your storage' },
  { icon: Video, label: 'Your video/CDN provider' },
  { icon: Radio, label: 'Your Zoom account, if live classes are used' },
  { icon: Mail, label: 'Your email/provider accounts' },
  { icon: KeyRound, label: 'Your credentials' },
  { icon: Banknote, label: 'Your student data' },
];

const handledByUs = [
  { icon: Palette, label: 'Branding' },
  { icon: SlidersHorizontal, label: 'Configuration' },
  { icon: Rocket, label: 'Deployment' },
  { icon: BadgeCheck, label: 'Verification' },
  { icon: Handshake, label: 'Handoff' },
];

export default function HomePage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="overflow-hidden">
        <Container className="grid items-center gap-10 pb-16 pt-12 sm:pt-16 lg:grid-cols-2 lg:gap-14 lg:pb-24 lg:pt-20">
          <div className="animate-fade-in-up">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Branded LMS deployment</p>
            <h1 className="mt-4 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.01em] text-ink sm:text-6xl lg:text-[3.9rem]">
              Your own branded LMS, deployed for you.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              A finished LMS for coaching institutes and academies — branded with your identity and deployed on
              infrastructure you control. Run recorded courses only, or add Zoom-powered live classes when you need
              them.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/demo" size="lg" className="sm:min-h-[44px]">
                Get Instant Demo Access
              </Button>
              <Button href="/contact" variant="secondary" size="lg" className="sm:min-h-[44px]">
                Talk to Us
              </Button>
            </div>
            <ul aria-label="What you own" className="mt-7 flex flex-wrap gap-2">
              {ownershipChips.map((chip) => (
                <li key={chip}>
                  <Badge>{chip}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm font-medium text-ink-soft">
              Founding Client Offer · <span className="font-bold text-ink">₹1,20,000 one-time</span> · First 10
              deployments
            </p>
            <p className="mt-2 text-sm text-ink-soft">Explore the real LMS through the live demo — no signup required.</p>
          </div>
          <div className="animate-fade-in">
            <ProductPreview />
          </div>
        </Container>
      </div>

      {/* ── Value strip ──────────────────────────────────── */}
      <div className="border-y border-line bg-paper">
        <Container className="py-12 sm:py-16">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Built. Branded. Deployed.</p>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
            {valueStrip.map((v, i) => (
              <div key={v.title} className="border-t-2 border-ink pt-5">
                <div className="flex items-baseline gap-3">
                  <span aria-hidden="true" className="font-display text-sm font-semibold tracking-widest text-clay">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <v.icon size={20} className="translate-y-0.5 text-teal" aria-hidden="true" />
                </div>
                <p className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">{v.title}</p>
                <p className="mt-2 text-base leading-relaxed text-ink-soft">{v.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </div>

      {/* ── Product proof ────────────────────────────────── */}
      <Section id="product" aria-label="Product tour">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Is it real?</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
          A complete LMS, already built.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
          Courses, learning, assessments, student management, finance, and certificates — already working together in
          one LMS. What follows is a tour of the real product areas, shown with actual screenshots from the live demo.
        </p>
        <ProductTour />
      </Section>

      {/* ── Learning flexibility ─────────────────────────── */}
      <div className="border-y border-line bg-paper">
        <Container className="py-16 sm:py-20 lg:py-24">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">How you teach</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
            Recorded-only, or recorded + Zoom live classes.
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
            The LMS adapts to how your institute teaches. Configure live learning only if you need it.
          </p>
          <div className="mt-10">
            <Flexibility />
          </div>
        </Container>
      </div>

      {/* ── Feature system ───────────────────────────────── */}
      <div id="features" className="scroll-mt-24 border-b border-line bg-cream">
        <Container className="py-16 sm:py-20 lg:py-24">
          <p id="features-label" className="text-sm font-bold uppercase tracking-[0.18em] text-teal">
            What it does
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
            Everything an institute needs to teach, assess, and collect fees
          </h2>
          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2" role="list" aria-labelledby="features-label">
            {featureGroups.map((g) => (
              <div key={g.title} role="listitem" className="border-t-2 border-ink pt-5">
                <h3 className="flex items-center gap-2 text-xl font-bold text-ink">
                  <g.icon size={20} className="text-teal" aria-hidden="true" />
                  {g.title}
                </h3>
                <p className="mt-1.5 text-base text-ink-soft">{g.text}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {g.items.map((item) => (
                    <li key={item} className="rounded-full bg-sand px-3 py-1.5 text-sm font-medium text-ink">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 border-t border-line pt-6">
            <h3 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-ink">
              <ShieldCheck size={20} className="text-teal" aria-hidden="true" />
              And proof of learning
            </h3>
            <p className="mt-1.5 max-w-2xl text-base text-ink-soft">
              Certificates issued on completion, each with a public verification page — plus announcements, attendance,
              and analytics woven through the same platform.
            </p>
          </div>
        </Container>
      </div>

      {/* ── White-label ──────────────────────────────────── */}
      <Section id="branding" aria-label="White-label branding">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Can it become mine?</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">Make the LMS yours.</h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
          Your students see your brand — not a generic LMS. Every academy below is a fictional styling example of the
          same product.
        </p>
        <div className="mt-10">
          <WhiteLabel />
        </div>
      </Section>

      {/* ── Security & access ────────────────────────────── */}
      <Section aria-label="Security and access" className="border-y border-line bg-paper">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Controlled access</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
          One active session per student.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
          Keep student access controlled with authenticated, role-based access and one active session per student.
        </p>
        <Security />
      </Section>

      {/* ── Ownership ────────────────────────────────────── */}
      <div className="border-y border-line bg-ink text-cream">
        <Container className="grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-sand">Why it is different</p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Your LMS. Your infrastructure. Your data.</h2>
            <p className="mt-4 max-w-lg text-lg leading-relaxed opacity-90">
              No subscriptions to our platform. No student data sitting on someone else&apos;s servers. We deploy and
              configure the LMS on infrastructure controlled by you — you pay your providers directly.
            </p>
            <h3 className="mt-8 text-sm font-bold uppercase tracking-[0.18em] text-sand">You own</h3>
            <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {ownedByYou.map((o) => (
                <li key={o.label} className="flex items-center gap-3 text-base font-medium">
                  <o.icon size={20} className="shrink-0 text-sand" aria-hidden="true" />
                  {o.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col justify-center rounded-hero border border-cream/15 bg-cream/[0.06] p-6 sm:p-8">
            <h3 className="text-xl font-bold">We handle</h3>
            <ul className="mt-5 space-y-3">
              {handledByUs.map((h) => (
                <li key={h.label} className="flex items-start gap-3 text-base opacity-90">
                  <h.icon size={20} className="mt-0.5 shrink-0 text-sand" aria-hidden="true" />
                  {h.label}
                </li>
              ))}
            </ul>
            <div className="mt-7">
              <Button href="/contact" variant="secondary" className="border-cream/25 bg-cream text-ink">
                Talk to Us
              </Button>
            </div>
          </div>
        </Container>
      </div>

      {/* ── Deployment process ───────────────────────────── */}
      <Section id="how-it-works" aria-label="How deployment works">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">How do I get it?</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
          From finished product to your academy.
        </h2>
        <DeploymentSteps />
      </Section>

      {/* ── Maturity signal ──────────────────────────────── */}
      <div className="border-y border-line bg-sand/60">
        <Container className="py-14 text-center sm:py-16">
          <h2 className="mx-auto max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
            Start with a finished LMS.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
            You are not paying us to build an LMS from scratch. You pay for configuration, branding, deployment,
            verification, and handoff of a working product — on infrastructure you own.
          </p>
        </Container>
      </div>

      {/* ── Pricing (full section, MKT-01D) ────────────── */}
      <Section id="pricing" aria-label="Pricing">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Pricing</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
          A finished LMS, configured for your academy.
        </h2>
        <div className="mt-10">
          <Pricing />
        </div>
      </Section>

      {/* ── Demo CTA ─────────────────────────────────────── */}
      <Section aria-label="Demo call to action">
        <div className="rounded-hero border border-line bg-paper p-8 text-center shadow-card sm:p-12">
          <h2 className="text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">See it with your own eyes.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">
            Explore the LMS demo and see how the student and admin experience works.
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
      </Section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <div className="border-t border-line bg-paper">
        <Container className="py-16 sm:py-20">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal">Questions</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-display font-semibold tracking-tight text-ink sm:text-4xl">
            Asked by every academy owner
          </h2>
          <Faq />
          <FaqSchema />
        </Container>
      </div>

      {/* Spacer so the mobile sticky CTA never covers content */}
      <div aria-hidden="true" className="h-20 md:hidden" />
      <StickyMobileCta />
    </>
  );
}
