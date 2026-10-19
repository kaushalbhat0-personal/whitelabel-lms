/*
 * Temporary demo-access controller — sales-demo deployment only.
 *
 * Why this controller exists:
 *   - Thin HTTP layer for POST /demo/access. All issuance rules live in
 *     DemoAccessService; this file only enforces the deployment gate and
 *     extracts the client IP for rate limiting.
 *   - When TEMP_DEMO_ACCESS is not explicitly 'enabled', the route behaves
 *     as absent (404) so client deployments reveal nothing about the
 *     capability, the deployment type, or configuration values.
 *
 * Cache contract: credential responses carry `Cache-Control: no-store` and
 * the web client fetches with `cache: 'no-store'` — credentials must never
 * sit in a cache. No credential-retrieval endpoint exists by design.
 */

import { Body, Controller, Header, Logger, NotFoundException, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DemoAccessService } from './demo-access.service';
import { DemoAccessRequestDto } from './dto/demo-access-request.dto';
import { Public } from '../../common/decorators/public.decorator';
import { resolveTempDemoAccessPolicy } from '../../common/constants/temp-demo-access.constant';

@Controller('demo')
export class DemoAccessController {
  private readonly logger = new Logger(DemoAccessController.name);
  private readonly enabled: boolean;

  constructor(
    private readonly demoAccessService: DemoAccessService,
    configService: ConfigService,
  ) {
    // Fail fast at startup on invalid values (unset → disabled).
    this.enabled = resolveTempDemoAccessPolicy(configService.get<string>('TEMP_DEMO_ACCESS')) === 'enabled';
  }

  /**
   * POST /demo/access — issue one temporary student account.
   *
   * No request body. Any supplied property is rejected (400) by the global
   * ValidationPipe via the empty DemoAccessRequestDto.
   */
  @Public()
  @Post('access')
  @Header('Cache-Control', 'no-store')
  async create(@Body() _body: DemoAccessRequestDto, @Req() req: Request) {
    if (!this.enabled) {
      // Behave as absent: same 404 shape as an unknown route, no details.
      throw new NotFoundException();
    }
    const rawIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(',')[0].trim();
    return this.demoAccessService.issue(ip || 'unknown');
  }
}
