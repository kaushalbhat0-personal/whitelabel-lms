import { IsOptional, Matches } from 'class-validator';

const HEX_6 = /^#[0-9A-Fa-f]{6}$/;

/**
 * Allowlisted theme payload — exactly #RRGGBB per field.
 * Unknown keys are rejected by global ValidationPipe (whitelist + forbidNonWhitelisted).
 * Partial objects are valid — missing fields fall back to DEFAULT_THEME_* independently.
 */
export class ThemeJsonDto {
  @IsOptional()
  @Matches(HEX_6, { message: 'primary must be a valid hex color #RRGGBB' })
  primary?: string;

  @IsOptional()
  @Matches(HEX_6, { message: 'sidebarBg must be a valid hex color #RRGGBB' })
  sidebarBg?: string;

  @IsOptional()
  @Matches(HEX_6, { message: 'accent must be a valid hex color #RRGGBB' })
  accent?: string;
}

export type ThemeJson = {
  primary?: string;
  sidebarBg?: string;
  accent?: string;
};

/** Strict hex check used at service + CSS boundary (never trust raw DB JSON). */
export function isValidHex6(v: unknown): v is string {
  return typeof v === 'string' && HEX_6.test(v);
}

/** Allowlist filter — strips anything not in { primary, sidebarBg, accent } and rejects non-hex. */
export function sanitizeThemeJson(raw: unknown): ThemeJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ThemeJson = {};
  let hasAny = false;
  for (const k of ['primary', 'sidebarBg', 'accent'] as const) {
    const v = r[k];
    if (v !== undefined) {
      if (!isValidHex6(v)) return null; // caller will treat as validation failure
      (out as any)[k] = v;
      hasAny = true;
    }
  }
  // If raw had unknown keys they were ignored here, but DTO validation will have rejected them on input.
  // For DB reads we silently strip unknown keys rather than throwing.
  return hasAny ? out : null;
}
