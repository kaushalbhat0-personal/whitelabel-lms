-- P2A — BusinessConfig white-label foundation (11 columns)
-- Client-business configurability for timezone, currency, locale, FY, tax, contacts, branding.
-- No tenant_id, no multi-tenancy. Singleton per deployment remains.

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-IN';

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS fy_start_month INT NOT NULL DEFAULT 3
    CHECK (fy_start_month BETWEEN 0 AND 11);

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'inclusive'
    CHECK (tax_mode IN ('inclusive', 'exclusive', 'zero'));

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18
    CHECK (tax_rate >= 0 AND tax_rate <= 100);

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS favicon_url TEXT;

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS support_email TEXT;

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS support_phone TEXT;

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS website TEXT;

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS legal_footer TEXT;

-- Existing row and seed remain valid: all new required columns have DEFAULTs.
-- New nullable columns (favicon_url, support_email/phone, website, legal_footer) stay NULL until Client Admin configures.
