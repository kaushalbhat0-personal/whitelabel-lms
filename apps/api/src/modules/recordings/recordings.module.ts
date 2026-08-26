import { Module } from '@nestjs/common';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { MuxModule } from '../mux/mux.module';
import { PlaybackModule } from '../playback/playback.module';
import { VideoProviderModule } from '../video-provider/video-provider.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [MuxModule, PlaybackModule, VideoProviderModule, ObservabilityModule],
  controllers: [RecordingsController],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
