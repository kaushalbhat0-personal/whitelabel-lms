import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PlaybackGuardService } from './playback-guard.service';

function build() {
  const redisStore = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    setex: jest.fn(async (key: string, _ttl: number, value: string) => {
      redisStore.set(key, value);
    }),
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
  };
  const redisService = { getOrThrow: () => redis };

  const supabase = {
    client: {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  };

  const muxUrls = {
    url: 'https://stream.mux.com/pb.m3u8?token=muxjwt',
    expiresAt: '2026-01-01T00:01:00.000Z',
    thumbnailUrl: 'https://image.mux.com/pb/thumbnail.jpg?token=t',
  };
  const bunnyUrls = {
    url: 'https://vz.b-cdn.net/guid/playlist.m3u8?token=bunnyjwt',
    expiresAt: '2026-01-01T04:00:00.000Z',
    thumbnailUrl: 'https://vz.b-cdn.net/guid/thumbnail.jpg?token=bunnyjwt',
  };

  const muxProvider = { name: 'mux', getPlaybackUrls: jest.fn().mockResolvedValue(muxUrls) };
  const bunnyProvider = { name: 'bunny', getPlaybackUrls: jest.fn().mockResolvedValue(bunnyUrls) };
  const resolver = {
    providerFor: jest.fn((target: { provider?: string | null }) =>
      target.provider === 'bunny' ? bunnyProvider : muxProvider,
    ),
  };

  const guard = new PlaybackGuardService(
    redisService as any,
    supabase as any,
    resolver as any,
  );

  async function issueToken(payload: Record<string, unknown>) {
    // Mirror PlaybackGuard.authorize storage shape
    await redis.setex(
      `playback_token:${payload.token}`,
      600,
      JSON.stringify({ ...payload, token: undefined }),
    );
  }

  return { guard, redis, redisStore, supabase, muxProvider, bunnyProvider, resolver, issueToken, muxUrls, bunnyUrls };
}

describe('PlaybackGuardService — provider-aware URL issuance', () => {
  const base = {
    token: 'tok-1',
    userId: 'user-1',
    recordingId: 'rec-1',
    deviceId: null,
    sessionId: 'sess-1',
    ip: '127.0.0.1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  it('routes a legacy/mux recording through the mux provider', async () => {
    const ctx = build();
    await ctx.issueToken(base);

    const result = await ctx.guard.getSignedUrl(
      'tok-1',
      { playbackId: 'pb', provider: 'mux' },
      'user-1',
      'rec-1',
    );

    expect(ctx.resolver.providerFor).toHaveBeenCalledWith({ playbackId: 'pb', provider: 'mux' });
    expect(ctx.muxProvider.getPlaybackUrls).toHaveBeenCalledWith('pb', { sessionId: 'sess-1' });
    expect(result.url).toBe(ctx.muxUrls.url);
    expect(result.thumbnail).toBe(ctx.muxUrls.thumbnailUrl);
  });

  it('treats missing provider (pre-migration row) as mux', async () => {
    const ctx = build();
    await ctx.issueToken(base);

    await ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb' }, 'user-1', 'rec-1');

    expect(ctx.resolver.providerFor).toHaveBeenCalledWith({ playbackId: 'pb' });
    expect(ctx.bunnyProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  it('routes an explicit bunny recording through the bunny provider', async () => {
    const ctx = build();
    await ctx.issueToken(base);

    const result = await ctx.guard.getSignedUrl(
      'tok-1',
      { playbackId: 'guid-1', provider: 'bunny' },
      'user-1',
      'rec-1',
    );

    expect(ctx.resolver.providerFor).toHaveBeenCalledWith({
      playbackId: 'guid-1',
      provider: 'bunny',
    });
    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
    expect(result.url).toBe(ctx.bunnyUrls.url);
  });

  it('propagates provider failure observably instead of falling back to Mux', async () => {
    const ctx = build();
    await ctx.issueToken(base);
    ctx.bunnyProvider.getPlaybackUrls.mockRejectedValueOnce(
      new Error('Bunny provider is not enabled/configured'),
    );

    await expect(
      ctx.guard.getSignedUrl('tok-1', { playbackId: 'g', provider: 'bunny' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Bunny provider is not enabled/);
    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  it('keeps the security envelope: expired/missing token is rejected before any provider call', async () => {
    const ctx = build();

    await expect(
      ctx.guard.getSignedUrl('missing-token', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(UnauthorizedException);
    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  it('keeps the security envelope: token bound to another user/recording is rejected', async () => {
    const ctx = build();
    await ctx.issueToken(base);

    await expect(
      ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'attacker', 'rec-1'),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'other-rec'),
    ).rejects.toThrow(ForbiddenException);

    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  it('still writes access logs and view rows for authorized playback', async () => {
    const ctx = build();
    await ctx.issueToken(base);

    await ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1');

    expect(ctx.supabase.client.from).toHaveBeenCalledWith('video_views');
    expect(ctx.supabase.client.from).toHaveBeenCalledWith('video_access_logs');
  });
});
