/**
 * Client configuration validator.
 *
 * Why this file exists:
 *   - Every generator trusts a validated config. Validation is the gate.
 *   - Rules mirror UpdateBusinessConfigDto + ThemeJsonDto
 *     (apps/api/src/modules/business-config/dto/) so the factory never emits
 *     a payload the API would reject — PLUS cross-field rules the DTO cannot
 *     express (origin consistency, no trailing slash, no localhost).
 *   - Unknown fields are rejected: a typo'd key must fail loudly, not be
 *     silently dropped (which would deploy a client with missing branding).
 *
 * This module is pure (no I/O) so it is fully unit-testable.
 */

import { TOP_LEVEL_KEYS, OWNERSHIP_KEYS } from './types';
import { isolationGuards } from './guards';
import { isSupportedTimezone } from './timezones';

export interface ValidationError {
  field: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOCALE_RE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8}){1,2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const HEX6_RE = /^#[0-9A-Fa-f]{6}$/;
const DEPLOYMENT_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const IDENTITY_KEYS = new Set([
  'businessName', 'logoUrl', 'faviconUrl', 'signatureUrl', 'website',
  'supportEmail', 'supportPhone', 'email', 'phone',
  'addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country',
  'gstin', 'pan',
]);
const IDENTITY_REQUIRED = ['businessName', 'logoUrl', 'faviconUrl', 'supportEmail'];

function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Absolute https URL, or a root-relative asset path (logo may be hosted later). */
function isUrlOrRootPath(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0) return false;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  return isHttpsUrl(v);
}

function checkOrigin(field: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({ field, message: `${field} is required. Expected an exact origin like https://learn.client.com` });
    return;
  }
  if (value.endsWith('/')) {
    errors.push({
      field,
      message:
        `${field} must have no trailing slash — FRONTEND_URL/CORS matching is exact. ` +
        `Received: "${value}" Expected: "${value.replace(/\/+$/, '')}"`,
    });
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    errors.push({ field, message: `${field} must be a valid absolute URL. Received: "${value}"` });
    return;
  }
  if (u.protocol !== 'https:') {
    errors.push({
      field,
      message: `${field} must use https (client deployments are production origins). Received: "${value}"`,
    });
  }
  if (u.username || u.password || u.search || u.hash) {
    errors.push({ field, message: `${field} must be a bare origin (scheme + host, no userinfo/path/query/hash). Received: "${value}"` });
  } else if (u.pathname !== '/' && u.pathname !== '') {
    errors.push({ field, message: `${field} must be a bare origin (scheme + host, no path). Received: "${value}"` });
  }
}

/**
 * Validate an unknown parsed value as a ClientConfig.
 * Returns a list of actionable errors (empty = valid).
 */
