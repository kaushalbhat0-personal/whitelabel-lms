import { Module } from '@nestjs/common';
import { TradingSessionsController } from './trading-sessions.controller';
import { TradingSessionsService } from './trading-sessions.service';
import { LiveSessionsModule } from '../live-sessions/live-sessions.module';

@Module({
  imports: [LiveSessionsModule],
  controllers: [TradingSessionsController],
  providers: [TradingSessionsService],
})
export class TradingSessionsModule {}
