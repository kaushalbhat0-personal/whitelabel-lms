/**
 * Runtime theme — single source for defaults + validation + CSS var propagation.
 * Mirrors apps/api/src/common/config/defaults.ts DEFAULT_THEME_* on the web.
 * Never inject raw DB JSON — only validated #RRGGBB values reach CSS.
 */

export const DEFAULT_THEME_PRIMARY = '#10b981' as const;
export const DEFAULT_THEME_SIDEBAR_BG = '#064e3b' as const;
export const DEFAULT_THEME_ACCENT = '#f59e0b' as const;

export type ThemeJson = {
  primary: string;
  sidebarBg: string;
  accent: string;
};

const HEX_6 = /^#[0-9A-Fa-f]{6}$/;

export function isValidHex6(v: unknown): v is string {
  return typeof v === 'string' && HEX_6.test(v);
}

export function resolveTheme(raw: unknown): ThemeJson {
  const fallback: ThemeJson = {
    primary: DEFAULT_THEME_PRIMARY,
    sidebarBg: DEFAULT_THEME_SIDEBAR_BG,
    accent: DEFAULT_THEME_ACCENT,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  return {
    primary: isValidHex6(r.primary) ? (r.primary as string) : fallback.primary,
    sidebarBg: isValidHex6(r.sidebarBg) ? (r.sidebarBg as string) : fallback.sidebarBg,
    accent: isValidHex6(r.accent) ? (r.accent as string) : fallback.accent,
  };
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

/** CSS variable map for runtime brand — keep keys in sync with tailwind.config.ts */
export function themeToCssVars(theme: ThemeJson): Record<string, string> {
  const primary = isValidHex6(theme.primary) ? theme.primary : DEFAULT_THEME_PRIMARY;
  const sidebar = isValidHex6(theme.sidebarBg) ? theme.sidebarBg : DEFAULT_THEME_SIDEBAR_BG;
  const accent = isValidHex6(theme.accent) ? theme.accent : DEFAULT_THEME_ACCENT;
  return {
    '--brand-primary': primary,
    '--brand-primary-rgb': hexToRgb(primary),
    '--brand-sidebar': sidebar,
    '--brand-sidebar-rgb': hexToRgb(sidebar),
    '--brand-accent': accent,
    '--brand-accent-rgb': hexToRgb(accent),
  };
}

/** Inline CSS for :root — safe because values are validated hex. */
export function themeCssVarsStyle(theme: ThemeJson): string {
  const vars = themeToCssVars(theme);
  return `:root{--brand-primary:${vars['--brand-primary']};--brand-primary-rgb:${vars['--brand-primary-rgb']};--brand-sidebar:${vars['--brand-sidebar']};--brand-sidebar-rgb:${vars['--brand-sidebar-rgb']};--brand-accent:${vars['--brand-accent']};--brand-accent-rgb:${vars['--brand-accent-rgb']};}`;
}

export function applyThemeToDocument(theme: ThemeJson): void {
  if (typeof document === 'undefined') return;
  const vars = themeToCssVars(theme);
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', vars['--brand-primary']);
  root.style.setProperty('--brand-primary-rgb', vars['--brand-primary-rgb']);
  root.style.setProperty('--brand-sidebar', vars['--brand-sidebar']);
  root.style.setProperty('--brand-sidebar-rgb', vars['--brand-sidebar-rgb']);
  root.style.setProperty('--brand-accent', vars['--brand-accent']);
  root.style.setProperty('--brand-accent-rgb', vars['--brand-accent-rgb']);
}
