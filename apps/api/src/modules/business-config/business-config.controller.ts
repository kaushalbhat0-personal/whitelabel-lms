/*
 * Business Config controller — endpoints for the single-row business configuration
 *
 * Why this controller exists:
 *   - GET /business-config returns the current config (used by invoice templates).
 *   - PUT /business-config updates fields (admin only — all fields are optional).
 *   - Thin HTTP layer — delegates all logic to BusinessConfigService.
 *
 * A junior should know:
 *   - Both endpoints require admin role (see @Roles decorator).
 *   - The GET response is cached in-memory? No — reads fresh from DB every time.
 *   - PUT does a partial update — only send the fields you want to change.
 */
import { Controller, Get, Put, Body } from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { BusinessConfigService } from './business-config.service';
import { UpdateBusinessConfigDto } from './dto/update-business-config.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('business-config')
export class BusinessConfigController {
  constructor(private readonly businessConfigService: BusinessConfigService) {}

  /**
   * GET /business-config/public
   *
   * Presentation-safe subset for authenticated admin/student shell.
   * Returns only business_name, logo_url, currency, locale, timezone.
   * Does NOT expose gstin/pan/address/tax/etc.
   */
  @Roles(UserRole.ADMIN, UserRole.STUDENT, UserRole.TEACHER)
  @Get('public')
  getPublicConfig() {
    return this.businessConfigService.getPublicConfig();
  }

  /**
   * GET /business-config
   *
   * Returns the single business configuration row.
   * Used by invoice templates to populate business name, address, GSTIN, etc.
   */
  @Roles(UserRole.ADMIN)
  @Get()
  getConfig() {
    return this.businessConfigService.getConfig();
  }

  /**
   * PUT /business-config
   *
   * Partially update the business configuration.
   * Only provided fields are updated — all DTO fields are optional.
   */
  @Roles(UserRole.ADMIN)
  @Put()
  updateConfig(@Body() dto: UpdateBusinessConfigDto) {
    return this.businessConfigService.updateConfig(dto);
  }
}
