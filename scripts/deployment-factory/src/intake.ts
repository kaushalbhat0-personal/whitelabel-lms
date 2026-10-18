/**
 * Structured client-intake skeleton generator (`factory init`).
 *
 * Why this file exists:
 *   - Operators previously authored client.config.json freeform — easy to
 *     forget the admin identity, ownership notes, or provider questions.
 *   - The skeleton is a VALID-SHAPE JSON file whose placeholder values
 *     DELIBERATELY fail validation (reserved .invalid domains, TODO names),
 *     so it can never be shipped unedited: `validate` blocks it loudly.
 *   - A companion INTAKE-NOTES file records the human questions (who owns
 *     what, where credentials live). Notes are names/notes only — the
 *     password is NEVER represented anywhere in intake.
 */

export const INTAKE_PLACEHOLDER_DOMAIN = 'example.invalid';

export function buildIntakeSkeleton(deploymentId: string): string {
  const skeleton = {
    client: {
      name: 'TODO — Client Legal Name (REPLACE)',
      deploymentId,
    },
    identity: {
      businessName: 'TODO — Client Legal Name (REPLACE)',
      logoUrl: 'https://learn.example.invalid/brand/logo.png',
      faviconUrl: 'https://learn.example.invalid/brand/favicon.ico',
      website: 'https://www.example.invalid',
      supportEmail: 'support@example.invalid',
      supportPhone: 'TODO — support phone (REPLACE)',
      email: 'hello@example.invalid',
      phone: 'TODO — business phone, min 10 chars (REPLACE)',
      addressLine1: 'TODO — street address (REPLACE)',
      city: 'TODO — city (REPLACE)',
      state: 'TODO — state (REPLACE)',
      pincode: 'TODO — pincode (REPLACE)',
      country: 'TODO — country (REPLACE)',
    },
    admin: {
      name: 'TODO — First Administrator Full Name (REPLACE)',
      email: 'admin@example.invalid',
    },
    ownership: {
      supabaseOwner: 'TODO — who owns the Supabase project/org (REPLACE)',
      hostingOwner: 'TODO — who owns Render + Vercel accounts (REPLACE)',
      redisProvider: 'TODO — managed Redis host or Upstash, owner noted (REPLACE)',
      registrarOwner: 'TODO — who approves DNS changes (REPLACE)',
      senderDomainOwner: 'TODO — who owns the email sender domain, if any (REPLACE)',
      notes: 'TODO — intake notes: plans, invoice/receipt numbering, tax confirmation (REPLACE)',
    },
    localization: {
      locale: 'en-US',
      timezone: 'America/Chicago',
      currency: 'USD',
      fyStartMonth: 0,
    },
    tax: {
      mode: 'exclusive',
      rate: 0,
    },
    financial: {
      invoicePrefix: 'TODO-INV',
      receiptPrefix: 'TODO-RCP',
      currentFinancialYear: 'TODO-YYYY-YYYY',
    },
    theme: {
      primary: '#1e3a8a',
      sidebarBg: '#0f172a',
      accent: '#f59e0b',
    },
    legal: {
      legalFooter: 'TODO — legal footer (REPLACE)',
    },
    deployment: {
      frontendDomain: 'https://learn.example.invalid',
      apiDomain: 'https://api.example.invalid',
    },
    providers: {
      video: 'bunny',
      email: 'none',
      zoom: false,
    },
  };
  return JSON.stringify(skeleton, null, 2) + '\n';
}

export function buildIntakeNotes(deploymentId: string): string {
  return [
    `# Intake notes — ${deploymentId}`,
    '',
    'Fill in the client answers, then complete the matching fields in the',
    'skeleton config. This file is operator scratch — names/notes only.',
    'NEVER write passwords, keys, or tokens here (or anywhere in intake).',
    '',
    '- [ ] First admin: full name + email (goes to `admin.*`; password is',
    '      client-chosen at first login, never recorded)',
    '- [ ] Supabase owner/account (project stays client-owned)',
    '- [ ] Hosting owner (Render + Vercel accounts, client-owned)',
    '- [ ] Redis provider + owner (managed host or Upstash)',
    '- [ ] Registrar / domain owner (DNS approval authority)',
    '- [ ] Frontend + API final domains (exact origins, no trailing slash)',
    '- [ ] Email sender-domain owner (or confirm Resend deferred = STUB mode)',
    '- [ ] Video provider decision (bunny | mux rollback | none = 503 visible)',
    '- [ ] Live-session provider (Zoom purchased? default host?)',
    '- [ ] Tax mode + rate confirmed by client finance (exclusive/inclusive/zero)',
    '- [ ] Invoice/receipt prefixes + current financial year confirmed',
    '- [ ] Brand assets staged (logoUrl/faviconUrl reachable over https)',
    '- [ ] Where runtime secrets will be handed over (client-owned store)',
    '',
    `Next: edit the skeleton config, then run \`pnpm factory validate <config>\`.`,
    '',
  ].join('\n');
}
