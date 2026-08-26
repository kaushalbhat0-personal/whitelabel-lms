import { Module } from '@nestjs/common';
import { PlaybackGuardService } from './playback-guard.service';
import { PlaybackController } from './playback.controller';
import { MuxModule } from '../mux/mux.module';
import { VideoProviderModule } from '../video-provider/video-provider.module';

@Module({
  imports: [MuxModule, VideoProviderModule],
  controllers: [PlaybackController],
  providers: [PlaybackGuardService],
  exports: [PlaybackGuardService],
})
export class PlaybackModule {}
