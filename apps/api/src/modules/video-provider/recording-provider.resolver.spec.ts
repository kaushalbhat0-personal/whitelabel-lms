import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecordingProviderResolver } from './recording-provider.resolver';
import { MuxProvider } from './providers/mux.provider';
import { BunnyProvider } from './providers/bunny.provider';

function buildResolver(env: Record<string, string>) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const mux = new MuxProvider({} as any);
  const bunny = new BunnyProvider(config);
  return {
    resolver: new RecordingProviderResolver(config, mux, bunny),
    mux,
    bunny,
  };
}

const FULL_BUNNY_ENV: Record<string, string> = {
  BUNNY_ENABLED: 'true',
  BUNNY_LIBRARY_ID: '133',
  BUNNY_API_KEY: 'key',
  BUNNY_CDN_HOSTNAME: 'vz-x.b-cdn.net',
};

describe('RecordingProviderResolver', () => {
  const B1 = '11111111-1111-4111-8111-111111111111';
  const B2 = '22222222-2222-4222-8222-222222222222';

  describe('resolveUploadProvider — bunny-first production policy (Phase 7E)', () => {
    it('routes EVERY new upload to bunny when Bunny is enabled+configured, regardless of batch', () => {
      const { resolver } = buildResolver(FULL_BUNNY_ENV);
      expect(resolver.resolveUploadProvider([B2])).toBe('bunny');
      expect(resolver.resolveUploadProvider([B1, B2])).toBe('bunny'); // mixed selection is fine now
      expect(resolver.resolveUploadProvider([])).toBe('bunny'); // draft flow too
      expect(resolver.resolveUploadProvider()).toBe('bunny');
    });

    it('is the DEFAULT policy with zero configuration keys present except Bunny itself', () => {
      const { resolver } = buildResolver({ ...FULL_BUNNY_ENV });
      expect(resolver.productionUploadProvider).toBe('bunny');
    });

    it('FAILS VISIBLY (503) when VIDEO_UPLOAD_PROVIDER=bunny but Bunny is disabled — never silently falls back to mux', () => {
      const { resolver } = buildResolver({
        ...FULL_BUNNY_ENV,
        BUNNY_ENABLED: 'false',
      });
      expect(() => resolver.resolveUploadProvider([B2])).toThrow(
        ServiceUnavailableException,
      );
    });

    it('FAILS VISIBLY (503) when Bunny is enabled but incompletely configured', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'true',
        BUNNY_LIBRARY_ID: '133',
        // missing api key + cdn hostname
      });
      expect(() => resolver.resolveUploadProvider([])).toThrow(
        /not enabled\/configured/,
      );
    });

    it('dormant rollback switch: VIDEO_UPLOAD_PROVIDER=mux routes new uploads to Mux without needing Bunny', () => {
      const { resolver } = buildResolver({
        VIDEO_UPLOAD_PROVIDER: 'mux',
        // No Bunny configuration at all — must still resolve to mux.
      });
      expect(resolver.productionUploadProvider).toBe('mux');
      expect(resolver.resolveUploadProvider([B2])).toBe('mux');
      expect(resolver.resolveUploadProvider([])).toBe('mux');
    });

    it('treats unrecognised VIDEO_UPLOAD_PROVIDER values as the safe default (bunny)', () => {
      const { resolver } = buildResolver({
        VIDEO_UPLOAD_PROVIDER: 's3',
        ...FULL_BUNNY_ENV,
      });
      expect(resolver.productionUploadProvider).toBe('bunny');
    });
  });

  describe('providerFor — recording-level routing (unchanged by 7E)', () => {
    it('returns the mux provider for existing/legacy rows', () => {
      const { resolver, mux, bunny } = buildResolver(FULL_BUNNY_ENV);
      expect(resolver.providerFor({ provider: 'mux' })).toBe(mux);
      expect(resolver.providerFor({ provider: null })).toBe(mux);
      expect(resolver.providerFor({})).toBe(mux);
      expect(bunny).toBeDefined();
    });

    it('returns the bunny provider for bunny rows WITHOUT ever falling back to mux', () => {
      const { resolver, bunny, mux } = buildResolver({ BUNNY_ENABLED: 'false' });
      // Even with Bunny disabled globally, an explicit bunny row must route to
      // the bunny provider so its failure is observable (constraint #16).
      expect(resolver.providerFor({ provider: 'bunny' })).toBe(bunny);
      expect(resolver.providerFor({ provider: 'bunny' })).not.toBe(mux);
    });

    it('resolve() treats unknown stored values conservatively as mux', () => {
      const { resolver, mux } = buildResolver({});
      expect(resolver.resolve('weird')).toBe(mux);
      expect(resolver.resolve(undefined)).toBe(mux);
    });
  });
});
