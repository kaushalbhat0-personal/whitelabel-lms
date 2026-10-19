import { Check } from 'lucide-react';

/**
 * White-label section (MKT-01C).
 *
 * Three fictional example brands, each explicitly labeled as an example —
 * never implied customers. Swatches use fixed marketing hex values, NOT
 * LMS runtime theme tokens.
 */

const examples = [
  {
    name: 'Sunrise Academy',
    palette: { primary: '#0F766E', sidebar: '#134E4A', accent: '#F59E0B' },
    domain: 'learn.sunriseacademy.example',
    note: 'Teal + warm accent',
  },
  {
    name: 'Northstar Learning',
    palette: { primary: '#6D28D9', sidebar: '#2E1065', accent: '#FBBF24' },
    domain: 'learn.northstarlearning.example',
    note: 'Violet + cream',
  },
  {
    name: 'Apex Commerce Classes',
    palette: { primary: '#1D4ED8', sidebar: '#172554', accent: '#38BDF8' },
    domain: 'learn.apexcommerce.example',
    note: 'Blue + neutral',
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
      <div className="grid gap-4 md:grid-cols-3">
        {examples.map((e) => (
          <figure
            key={e.name}
            className="overflow-hidden rounded-card border border-line bg-paper shadow-card transition-shadow duration-200 hover:shadow-card-hover"
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: e.palette.sidebar }}>
              <span className="h-8 w-8 shrink-0 rounded-cta bg-white/90" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{e.name}</p>
                <p className="truncate text-xs text-white/70">{e.domain}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-4" aria-hidden="true">
              <span className="h-6 flex-1 rounded-full" style={{ backgroundColor: e.palette.primary }} />
              <span className="h-6 w-6 rounded-full" style={{ backgroundColor: e.palette.accent }} />
            </div>
            <figcaption className="border-t border-line px-4 py-3">
              <p className="text-sm font-semibold text-ink">{e.note}</p>
              <p className="text-xs text-ink-soft">Example branding — not a customer</p>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div>
          <h3 className="text-xl font-bold text-ink">Your students use an LMS that looks like yours.</h3>
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
