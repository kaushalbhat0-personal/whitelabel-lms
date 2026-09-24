'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getPublicBusinessConfig, BusinessConfigPublic } from '@/lib/api/business-config';

interface BusinessConfigContextValue {
  businessName: string;
  logoUrl?: string;
  currency: string;
  locale: string;
  timezone: string;
  loading: boolean;
}

const defaults: BusinessConfigContextValue = {
  businessName: 'LMS Platform',
  logoUrl: undefined,
  currency: 'INR',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
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
        setValue({
          businessName: cfg.business_name ?? defaults.businessName,
          logoUrl: cfg.logo_url ?? undefined,
          currency: cfg.currency ?? defaults.currency,
          locale: cfg.locale ?? defaults.locale,
          timezone: cfg.timezone ?? defaults.timezone,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setValue((prev) => ({ ...prev, loading: false }));
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
