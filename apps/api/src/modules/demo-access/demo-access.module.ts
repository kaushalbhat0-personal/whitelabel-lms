import { Module } from '@nestjs/common';
import { DemoAccessController } from './demo-access.controller';
import { DemoAccessService } from './demo-access.service';

@Module({
  controllers: [DemoAccessController],
  providers: [DemoAccessService],
  exports: [DemoAccessService],
})
export class DemoAccessModule {}
