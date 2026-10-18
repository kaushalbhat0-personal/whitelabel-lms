import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  private healthPayload() {
    return {
      status: 'ok',
      service: 'lms-api',
      version: 'current',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get()
  root() {
    return this.healthPayload();
  }

  @Public()
  @Get('health')
  health() {
    return this.healthPayload();
  }
}
