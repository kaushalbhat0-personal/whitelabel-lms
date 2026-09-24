import { fetchApi } from '@/lib/api-client';

export interface BusinessConfig {
  id: string;
  business_name: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  gstin?: string;
  pan?: string;
  email: string;
  phone: string;
  logo_url?: string;
  signature_url?: string;
  invoice_prefix: string;
  receipt_prefix: string;
  current_financial_year: string;
  next_invoice_number: number;
  next_receipt_number: number;
  timezone: string;
  currency: string;
  locale: string;
  fy_start_month: number;
  tax_mode: string;
  tax_rate: number;
  favicon_url?: string;
  support_email?: string;
  support_phone?: string;
  website?: string;
  legal_footer?: string;
}

export interface BusinessConfigPublic {
  business_name: string;
  logo_url?: string;
  currency: string;
  locale: string;
  timezone: string;
}

export async function getBusinessConfig() {
  return fetchApi<BusinessConfig>('/business-config');
}

export async function getPublicBusinessConfig() {
  return fetchApi<BusinessConfigPublic>('/business-config/public');
}

export async function updateBusinessConfig(
  data: Partial<Omit<BusinessConfig, 'id' | 'next_invoice_number' | 'next_receipt_number'>>,
) {
  return fetchApi<BusinessConfig>('/business-config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
