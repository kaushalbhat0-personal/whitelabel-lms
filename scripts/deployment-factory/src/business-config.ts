/**
 * BusinessConfig payload builder (PUT /business-config).
 *
 * Why this file exists:
 *   - One validated client config must produce the complete BusinessConfig in
 *     a single API call — no hand-assembled JSON, no missing fields.
 *   - Mapping is 1:1 with UpdateBusinessConfigDto camelCase keys
 *     (apps/api/src/modules/business-config/dto/update-business-config.dto.ts).
 *   - The theme allowlist mirrors ThemeJsonDto ({primary, sidebarBg, accent}).
 *   - Output contains NO secrets and is safe to archive with the handoff.
 *
 * Deliberate duplication note: the DTO lives in NestJS code with
 * class-validator decorators, which this dependency-free operator tool cannot
 * import without dragging the API dependency tree along. The key list below is
 * pinned to the DTO and covered by tests; if the DTO gains a field, add the
 * client-config field + mapping together (validator rejects unknowns, so a
 * drift fails loudly at validation time instead of silently).
 */

import type { ClientConfig } from './types';

/** Exact PUT /business-config body keys accepted by the API (DTO allowlist). */
export const BUSINESS_CONFIG_KEYS = [
  'businessName', 'addressLine1', 'addressLine2', 'city', 'state', 'pincode',
  'country', 'gstin', 'pan', 'email', 'phone', 'logoUrl', 'signatureUrl',
  'invoicePrefix', 'receiptPrefix', 'currentFinancialYear', 'timezone',
  'currency', 'locale', 'fyStartMonth', 'taxMode', 'taxRate', 'faviconUrl',
  'supportEmail', 'supportPhone', 'website', 'legalFooter', 'themeJson',
] as const;

export type BusinessConfigPayload = Partial<Record<(typeof BUSINESS_CONFIG_KEYS)[number], unknown>>;

/** Build the exact PUT /business-config JSON body. Omits unset optionals. */
export function buildBusinessConfigPayload(config: ClientConfig): BusinessConfigPayload {
  const i = config.identity;
  const payload: BusinessConfigPayload = {
    businessName: i.businessName,
    logoUrl: i.logoUrl,
    faviconUrl: i.faviconUrl,
    supportEmail: i.supportEmail,
    timezone: config.localization.timezone,
    currency: config.localization.currency,
    locale: config.localization.locale,
    fyStartMonth: config.localization.fyStartMonth,
    taxMode: config.tax.mode,
    taxRate: config.tax.rate,
    invoicePrefix: config.financial.invoicePrefix,
    receiptPrefix: config.financial.receiptPrefix,
    currentFinancialYear: config.financial.currentFinancialYear,
    themeJson: {
      primary: config.theme.primary,
      sidebarBg: config.theme.sidebarBg,
      accent: config.theme.accent,
    },
  };

  const optionals: Array<[keyof BusinessConfigPayload, unknown]> = [
    ['signatureUrl', i.signatureUrl],
    ['website', i.website],
    ['supportPhone', i.supportPhone],
    ['email', i.email],
    ['phone', i.phone],
    ['addressLine1', i.addressLine1],
    ['addressLine2', i.addressLine2],
    ['city', i.city],
    ['state', i.state],
    ['pincode', i.pincode],
    ['country', i.country],
    ['gstin', i.gstin],
    ['pan', i.pan],
    ['legalFooter', config.legal.legalFooter],
  ];
  for (const [k, v] of optionals) {
    if (v !== undefined) payload[k] = v;
  }

  // Defensive: never emit a key outside the DTO allowlist.
  for (const k of Object.keys(payload)) {
    if (!(BUSINESS_CONFIG_KEYS as readonly string[]).includes(k)) delete payload[k as keyof BusinessConfigPayload];
  }
  return payload;
}
