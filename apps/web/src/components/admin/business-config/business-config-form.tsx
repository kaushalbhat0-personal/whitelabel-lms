'use client';

import { useState, useEffect } from 'react';
import { Save, Building2 } from 'lucide-react';
import {
  type BusinessConfig,
  getBusinessConfig,
  updateBusinessConfig,
} from '@/lib/api/business-config';

interface BusinessConfigFormProps {
}

export function BusinessConfigForm({}: BusinessConfigFormProps) {
  const [config, setConfig] = useState<BusinessConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getBusinessConfig()
      .then((data: any) => {
        // Backward compat: 040 adds 11 columns with DEFAULTs; pre-040 rows lack them.
        // Fallback to P1A defaults at the form boundary (no defaults.ts duplication needed in web).
        const withDefaults: BusinessConfig = {
          ...(data as BusinessConfig),
          timezone: data.timezone ?? 'Asia/Kolkata',
          currency: data.currency ?? 'INR',
          locale: data.locale ?? 'en-IN',
          fy_start_month: data.fy_start_month ?? 3,
          tax_mode: data.tax_mode ?? 'inclusive',
          tax_rate: data.tax_rate ?? 18,
          favicon_url: data.favicon_url ?? undefined,
          support_email: data.support_email ?? undefined,
          support_phone: data.support_phone ?? undefined,
          website: data.website ?? undefined,
          legal_footer: data.legal_footer ?? undefined,
        };
        setConfig(withDefaults);
      })
      .catch(() => setMessage({ type: 'error', text: 'Failed to load config. Run seed.sql first.' }))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (field: string, value: string | number) => {
    if (!config) return;
    setConfig({ ...config, [field]: value } as BusinessConfig);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setMessage(null);

    try {
      const updated = await updateBusinessConfig(
        {
          business_name: config.business_name,
          address_line_1: config.address_line_1,
          address_line_2: config.address_line_2,
          city: config.city,
          state: config.state,
          pincode: config.pincode,
          country: config.country,
          gstin: config.gstin || undefined,
          pan: config.pan || undefined,
          email: config.email,
          phone: config.phone,
          logo_url: config.logo_url || undefined,
          signature_url: config.signature_url || undefined,
          invoice_prefix: config.invoice_prefix,
          receipt_prefix: config.receipt_prefix,
          current_financial_year: config.current_financial_year,
          timezone: config.timezone,
          currency: config.currency,
          locale: config.locale,
          fy_start_month: config.fy_start_month,
          tax_mode: config.tax_mode,
          tax_rate: config.tax_rate,
          favicon_url: config.favicon_url || undefined,
          support_email: config.support_email || undefined,
          support_phone: config.support_phone || undefined,
          website: config.website || undefined,
          legal_footer: config.legal_footer || undefined,
        },
      );
      setConfig(updated);
      setMessage({ type: 'success', text: 'Business configuration saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save configuration.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        Loading configuration...
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-16 text-gray-500">
        <Building2 className="mb-3 h-10 w-10 text-gray-300" />
        <p className="text-lg font-medium">No configuration found</p>
        <p className="text-sm mt-1">Run seed.sql in Supabase to create the business config row.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Business Information</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
            <input
              type="text"
              value={config.business_name}
              onChange={(e) => handleChange('business_name', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
            <input
              type="text"
              value={config.address_line_1}
              onChange={(e) => handleChange('address_line_1', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
            <input
              type="text"
              value={config.address_line_2 || ''}
              onChange={(e) => handleChange('address_line_2', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              value={config.city}
              onChange={(e) => handleChange('city', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input
              type="text"
              value={config.state}
              onChange={(e) => handleChange('state', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
            <input
              type="text"
              value={config.pincode}
              onChange={(e) => handleChange('pincode', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <input
              type="text"
              value={config.country}
              onChange={(e) => handleChange('country', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
            <input
              type="text"
              value={config.gstin || ''}
              onChange={(e) => handleChange('gstin', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PAN</label>
            <input
              type="text"
              value={config.pan || ''}
              onChange={(e) => handleChange('pan', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={config.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="text"
              value={config.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Document Configuration</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Prefix</label>
            <input
              type="text"
              value={config.invoice_prefix}
              onChange={(e) => handleChange('invoice_prefix', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Prefix</label>
            <input
              type="text"
              value={config.receipt_prefix}
              onChange={(e) => handleChange('receipt_prefix', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Financial Year</label>
            <input
              type="text"
              value={config.current_financial_year}
              onChange={(e) => handleChange('current_financial_year', e.target.value)}
              placeholder="e.g. 2024-25"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Branding (Optional)</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
            <input
              type="text"
              value={config.logo_url || ''}
              onChange={(e) => handleChange('logo_url', e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Signature URL</label>
            <input
              type="text"
              value={config.signature_url || ''}
              onChange={(e) => handleChange('signature_url', e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Localization</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select
              value={config.timezone ?? 'Asia/Kolkata'}
              onChange={(e) => handleChange('timezone', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
              <option value="Asia/Karachi">Asia/Karachi</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
              <option value="Asia/Tokyo">Asia/Tokyo</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
            <input
              type="text"
              value={config.currency ?? 'INR'}
              onChange={(e) => handleChange('currency', e.target.value)}
              placeholder="INR"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Locale</label>
            <input
              type="text"
              value={config.locale ?? 'en-IN'}
              onChange={(e) => handleChange('locale', e.target.value)}
              placeholder="en-IN"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year Start</label>
            <select
              value={config.fy_start_month ?? 3}
              onChange={(e) => handleChange('fy_start_month', parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value={0}>January</option>
              <option value={1}>February</option>
              <option value={2}>March</option>
              <option value={3}>April</option>
              <option value={4}>May</option>
              <option value={5}>June</option>
              <option value={6}>July</option>
              <option value={7}>August</option>
              <option value={8}>September</option>
              <option value={9}>October</option>
              <option value={10}>November</option>
              <option value={11}>December</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Mode</label>
            <select
              value={config.tax_mode ?? 'inclusive'}
              onChange={(e) => handleChange('tax_mode', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="inclusive">Inclusive</option>
              <option value="exclusive">Exclusive</option>
              <option value="zero">Zero</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={config.tax_rate ?? 18}
              onChange={(e) => handleChange('tax_rate', e.target.value === '' ? 0 : parseFloat(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Support / Business Contact</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Support Email</label>
            <input
              type="email"
              value={config.support_email || ''}
              onChange={(e) => handleChange('support_email', e.target.value)}
              placeholder="support@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Support Phone</label>
            <input
              type="text"
              value={config.support_phone || ''}
              onChange={(e) => handleChange('support_phone', e.target.value)}
              placeholder="+971-500123456"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              value={config.website || ''}
              onChange={(e) => handleChange('website', e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Branding / Legal</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Favicon URL</label>
            <input
              type="url"
              value={config.favicon_url || ''}
              onChange={(e) => handleChange('favicon_url', e.target.value)}
              placeholder="https://example.com/favicon.ico"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Legal Footer</label>
            <textarea
              value={config.legal_footer || ''}
              onChange={(e) => handleChange('legal_footer', e.target.value)}
              placeholder="Authorized invoice"
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end border-t pt-6">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </form>
  );
}
