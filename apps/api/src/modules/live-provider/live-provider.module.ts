/*
 * LiveProvider module — binds LIVE_PROVIDER token to ZoomLiveProvider
 *
 * Why this module exists:
 *   - Centralizes the LiveProvider abstraction so LiveSessionsService depends on
 *     LIVE_PROVIDER (interface) rather than ZoomService directly.
 *   - ZoomService remains separately exported for webhook/signature use in ZoomModule;
 *     this module does not replace ZoomModule.
 */

import { Module } from '@nestjs/common';
import { LIVE_PROVIDER } from './live-provider.types';
import { ZoomLiveProvider } from './zoom-live.provider';

@Module({
  providers: [
    ZoomLiveProvider,
    {
      provide: LIVE_PROVIDER,
      useExisting: ZoomLiveProvider,
    },
  ],
  exports: [LIVE_PROVIDER, ZoomLiveProvider],
})
export class LiveProviderModule {}
