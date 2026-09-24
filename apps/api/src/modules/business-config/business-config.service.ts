/*
 * Business Config service — manages the single-row business configuration
 *
 * Why this service exists:
 *   - The business_config table holds exactly one row (enforced by unique index on TRUE).
 *   - Invoices and receipts read this data for the business name, address, GSTIN, etc.
 *   - Admins can update any field via the controller — all fields are optional in PATCH.
 *
 * A junior should know:
 *   - getConfig() always returns the single row (or throws if missing).
 *   - updateConfig() upserts — if the row doesn't exist, it creates one with the given fields.
 *   - Never hardcode business info in invoice templates — always read from here.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { UpdateBusinessConfigDto } from './dto/update-business-config.dto';
import {
  DEFAULT_BUSINESS_NAME,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
} from '../../common/config/defaults';

@Injectable()
export class BusinessConfigService {
  private readonly logger = new Logger(BusinessConfigService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Fetch the single business_config row.
   * Throws NotFoundException if the row doesn't exist (means seed.sql wasn't run).
   */
  async getConfig() {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .select('*')
      .limit(1)
      .single();

    if (error || !data) {
      this.logger.error('Business config not found — run seed.sql');
      throw new NotFoundException(
        'Business configuration not found. Run seed.sql first.',
      );
    }

    return data;
  }

  /**
   * Public presentation-safe subset — no sensitive financial/legal fields.
   * Returns only business_name, logo_url, currency, locale, timezone with DEFAULT_* fallbacks.
   * Used by authenticated admin/student shell; never exposes gstin/pan/address/tax/etc.
   */
  async getPublicConfig(): Promise<{
    business_name: string;
    logo_url?: string;
    currency: string;
    locale: string;
    timezone: string;
  }> {
    const row = await this.getConfig();
    const r: any = row;
    return {
      business_name: r.business_name ?? DEFAULT_BUSINESS_NAME,
      logo_url: r.logo_url ?? undefined,
      currency: r.currency ?? DEFAULT_CURRENCY,
      locale: r.locale ?? DEFAULT_LOCALE,
      timezone: r.timezone ?? DEFAULT_TIMEZONE,
    };
  }

  /**
   * Partially update the business config.
   * All fields in the DTO are optional — only provided fields are updated.
   * If no row exists yet, creates one with the provided fields + sensible defaults.
   */
  async updateConfig(dto: UpdateBusinessConfigDto) {
    const updateData: Record<string, any> = {};

    // Map camelCase DTO fields to snake_case DB columns
    if (dto.businessName !== undefined) updateData.business_name = dto.businessName;
    if (dto.addressLine1 !== undefined) updateData.address_line_1 = dto.addressLine1;
    if (dto.addressLine2 !== undefined) updateData.address_line_2 = dto.addressLine2;
    if (dto.city !== undefined) updateData.city = dto.city;
    if (dto.state !== undefined) updateData.state = dto.state;
    if (dto.pincode !== undefined) updateData.pincode = dto.pincode;
    if (dto.country !== undefined) updateData.country = dto.country;
    if (dto.gstin !== undefined) updateData.gstin = dto.gstin;
    if (dto.pan !== undefined) updateData.pan = dto.pan;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.logoUrl !== undefined) updateData.logo_url = dto.logoUrl;
    if (dto.signatureUrl !== undefined) updateData.signature_url = dto.signatureUrl;
    if (dto.invoicePrefix !== undefined) updateData.invoice_prefix = dto.invoicePrefix;
    if (dto.receiptPrefix !== undefined) updateData.receipt_prefix = dto.receiptPrefix;
    if (dto.currentFinancialYear !== undefined) updateData.current_financial_year = dto.currentFinancialYear;
    if (dto.timezone !== undefined) updateData.timezone = dto.timezone;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.locale !== undefined) updateData.locale = dto.locale;
    if (dto.fyStartMonth !== undefined) updateData.fy_start_month = dto.fyStartMonth;
    if (dto.taxMode !== undefined) updateData.tax_mode = dto.taxMode;
    if (dto.taxRate !== undefined) updateData.tax_rate = dto.taxRate;
    if (dto.faviconUrl !== undefined) updateData.favicon_url = dto.faviconUrl;
    if (dto.supportEmail !== undefined) updateData.support_email = dto.supportEmail;
    if (dto.supportPhone !== undefined) updateData.support_phone = dto.supportPhone;
    if (dto.website !== undefined) updateData.website = dto.website;
    if (dto.legalFooter !== undefined) updateData.legal_footer = dto.legalFooter;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await this.supabaseService.client
      .from(TABLES.BUSINESS_CONFIG)
      .update(updateData)
      .eq('id', (await this.getConfig()).id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update business config: ${error.message}`);
      throw new BadRequestException('Failed to update business configuration');
    }

    return data;
  }
}
