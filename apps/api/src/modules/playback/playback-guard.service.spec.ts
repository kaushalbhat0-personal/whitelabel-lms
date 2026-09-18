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
    del: jest.fn(async (...keys: string[]) => { keys.forEach(k => redisStore.delete(k)); return keys.length; }),
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

  // ── Phase 28.1 playback revocation semantics ────────────────────
  it('legitimate login -> authorize -> get playback URL succeeds without revoked marker', async () => {
    const ctx = build();
    await ctx.issueToken(base);
    expect(await ctx.redis.get('playback_revoked:user-1')).toBeNull();
    const result = await ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1');
    expect(result.url).toBeTruthy();
    expect(result.thumbnail).toBeTruthy();
  });

  it('stale playback_revoked blocks playback (403 revoked)', async () => {
    const ctx = build();
    await ctx.issueToken(base);
    await ctx.redis.setex('playback_revoked:user-1', 86400, JSON.stringify({ revokedAt: new Date().toISOString() }));
    await expect(
      ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Playback has been revoked/);
    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  it('genuine revokeUserTokens() still blocks playback (explicit security path preserved)', async () => {
    const ctx = build();
    await ctx.issueToken(base);
    await ctx.guard.revokeUserTokens('user-1');
    const revoked = await ctx.redis.get('playback_revoked:user-1');
    expect(revoked).toBeTruthy();
    await expect(
      ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Playback has been revoked/);
  });

  it('after operational DEL of stale playback_revoked, playback succeeds again', async () => {
    const ctx = build();
    await ctx.issueToken(base);
    await ctx.guard.revokeUserTokens('user-1');
    ctx.redisStore.delete('playback_revoked:user-1');
    const result = await ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1');
    expect(result.url).toBe(ctx.muxUrls.url);
  });

  it('playback_revoked check remains the first gate (before token lookup)', async () => {
    const ctx = build();
    await ctx.redis.setex('playback_revoked:user-1', 86400, JSON.stringify({ revokedAt: new Date().toISOString() }));
    await expect(
      ctx.guard.getSignedUrl('missing-token', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Playback has been revoked/);
    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  // ── Phase 28.2 session-bound playback ───────────────────────────
  it('A. authorize stores authSessionId in token payload', async () => {
    const ctx = build();
    const res = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A', undefined, '1.1.1.1');
    expect(res.playbackToken).toBeTruthy();
    const raw = await ctx.redis.get(`playback_token:${res.playbackToken}`);
    expect(raw).toBeTruthy();
    const payload = JSON.parse(raw!);
    expect(payload.authSessionId).toBe('auth-sess-A');
    expect(payload.sessionId).toBeTruthy();
    expect(payload.sessionId).not.toBe('auth-sess-A'); // playback sessionId is separate UUID
  });

  it('B. current session matches authSessionId → getSignedUrl succeeds', async () => {
    const ctx = build();
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-A');
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    const result = await ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1');
    expect(result.url).toBe(ctx.muxUrls.url);
  });

  it('C. session mismatch authSessionId A vs current B → getSignedUrl rejects (session_replaced_token_use)', async () => {
    const ctx = build();
    // authSessionId A stored
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    // but current user_session is B after replacement
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-B');
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Session expired or signed in on another device/);
    expect(ctx.muxProvider.getPlaybackUrls).not.toHaveBeenCalled();
  });

  it('D. session mismatch does NOT refresh playback_token TTL (no SETEX)', async () => {
    const ctx = build();
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-B');
    const before = await ctx.redis.get(`playback_token:${auth.playbackToken}`);
    expect(before).toBeTruthy();
    // capture setex calls after mismatch
    ctx.redis.setex.mockClear();
    await expect(ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1')).rejects.toThrow(UnauthorizedException);
    // setex should NOT have been called for playback_token refresh nor playback_session
    // Filter calls for playback_token
    const playbackTokenSets = (ctx.redis.setex as jest.Mock).mock.calls.filter((c: any[]) => String(c[0]).startsWith('playback_token:'));
    expect(playbackTokenSets.length).toBe(0);
    // token still exists but not refreshed (TTL not extended) — value unchanged
    const after = await ctx.redis.get(`playback_token:${auth.playbackToken}`);
    expect(after).toBe(before);
  });

  it('E. missing user_session rejects even if token authSessionId matches previous', async () => {
    const ctx = build();
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-A');
    // simulate logout: delete user_session
    ctx.redisStore.delete('user_session:user-1');
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Session expired/);
  });

  it('F. legacy token without authSessionId is temporarily accepted (safe rollout)', async () => {
    const ctx = build();
    // legacy base has no authSessionId
    await ctx.issueToken(base);
    // Even with user_session set to anything or missing, legacy should pass (until natural expiry)
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-B');
    const result = await ctx.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1');
    expect(result.url).toBe(ctx.muxUrls.url);
    // Also with no user_session at all
    const ctx2 = build();
    await ctx2.issueToken(base);
    const result2 = await ctx2.guard.getSignedUrl('tok-1', { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1');
    expect(result2.url).toBe(ctx2.muxUrls.url);
  });

  it('G. genuine playback_revoked still blocks before session check', async () => {
    const ctx = build();
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-A');
    await ctx.guard.revokeUserTokens('user-1');
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Playback has been revoked/);
    // revoked takes precedence over session mismatch
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-B');
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'rec-1'),
    ).rejects.toThrow(/Playback has been revoked/);
  });

  it('H. userId mismatch remains blocked even with session bind', async () => {
    const ctx = build();
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-A');
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    await ctx.redis.setex('user_session:attacker', 86400, 'auth-sess-X');
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'attacker', 'rec-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('I. recordingId mismatch remains blocked even with session bind', async () => {
    const ctx = build();
    await ctx.redis.setex('user_session:user-1', 86400, 'auth-sess-A');
    const auth = await ctx.guard.authorize('user-1', 'rec-1', 'auth-sess-A');
    await expect(
      ctx.guard.getSignedUrl(auth.playbackToken, { playbackId: 'pb', provider: 'mux' }, 'user-1', 'other-rec'),
    ).rejects.toThrow(ForbiddenException);
  });
});
