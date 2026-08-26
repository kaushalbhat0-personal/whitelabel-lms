/*
 * VideoProviderModule — provider abstraction wiring for the staged
 * Mux -> Bunny migration (Phase 7B).
 *
 * Consumers import this module (or receive it via AppModule for root jobs):
 *   - RecordingsModule / PlaybackModule: upload routing + playback/deletion routing
 *   - AppModule jobs (recording-upload, recording-cleanup): same via AppModule import
 */
import { Module } from '@nestjs/common';
import { MuxModule } from '../mux/mux.module';
import { MuxProvider } from './providers/mux.provider';
import { BunnyProvider } from './providers/bunny.provider';
import { RecordingProviderResolver } from './recording-provider.resolver';
import { BunnyWebhookController } from './bunny-webhook.controller';

@Module({
  imports: [MuxModule],
  controllers: [BunnyWebhookController],
  providers: [MuxProvider, BunnyProvider, RecordingProviderResolver],
  exports: [MuxProvider, BunnyProvider, RecordingProviderResolver],
})
export class VideoProviderModule {}
