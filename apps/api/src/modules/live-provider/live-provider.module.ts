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
 * Selection (RCCF-LIVE-GMEET-04):
 *   - LIVE_PROVIDER=zoom        → ZoomLiveProvider (existing behavior, untouched).
 *   - LIVE_PROVIDER=google-meet → GoogleMeetLiveProvider. Startup validates the
 *                                 deployment's Google config and fails fast with
 *                                 an actionable error when it is missing — Zoom
 *                                 and recorded-only deployments boot with no
 *                                 Google env at all (validation runs only when
 *                                 google-meet is selected).
 *   - LIVE_PROVIDER=none        → DisabledLiveProvider (intentional 503,
 *                                 recorded-only — same posture ZOOM_ENABLED=disabled
 *                                 always produced).
 *   - unset                     → legacy behavior (zoom, or none when
 *                                 ZOOM_ENABLED=disabled).
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LIVE_PROVIDER, type LiveProvider } from './live-provider.types';
import { ZoomLiveProvider } from './zoom-live.provider';
import { DisabledLiveProvider } from './disabled-live.provider';
import { GoogleMeetLiveProvider, googleMeetEnvFrom } from './google-meet-live.provider';
import { validateGoogleMeetConfig } from './google-auth';
import { resolveLiveProvider } from '../../common/constants/live-provider.constant';

/**
 * Pure selection helper (exported for focused unit tests).
 * Startup Google-config validation happens in the useFactory below (only when
 * google-meet is selected), so unconfigured Zoom/recorded-only deployments
 * are unaffected by the mere presence of the Meet provider.
 */
export function selectLiveProvider(
  providerName: 'zoom' | 'google-meet' | 'none',
  deps: {
    zoom: ZoomLiveProvider;
    meet: GoogleMeetLiveProvider;
    disabled: DisabledLiveProvider;
  },
): LiveProvider {
  if (providerName === 'zoom') {
    return deps.zoom;
  }
  if (providerName === 'google-meet') {
    return deps.meet;
  }
  return deps.disabled;
}

@Module({
  providers: [
    ZoomLiveProvider,
    GoogleMeetLiveProvider,
    DisabledLiveProvider,
    {
      provide: LIVE_PROVIDER,
      useFactory: (
        configService: ConfigService,
        zoom: ZoomLiveProvider,
        meet: GoogleMeetLiveProvider,
        disabled: DisabledLiveProvider,
      ): LiveProvider => {
        const providerName = resolveLiveProvider(configService.get<string>('LIVE_PROVIDER'), {
          zoomEnabled: configService.get<string>('ZOOM_ENABLED'),
        });
        if (providerName === 'google-meet') {
          // Fail fast at startup when selected but misconfigured.
          validateGoogleMeetConfig(googleMeetEnvFrom(configService));
        }
        return selectLiveProvider(providerName, { zoom, meet, disabled });
      },
      inject: [ConfigService, ZoomLiveProvider, GoogleMeetLiveProvider, DisabledLiveProvider],
    },
  ],
  exports: [LIVE_PROVIDER, ZoomLiveProvider, GoogleMeetLiveProvider, DisabledLiveProvider],
})
export class LiveProviderModule {}
