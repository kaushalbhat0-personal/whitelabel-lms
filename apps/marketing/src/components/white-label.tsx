import { Check } from 'lucide-react';

/**
 * White-label section (MKT-01C, visual proof MKT-02B).
 *
 * Three fictional example brands ("Same LMS, three identities") rendered as
 * miniature sidebar compositions — identical layout, different warm themes —
 * so prospects see that one LMS can look like different businesses. Each is
 * explicitly labeled a styling example, never a customer. Palettes use fixed
 * marketing hex values in the warm editorial range (no violet/blue), NOT
 * LMS runtime theme tokens. Mini mock is illustrative, not a screenshot.
 */

const examples = [
  {
    name: 'Sunrise Academy',
    palette: { sidebar: '#7C2D12', primary: '#C2410C', soft: '#F3EFE7', accent: '#0F766E' },
    domain: 'learn.sunriseacademy.example',
    note: 'Terracotta + cream',
  },
  {
    name: 'Northstar Learning',
    palette: { sidebar: '#134E4A', primary: '#0F766E', soft: '#EAF3F0', accent: '#C2410C' },
    domain: 'learn.northstarlearning.example',
    note: 'Deep teal + paper',
  },
  {
    name: 'Apex Commerce Classes',
    palette: { sidebar: '#1C1917', primary: '#57534E', soft: '#F3EFE7', accent: '#B45309' },
    domain: 'learn.apexcommerce.example',
    note: 'Charcoal + amber',
  },
];

const identityItems = [
  'Business name, logo, and favicon',
  'Brand colors across student and admin views',
  'Your own domain for students and staff',
  'Business details on invoices and receipts',
  'Certificates and verification under your brand',
  'Currency, locale, and timezone',
  'Tax settings for compliant billing',
  'Invoice and receipt numbering you choose',
];

export function WhiteLabel() {
  return (
    <div>
      <p className="font-display text-lg font-semibold tracking-tight text-ink">
        Same LMS <span aria-hidden="true" className="text-clay">·</span> three identities
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {examples.map((e) => (
          <figure
            key={e.name}
            className="overflow-hidden rounded-card border border-ink/10 bg-paper shadow-[0_16px_32px_-16px_rgb(28_25_23/0.16)]"
          >
            {/* Miniature sidebar composition — illustrative styling example, not a screenshot. */}
            <div className="flex" aria-hidden="true">
              <div className="flex w-2/5 flex-col gap-1.5 p-3" style={{ backgroundColor: e.palette.sidebar }}>
                <span className="mb-1 h-5 w-5 rounded-[6px] bg-white/90" />
                <span className="h-1.5 w-4/5 rounded-full bg-white/85" />
                <span
                  className="h-1.5 w-full rounded-full bg-white/90"
                  style={{ outline: '1px solid rgb(255 255 255 / 0.35)', outlineOffset: '-1px' }}
                />
                <span className="h-1.5 w-3/5 rounded-full bg-white/50" />
                <span className="h-1.5 w-4/5 rounded-full bg-white/50" />
                <span className="h-1.5 w-3/5 rounded-full bg-white/50" />
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3" style={{ backgroundColor: e.palette.soft }}>
                <span className="h-2 w-3/5 rounded-full" style={{ backgroundColor: e.palette.primary }} />
                <span className="h-1.5 w-full rounded-full bg-ink/10" />
                <span className="h-1.5 w-11/12 rounded-full bg-ink/10" />
                <span className="mt-1 flex gap-1.5">
                  <span className="h-4 w-14 rounded-full" style={{ backgroundColor: e.palette.primary }} />
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: e.palette.accent }} />
                </span>
              </div>
            </div>
            <figcaption className="border-t border-line px-4 py-3">
              <p className="truncate text-sm font-bold text-ink">{e.name}</p>
              <p className="truncate text-xs text-ink-soft">{e.domain}</p>
              <p className="mt-1 text-xs font-medium text-ink-soft">
                {e.note} · Example branding — not a customer
              </p>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-10 grid gap-8 border-t border-line pt-8 lg:grid-cols-2">
        <div>
          <h3 className="font-display text-xl font-semibold tracking-tight text-ink">
            Your students use an LMS that looks like yours.
          </h3>
          <p className="mt-3 text-lg leading-relaxed text-ink-soft">
            We configure the identity and presentation of the LMS for your academy before deployment — every screen,
            email, invoice, and certificate carries your brand, not ours.
          </p>
        </div>
        <ul className="space-y-2.5">
          {identityItems.map((item) => (
            <li key={item} className="flex items-start gap-3 text-base text-ink">
              <Check size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
