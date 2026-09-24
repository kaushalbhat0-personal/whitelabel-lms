'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getPublicBusinessConfig, BusinessConfigPublic } from '@/lib/api/business-config';
import {
  DEFAULT_THEME_PRIMARY,
  DEFAULT_THEME_SIDEBAR_BG,
  DEFAULT_THEME_ACCENT,
  ThemeJson,
  resolveTheme,
  applyThemeToDocument,
} from '@/lib/theme';

interface BusinessConfigContextValue {
  businessName: string;
  logoUrl?: string;
  faviconUrl?: string;
  currency: string;
  locale: string;
  timezone: string;
  theme: ThemeJson;
  loading: boolean;
}

const defaults: BusinessConfigContextValue = {
  businessName: 'LMS Platform',
  logoUrl: undefined,
  faviconUrl: undefined,
  currency: 'INR',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  theme: {
    primary: DEFAULT_THEME_PRIMARY,
    sidebarBg: DEFAULT_THEME_SIDEBAR_BG,
    accent: DEFAULT_THEME_ACCENT,
  },
  loading: true,
};

const BusinessConfigContext = createContext<BusinessConfigContextValue>(defaults);

export function BusinessConfigProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<BusinessConfigContextValue>(defaults);

  useEffect(() => {
    let cancelled = false;
    getPublicBusinessConfig()
      .then((cfg: BusinessConfigPublic) => {
        if (cancelled) return;
        const theme = resolveTheme((cfg as any).theme_json);
        // Sync runtime CSS variables — only validated hex values reach the DOM.
        applyThemeToDocument(theme);
        setValue({
          businessName: cfg.business_name ?? defaults.businessName,
          logoUrl: cfg.logo_url ?? undefined,
          faviconUrl: cfg.favicon_url ?? undefined,
          currency: cfg.currency ?? defaults.currency,
          locale: cfg.locale ?? defaults.locale,
          timezone: cfg.timezone ?? defaults.timezone,
          theme,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          // Ensure CSS vars reflect fallback even on fetch failure
          applyThemeToDocument(defaults.theme);
          setValue((prev) => ({ ...prev, loading: false }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BusinessConfigContext.Provider value={value}>
      {children}
    </BusinessConfigContext.Provider>
  );
}

export function useBusinessConfig(): BusinessConfigContextValue {
  return useContext(BusinessConfigContext);
}
