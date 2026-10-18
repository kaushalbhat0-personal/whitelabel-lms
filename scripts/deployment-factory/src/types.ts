/**
 * Deployment Factory — canonical NON-SECRET client configuration types.
 *
 * Why this file exists:
 *   - One validated client config is the single input to every generator.
 *   - This shape is intentionally NON-SECRET: no keys, tokens, or passwords.
 *   - Field names match UpdateBusinessConfigDto (apps/api) where they map to
 *     the BusinessConfig API, so the payload builder is a mechanical mapping.
 *   - Deployment/provider-selection fields do NOT go into BusinessConfig.
 *
 * Secret policy: adding a secret field here is a defect. Secrets are entered
 * directly into client-owned dashboards and never appear in factory output.
 */

export interface ClientIdentity {
  businessName: string;
  logoUrl: string;
  faviconUrl: string;
  signatureUrl?: string;
  website?: string;
  supportEmail: string;
  supportPhone?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  gstin?: string;
  pan?: string;
}

export interface ClientLocalization {
  locale: string;
  timezone: string;
  currency: string;
  /** 0 = January … 11 = December */
  fyStartMonth: number;
}

export interface ClientTax {
  mode: 'inclusive' | 'exclusive' | 'zero';
  rate: number;
}

export interface ClientFinancial {
  invoicePrefix: string;
  receiptPrefix: string;
  currentFinancialYear: string;
}

export interface ClientTheme {
  primary: string;
  sidebarBg: string;
  accent: string;
}

export interface ClientDeployment {
  /** Exact public origin, e.g. https://learn.client.com (no trailing slash) */
  frontendDomain: string;
  /** Exact public API origin, e.g. https://api.client.com (no trailing slash) */
  apiDomain: string;
}

export interface ClientProviders {
  /** Where NEW uploads go. 'none' = video uploads disabled (503 fail-visible). */
  video: 'bunny' | 'mux' | 'none';
  email: 'resend' | 'none';
  zoom: boolean;
}

export interface ClientAdmin {
  /** First LMS administrator (human). Non-secret. Password is NEVER represented here. */
  name: string;
  email: string;
}

export interface ClientOwnership {
  /** Operator intake notes: who owns what. Names/notes only — NEVER credentials. */
  supabaseOwner?: string;
  hostingOwner?: string;
  redisProvider?: string;
  registrarOwner?: string;
  senderDomainOwner?: string;
  notes?: string;
}

export interface ClientConfig {
  client: {
    /** Human name, e.g. "Acme Learning Academy" */
    name: string;
    /** Machine id, kebab-case, e.g. "acme-2026-01" */
    deploymentId: string;
  };
  identity: ClientIdentity;
  localization: ClientLocalization;
  tax: ClientTax;
  financial: ClientFinancial;
  theme: ClientTheme;
  legal: {
    legalFooter?: string;
  };
  deployment: ClientDeployment;
  providers: ClientProviders;
  /** First admin identity (non-secret). When present, first-admin SQL uses it. */
  admin?: ClientAdmin;
  /** Intake notes: who owns what (names/notes only, never credentials). */
  ownership?: ClientOwnership;
}

/** Sections allowed at the top level of a client config file. */
export const TOP_LEVEL_KEYS = [
  'client',
  'identity',
  'admin',
  'ownership',
  'localization',
  'tax',
  'financial',
  'theme',
  'legal',
  'deployment',
  'providers',
] as const;

/** Ownership note keys (freeform names/notes only — never credentials). */
export const OWNERSHIP_KEYS = [
  'supabaseOwner',
  'hostingOwner',
  'redisProvider',
  'registrarOwner',
  'senderDomainOwner',
  'notes',
] as const;
