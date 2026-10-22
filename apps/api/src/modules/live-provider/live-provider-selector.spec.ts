/*
 * LiveProvider selection — zoom / google-meet / none.
 *
 * Covers RCCF-LIVE-GMEET-02 + GMEET-04:
 *   - LIVE_PROVIDER=zoom   → ZoomLiveProvider (existing behavior preserved).
 *   - LIVE_PROVIDER unset  → ZoomLiveProvider (backward compatible).
 *   - ZOOM_ENABLED=disabled (no LIVE_PROVIDER) → DisabledLiveProvider (recorded-only).
 *   - LIVE_PROVIDER=none   → DisabledLiveProvider with provider-neutral 503s.
 *   - LIVE_PROVIDER=google-meet + valid Google config → GoogleMeetLiveProvider.
 *   - LIVE_PROVIDER=google-meet without Google config → startup failure
 *     (never silent Zoom fallback; Zoom/recorded-only boots unaffected).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { LIVE_PROVIDER } from './live-provider.types';
import {
  LiveProviderModule,
  selectLiveProvider,
} from './live-provider.module';
import { ZoomLiveProvider } from './zoom-live.provider';
import { DisabledLiveProvider } from './disabled-live.provider';
import { GoogleMeetLiveProvider } from './google-meet-live.provider';

const GOOGLE_ENV = {
  GOOGLE_MEET_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: 'service_account',
    client_email: 'test@proj.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  }),
  GOOGLE_MEET_ORGANIZER_EMAIL: 'teacher@example.com',
  GOOGLE_MEET_CALENDAR_ID: 'primary',
};

function buildModule(env: Record<string, string | undefined>): Promise<TestingModule> {
  // Mirror production: ConfigModule is global (app.module.ts), so the
  // LiveProviderModule factory resolves ConfigService from the global scope.
  // process.env is set explicitly per case (and restored by the caller via
  // afterEach) so selection reads exactly what a deployment would provide.
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), LiveProviderModule],
  }).compile();
}

afterEach(() => {
  delete process.env.LIVE_PROVIDER;
  delete process.env.ZOOM_ENABLED;
  delete process.env.GOOGLE_MEET_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_MEET_ORGANIZER_EMAIL;
  delete process.env.GOOGLE_MEET_CALENDAR_ID;
});

describe('LiveProvider selection (RCCF-LIVE-GMEET-02)', () => {
  describe('selectLiveProvider (pure helper)', () => {
    const deps = {
      zoom: { name: 'zoom' } as ZoomLiveProvider,
      meet: { name: 'google-meet' } as GoogleMeetLiveProvider,
      disabled: { name: 'none' } as DisabledLiveProvider,
    };

    it('zoom → ZoomLiveProvider', () => {
      expect(selectLiveProvider('zoom', deps)).toBe(deps.zoom);
    });

    it('none → DisabledLiveProvider', () => {
      expect(selectLiveProvider('none', deps)).toBe(deps.disabled);
    });

    it('google-meet → GoogleMeetLiveProvider (no silent Zoom fallback)', () => {
      expect(selectLiveProvider('google-meet', deps)).toBe(deps.meet);
    });
  });

  describe('LiveProviderModule wiring', () => {
    it('LIVE_PROVIDER=zoom → ZoomLiveProvider', async () => {
      const mod = await buildModule({ LIVE_PROVIDER: 'zoom' });
      expect(mod.get(LIVE_PROVIDER)).toBeInstanceOf(ZoomLiveProvider);
      await mod.close();
    });

    it('LIVE_PROVIDER unset → ZoomLiveProvider (backward compatible)', async () => {
      const mod = await buildModule({});
      expect(mod.get(LIVE_PROVIDER)).toBeInstanceOf(ZoomLiveProvider);
      await mod.close();
    });

    it('ZOOM_ENABLED=disabled with no LIVE_PROVIDER → DisabledLiveProvider', async () => {
      const mod = await buildModule({ ZOOM_ENABLED: 'disabled' });
      expect(mod.get(LIVE_PROVIDER)).toBeInstanceOf(DisabledLiveProvider);
      await mod.close();
    });

    it('LIVE_PROVIDER=none → DisabledLiveProvider', async () => {
      const mod = await buildModule({ LIVE_PROVIDER: 'none' });
      expect(mod.get(LIVE_PROVIDER)).toBeInstanceOf(DisabledLiveProvider);
      await mod.close();
    });

    it('LIVE_PROVIDER=google-meet without Google config → module fails fast', async () => {
      await expect(buildModule({ LIVE_PROVIDER: 'google-meet' })).rejects.toThrow(
        /GOOGLE_MEET_SERVICE_ACCOUNT_JSON/,
      );
    });

    it('LIVE_PROVIDER=google-meet with valid Google config → GoogleMeetLiveProvider', async () => {
      const mod = await buildModule({ LIVE_PROVIDER: 'google-meet', ...GOOGLE_ENV });
      expect(mod.get(LIVE_PROVIDER)).toBeInstanceOf(GoogleMeetLiveProvider);
      await mod.close();
    });

    it('LIVE_PROVIDER=invalid → module fails fast (unknown provider)', async () => {
      await expect(buildModule({ LIVE_PROVIDER: 'teams' })).rejects.toThrow(
        /LIVE_PROVIDER/,
      );
    });
  });

  describe('DisabledLiveProvider posture', () => {
    it('rejects every operation with a provider-neutral 503', async () => {
      const provider = new DisabledLiveProvider();
      expect(provider.name).toBe('none');

      await expect(
        provider.createWebinar({ topic: 'T', startTime: '2026-12-01T10:00:00.000Z', durationMinutes: 60 }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        provider.createWebinar({ topic: 'T', startTime: '2026-12-01T10:00:00.000Z', durationMinutes: 60 }),
      ).rejects.toThrow(/not enabled/i);
      await expect(provider.deleteWebinar('123')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(
        provider.registerAttendee('123', { name: 'A B', email: 'a@test.com' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not leak Zoom-specific wording', async () => {
      const provider = new DisabledLiveProvider();
      await expect(
        provider.createWebinar({ topic: 'T', startTime: '2026-12-01T10:00:00.000Z', durationMinutes: 60 }),
      ).rejects.toThrow(/^((?!zoom).)*$/i);
    });
  });
});
