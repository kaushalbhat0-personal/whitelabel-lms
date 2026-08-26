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

describe('RecordingProviderResolver', () => {
  const B1 = '11111111-1111-4111-8111-111111111111';
  const B2 = '22222222-2222-4222-8222-222222222222';

  describe('resolveUploadProvider — Batch routing policy', () => {
    it('routes to mux when Bunny is disabled (default production state)', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'false',
        VIDEO_BUNNY_BATCH_IDS: B2,
      });
      expect(resolver.resolveUploadProvider([B2])).toBe('mux');
    });

    it('routes to mux when Bunny is enabled but no batches are configured', () => {
      const { resolver } = buildResolver({ BUNNY_ENABLED: 'true' });
      expect(resolver.resolveUploadProvider([B2])).toBe('mux');
    });

    it('routes to bunny only for uploads whose EVERY batch is bunny-listed', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'true',
        VIDEO_BUNNY_BATCH_IDS: `${B2}`,
      });
      expect(resolver.resolveUploadProvider([B2])).toBe('bunny');
      expect(resolver.resolveUploadProvider([B2, B2])).toBe('bunny');
    });

    it('routes mixed legacy+bunny batch selections to mux (single shared asset rule)', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'true',
        VIDEO_BUNNY_BATCH_IDS: `${B2}`,
      });
      expect(resolver.resolveUploadProvider([B1, B2])).toBe('mux');
    });

    it('routes unknown/unlisted batches to mux (safe failure, never guessed)', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'true',
        VIDEO_BUNNY_BATCH_IDS: `${B2}`,
      });
      expect(resolver.resolveUploadProvider(['99999999-9999-4999-8999-999999999999'])).toBe('mux');
    });

    it('routes empty batch sets (draft flow) to mux', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'true',
        VIDEO_BUNNY_BATCH_IDS: `${B2}`,
      });
      expect(resolver.resolveUploadProvider([])).toBe('mux');
      expect(resolver.resolveUploadProvider()).toBe('mux');
    });

    it('ignores whitespace in the configured batch list', () => {
      const { resolver } = buildResolver({
        BUNNY_ENABLED: 'true',
        VIDEO_BUNNY_BATCH_IDS: ` ${B2} , `,
      });
      expect(resolver.resolveUploadProvider([B2])).toBe('bunny');
    });
  });

  describe('providerFor — recording-level routing', () => {
    it('returns the mux provider for existing/legacy rows', () => {
      const { resolver, mux, bunny } = buildResolver({ BUNNY_ENABLED: 'true' });
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
