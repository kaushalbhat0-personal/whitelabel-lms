/*
 * LiveProvider module — binds the LIVE_PROVIDER token via deployment config.
 *
 * Why this module exists:
 *   - Centralizes the LiveProvider abstraction so LiveSessionsService depends on
 *     LIVE_PROVIDER (interface) rather than ZoomService directly.
 *   - ZoomService remains separately exported for webhook/signature use in ZoomModule;
 *     this module does not replace ZoomModule.
 *   - Selection is deployment-scoped (LIVE_PROVIDER env, with ZOOM_ENABLED
 *     backward compatibility) — no tenant IDs, no per-client branches.
 *
 * Selection (RCCF-LIVE-GMEET-02):
 *   - LIVE_PROVIDER=zoom        → ZoomLiveProvider (existing behavior, untouched).
 *   - LIVE_PROVIDER=none        → DisabledLiveProvider (intentional 503,
 *                                 recorded-only — same posture ZOOM_ENABLED=disabled
 *                                 always produced).
 *   - LIVE_PROVIDER=google-meet → not installed yet: fail fast with a clear
 *                                 error instead of silently using Zoom.
 *   - unset                     → legacy behavior (zoom, or none when
 *                                 ZOOM_ENABLED=disabled).
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LIVE_PROVIDER, type LiveProvider } from './live-provider.types';
import { ZoomLiveProvider } from './zoom-live.provider';
import { DisabledLiveProvider } from './disabled-live.provider';
import { resolveLiveProvider } from '../../common/constants/live-provider.constant';

/**
 * Pure selection helper (exported for focused unit tests).
 * Throws for 'google-meet' until the adapter phase lands — callers (the
 * useFactory below) run at Nest DI init, so misconfiguration fails fast at
 * startup instead of silently serving Zoom.
 */
export function selectLiveProvider(
  providerName: 'zoom' | 'google-meet' | 'none',
  deps: { zoom: ZoomLiveProvider; disabled: DisabledLiveProvider },
): LiveProvider {
  if (providerName === 'zoom') {
    return deps.zoom;
  }
  if (providerName === 'none') {
    return deps.disabled;
  }
  throw new Error(
    'Live provider "google-meet" is not installed yet (roadmap: RCCF-LIVE-GMEET-04). ' +
      'Use LIVE_PROVIDER=zoom or LIVE_PROVIDER=none until the Google Meet adapter phase lands.',
  );
}

@Module({
  providers: [
    ZoomLiveProvider,
    DisabledLiveProvider,
    {
      provide: LIVE_PROVIDER,
      useFactory: (
        configService: ConfigService,
        zoom: ZoomLiveProvider,
        disabled: DisabledLiveProvider,
      ): LiveProvider =>
        selectLiveProvider(
          resolveLiveProvider(configService.get<string>('LIVE_PROVIDER'), {
            zoomEnabled: configService.get<string>('ZOOM_ENABLED'),
          }),
          { zoom, disabled },
        ),
      inject: [ConfigService, ZoomLiveProvider, DisabledLiveProvider],
    },
  ],
  exports: [LIVE_PROVIDER, ZoomLiveProvider, DisabledLiveProvider],
})
export class LiveProviderModule {}
