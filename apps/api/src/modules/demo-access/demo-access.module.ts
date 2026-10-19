import { Module } from '@nestjs/common';
import { DemoAccessController } from './demo-access.controller';
import { DemoAccessService } from './demo-access.service';
import { DemoAccessCleanupService } from './demo-access-cleanup.service';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [AuthModule, ObservabilityModule],
  controllers: [DemoAccessController],
  providers: [DemoAccessService, DemoAccessCleanupService],
  exports: [DemoAccessService],
})
export class DemoAccessModule {}
