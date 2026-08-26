import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BunnyProvider } from './bunny.provider';

const FULL_ENV = {
  BUNNY_ENABLED: 'true',
  BUNNY_LIBRARY_ID: 'lib-123',
  BUNNY_API_KEY: 'key-abc',
  BUNNY_CDN_HOSTNAME: 'vz-xxxx.b-cdn.net',
};

function build(env: Record<string, string | undefined>) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new BunnyProvider(config);
}

describe('BunnyProvider', () => {
  it('exposes the bunny provider name', () => {
    expect(build(FULL_ENV).name).toBe('bunny');
  });

  describe('configuration gating', () => {
    it('is unconfigured when disabled even with full credentials', () => {
      const provider = build({ ...FULL_ENV, BUNNY_ENABLED: 'false' });
      expect(provider.enabled).toBe(false);
      expect(provider.isConfigured).toBe(false);
    });

    it('is configured only when enabled AND all required credentials exist', () => {
      expect(build(FULL_ENV).isConfigured).toBe(true);
      expect(build({ ...FULL_ENV, BUNNY_LIBRARY_ID: undefined }).isConfigured).toBe(false);
      expect(build({ ...FULL_ENV, BUNNY_API_KEY: undefined }).isConfigured).toBe(false);
      expect(build({ ...FULL_ENV, BUNNY_CDN_HOSTNAME: undefined }).isConfigured).toBe(false);
    });
  });

  describe('operations fail observably (never fake success, never fall back to Mux)', () => {
    it('throws ServiceUnavailable for every operation when unconfigured', async () => {
      const provider = build({});

      await expect(provider.createDirectUpload({ title: 'x' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(
        provider.createAssetFromSource({ sourceUrl: 'https://src', passthrough: {} }),
      ).rejects.toThrow(ServiceUnavailableException);
      await expect(provider.getAssetStatus('a')).rejects.toThrow(ServiceUnavailableException);
      await expect(provider.getPlaybackUrls('p', { sessionId: 's' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(provider.deleteAsset('d')).rejects.toThrow(ServiceUnavailableException);
    });

    it('still refuses operations when configured but the API surface is unverified (B-1/B-2)', async () => {
      const provider = build(FULL_ENV);

      // Deliberate, documented blocker — activation requires the external
      // verification spike. This is NOT a transient error.
      await expect(provider.createDirectUpload({ title: 'x' })).rejects.toThrow(
        /not yet confirmed from repository evidence/,
      );
      await expect(provider.getPlaybackUrls('p', { sessionId: 's' })).rejects.toThrow(
        /not yet confirmed from repository evidence/,
      );
      await expect(provider.deleteAsset('d')).rejects.toThrow(/deliberate and observable/);
    });
  });
});