export function validateClientConfig(raw: unknown, opts: { knownDomains?: string[] } = {}): ValidationError[] {
  const errors: ValidationError[] = [];
  const err = (field: string, message: string) => errors.push({ field, message });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ field: '(root)', message: 'Config must be a JSON object. Received: ' + (Array.isArray(raw) ? 'array' : typeof raw) }];
  }
  const config = raw as Record<string, unknown>;

  for (const k of Object.keys(config)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(k)) {
      err(k, `Unknown top-level field "${k}". Allowed: ${TOP_LEVEL_KEYS.join(', ')}. Remove it or fix the typo.`);
    }
  }

  // client
  const client = config.client as Record<string, unknown> | undefined;
  if (!client || typeof client !== 'object') {
    err('client', 'client section is required (name + deploymentId).');
  } else {
    for (const k of Object.keys(client)) {
      if (k !== 'name' && k !== 'deploymentId') err(`client.${k}`, `Unknown field "client.${k}". Allowed: name, deploymentId.`);
    }
    if (typeof client.name !== 'string' || client.name.trim().length === 0) {
      err('client.name', 'client.name is required. Expected the human-readable client name, e.g. "Acme Learning Academy".');
    }
    if (typeof client.deploymentId !== 'string' || !DEPLOYMENT_ID_RE.test(client.deploymentId)) {
      err(
        'client.deploymentId',
        `client.deploymentId must be kebab-case (lowercase letters, digits, hyphens), e.g. "acme-2026-01". Received: ${JSON.stringify(client.deploymentId)}`,
      );
    }
  }

  // identity
  const identity = config.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity !== 'object') {
    err('identity', 'identity section is required.');
  } else {
    for (const k of Object.keys(identity)) {
      if (!IDENTITY_KEYS.has(k)) err(`identity.${k}`, `Unknown field "identity.${k}". It will NOT reach the BusinessConfig API — fix the typo.`);
    }
    for (const k of IDENTITY_REQUIRED) {
      if (typeof identity[k] !== 'string' || (identity[k] as string).trim().length === 0) {
        err(`identity.${k}`, `identity.${k} is required. The deployment cannot be branded/handed off without it.`);
      }
    }
    for (const f of ['logoUrl', 'signatureUrl'] as const) {
      const v = identity[f];
      if (v !== undefined && !isUrlOrRootPath(v)) {
        err(`identity.${f}`, `identity.${f} must be an https URL or a root-relative path (e.g. "/brand/logo.png"). Received: ${JSON.stringify(v)}`);
      }
    }
    if (identity.faviconUrl !== undefined && !isHttpsUrl(identity.faviconUrl)) {
      err('identity.faviconUrl', `identity.faviconUrl must be a valid https URL (the API enforces @IsUrl). Received: ${JSON.stringify(identity.faviconUrl)}`);
    }
    if (identity.website !== undefined && !isHttpsUrl(identity.website)) {
      err('identity.website', `identity.website must be a valid https URL (the API enforces @IsUrl). Received: ${JSON.stringify(identity.website)}`);
    }
    for (const f of ['supportEmail', 'email'] as const) {
      const v = identity[f];
      if (v !== undefined && (typeof v !== 'string' || !EMAIL_RE.test(v))) {
        err(`identity.${f}`, `identity.${f} must be a valid email address (the API enforces @IsEmail). Received: ${JSON.stringify(v)}`);
      }
    }
    if (identity.phone !== undefined && (typeof identity.phone !== 'string' || identity.phone.length < 10)) {
      err('identity.phone', `identity.phone must be at least 10 characters (API rule). Received: ${JSON.stringify(identity.phone)}`);
    }
  }

  // admin (first LMS administrator — non-secret identity only, never a password)
  const admin = config.admin as Record<string, unknown> | undefined;
  if (admin !== undefined) {
    if (typeof admin !== 'object' || Array.isArray(admin)) {
      err('admin', 'admin must be an object when present ({ name, email }). The password is NEVER represented here.');
    } else {
      for (const k of Object.keys(admin)) {
        if (k !== 'name' && k !== 'email') err(`admin.${k}`, `Unknown field "admin.${k}". Allowed: name, email.`);
      }
      if (typeof admin.name !== 'string' || (admin.name as string).trim().length === 0) {
        err('admin.name', 'admin.name is required when the admin section is present (the first LMS administrator).');
      }
      if (typeof admin.email !== 'string' || !EMAIL_RE.test(admin.email as string)) {
        err('admin.email', `admin.email must be a valid email address. Received: ${JSON.stringify(admin.email)}`);
      }
    }
  }

  // ownership (intake notes — names/notes only, never credentials)
  const ownership = config.ownership as Record<string, unknown> | undefined;
  if (ownership !== undefined) {
    if (typeof ownership !== 'object' || Array.isArray(ownership)) {
      err('ownership', 'ownership must be an object when present (owner names/notes only — never credentials).');
    } else {
      for (const k of Object.keys(ownership)) {
        if (!OWNERSHIP_KEYS.includes(k as (typeof OWNERSHIP_KEYS)[number])) {
          err(`ownership.${k}`, `Unknown field "ownership.${k}". Allowed: ${OWNERSHIP_KEYS.join(', ')}.`);
        } else if (typeof ownership[k] !== 'string' || (ownership[k] as string).trim().length === 0) {
          err(`ownership.${k}`, `ownership.${k} must be a non-empty note when present. Received: ${JSON.stringify(ownership[k])}`);
        }
      }
    }
  }

  // localization
  const loc = config.localization as Record<string, unknown> | undefined;
  if (!loc || typeof loc !== 'object') {
    err('localization', 'localization section is required (locale, timezone, currency, fyStartMonth).');
  } else {
    for (const k of Object.keys(loc)) {
      if (!['locale', 'timezone', 'currency', 'fyStartMonth'].includes(k)) err(`localization.${k}`, `Unknown field "localization.${k}".`);
    }
    if (typeof loc.locale !== 'string' || !LOCALE_RE.test(loc.locale)) {
      err('localization.locale', `localization.locale must look like a BCP-47 tag (e.g. "en-US", "en-IN"). Received: ${JSON.stringify(loc.locale)}`);
    }
    if (typeof loc.timezone !== 'string' || !isSupportedTimezone(loc.timezone)) {
      err(
        'localization.timezone',
        `localization.timezone must be a valid IANA timezone (e.g. "America/New_York"). Received: ${JSON.stringify(loc.timezone)}`,
      );
    }
    if (typeof loc.currency !== 'string' || !CURRENCY_RE.test(loc.currency)) {
      err('localization.currency', `localization.currency must be a 3-letter ISO code (e.g. "USD"). Received: ${JSON.stringify(loc.currency)}`);
    }
    if (typeof loc.fyStartMonth !== 'number' || !Number.isInteger(loc.fyStartMonth) || loc.fyStartMonth < 0 || loc.fyStartMonth > 11) {
      err('localization.fyStartMonth', `localization.fyStartMonth must be an integer 0–11 (0=January). Received: ${JSON.stringify(loc.fyStartMonth)}`);
    }
  }

  // tax
  const tax = config.tax as Record<string, unknown> | undefined;
  if (!tax || typeof tax !== 'object') {
    err('tax', 'tax section is required (mode + rate).');
  } else {
    for (const k of Object.keys(tax)) {
      if (k !== 'mode' && k !== 'rate') err(`tax.${k}`, `Unknown field "tax.${k}". Allowed: mode, rate.`);
    }
    if (!['inclusive', 'exclusive', 'zero'].includes(tax.mode as string)) {
      err('tax.mode', `tax.mode must be one of inclusive | exclusive | zero. Received: ${JSON.stringify(tax.mode)}`);
    }
    if (typeof tax.rate !== 'number' || Number.isNaN(tax.rate) || tax.rate < 0 || tax.rate > 100) {
      err('tax.rate', `tax.rate must be a number 0–100. Received: ${JSON.stringify(tax.rate)}`);
    }
    if (tax.mode === 'zero' && tax.rate !== 0) {
      err('tax.rate', `tax.mode is "zero" so tax.rate should be 0. Received: ${JSON.stringify(tax.rate)}`);
    }
  }

  // financial
  const fin = config.financial as Record<string, unknown> | undefined;
  if (!fin || typeof fin !== 'object') {
    err('financial', 'financial section is required (invoicePrefix, receiptPrefix, currentFinancialYear).');
  } else {
    for (const k of Object.keys(fin)) {
      if (!['invoicePrefix', 'receiptPrefix', 'currentFinancialYear'].includes(k)) err(`financial.${k}`, `Unknown field "financial.${k}".`);
    }
    for (const f of ['invoicePrefix', 'receiptPrefix', 'currentFinancialYear'] as const) {
      if (typeof fin[f] !== 'string' || (fin[f] as string).trim().length === 0) {
        err(`financial.${f}`, `financial.${f} is required and must be non-empty. Received: ${JSON.stringify(fin[f])}`);
      }
    }
  }

  // theme (allowlist mirrors ThemeJsonDto — arbitrary keys are rejected)
  const theme = config.theme as Record<string, unknown> | undefined;
  if (!theme || typeof theme !== 'object') {
    err('theme', 'theme section is required (primary, sidebarBg, accent).');
  } else {
    for (const k of Object.keys(theme)) {
      if (!['primary', 'sidebarBg', 'accent'].includes(k)) {
        err(`theme.${k}`, `Unknown theme key "${k}". Allowed: primary, sidebarBg, accent (API allowlist). Received value is dropped.`);
      }
    }
    for (const f of ['primary', 'sidebarBg', 'accent'] as const) {
      const v = theme[f];
      if (typeof v !== 'string' || !HEX6_RE.test(v)) {
        err(
          `theme.${f}`,
          `theme.${f} must be a 6-digit hex color. Received: ${JSON.stringify(v)} Expected: "#RRGGBB" (e.g. "#1e3a8a")`,
        );
      }
    }
  }

  // legal
  const legal = config.legal as Record<string, unknown> | undefined;
  if (legal !== undefined) {
    if (typeof legal !== 'object' || Array.isArray(legal)) {
      err('legal', 'legal must be an object when present (legalFooter?).');
    } else {
      for (const k of Object.keys(legal)) {
        if (k !== 'legalFooter') err(`legal.${k}`, `Unknown field "legal.${k}". Allowed: legalFooter.`);
      }
    }
  }

  // deployment origins
  const dep = config.deployment as Record<string, unknown> | undefined;
  if (!dep || typeof dep !== 'object') {
    err('deployment', 'deployment section is required (frontendDomain + apiDomain as exact origins).');
  } else {
    for (const k of Object.keys(dep)) {
      if (k !== 'frontendDomain' && k !== 'apiDomain') err(`deployment.${k}`, `Unknown field "deployment.${k}". Allowed: frontendDomain, apiDomain.`);
    }
    checkOrigin('deployment.frontendDomain', dep.frontendDomain, errors);
    checkOrigin('deployment.apiDomain', dep.apiDomain, errors);
    if (typeof dep.frontendDomain === 'string' && typeof dep.apiDomain === 'string') {
      try {
        if (new URL(dep.frontendDomain).hostname === new URL(dep.apiDomain).hostname) {
          err(
            'deployment.apiDomain',
            `deployment.apiDomain must differ from deployment.frontendDomain (separate Vercel + Render origins). Both are "${dep.frontendDomain}".`,
          );
        }
      } catch {
        /* origin errors already recorded */
      }
    }
  }

  // providers
  const prov = config.providers as Record<string, unknown> | undefined;
  if (!prov || typeof prov !== 'object') {
    err('providers', 'providers section is required (video, email, zoom).');
  } else {
    for (const k of Object.keys(prov)) {
      if (!['video', 'email', 'zoom'].includes(k)) err(`providers.${k}`, `Unknown field "providers.${k}". Allowed: video, email, zoom.`);
    }
    if (!['bunny', 'mux', 'none'].includes(prov.video as string)) {
      err('providers.video', `providers.video must be one of bunny | mux | none. Received: ${JSON.stringify(prov.video)}`);
    }
    if (!['resend', 'none'].includes(prov.email as string)) {
      err('providers.email', `providers.email must be one of resend | none. Received: ${JSON.stringify(prov.email)}`);
    }
    if (typeof prov.zoom !== 'boolean') {
      err('providers.zoom', `providers.zoom must be a boolean. Received: ${JSON.stringify(prov.zoom)}`);
    }
  }

  // isolation guards are blocking validation errors
  for (const g of isolationGuards(config, opts.knownDomains ?? [])) {
    err(`(guard:${g.code})`, g.message);
  }

  return errors;
}

/** Human-readable multi-line rendering of validation errors for operator output. */
export function formatErrors(errors: ValidationError[]): string {
  const lines = ['INVALID_CONFIG', ''];
  for (const e of errors) lines.push(`- ${e.field}: ${e.message}`);
  return lines.join('\n');
}
