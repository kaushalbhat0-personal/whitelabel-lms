import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { BunnyProvider } from './bunny.provider';

jest.mock('axios', () => {
  const httpMock = {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  };
  return {
    __esModule: true,
    default: { ...(jest.requireActual('axios') as object), create: jest.fn(() => httpMock) },
  };
});

const http = (axios.create as jest.Mock)();

const FULL_ENV: Record<string, string> = {
  BUNNY_ENABLED: 'true',
  BUNNY_LIBRARY_ID: '1234',
  BUNNY_API_KEY: 'key-abc',
  BUNNY_CDN_HOSTNAME: 'vz-xxxx.b-cdn.net',
  BUNNY_TOKEN_SIGNING_KEY: 'token-secret',
  BUNNY_WEBHOOK_SECRET: 'webhook-secret',
};

function build(env: Record<string, string | undefined> = FULL_ENV): BunnyProvider {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new BunnyProvider(config);
}

/** Independent re-implementation of Bunny's documented signing math used to
 *  pin the provider's output (guards against regressions in ordering). */
function expectedToken(securityKey: string, signaturePath: string, expires: string, signingData: string): string {
  const digest = crypto
    .createHmac('sha256', securityKey)
    .update(signaturePath)
    .update(expires)
    .update(signingData)
    .digest();
  return (
    'HS256-' +
    digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  http.post.mockReset();
  http.get.mockReset();
  http.delete.mockReset();
});

describe('BunnyProvider', () => {
  it('exposes the bunny provider name', () => {
    expect(build().name).toBe('bunny');
  });

  describe('configuration gating', () => {
    it('is unconfigured when disabled even with full credentials', () => {
      const provider = build({ ...FULL_ENV, BUNNY_ENABLED: 'false' });
      expect(provider.enabled).toBe(false);
      expect(provider.isConfigured).toBe(false);
    });

    it('is configured only when enabled AND all required credentials exist', () => {
      expect(build().isConfigured).toBe(true);
      expect(build({ ...FULL_ENV, BUNNY_LIBRARY_ID: undefined }).isConfigured).toBe(false);
      expect(build({ ...FULL_ENV, BUNNY_API_KEY: undefined }).isConfigured).toBe(false);
      expect(build({ ...FULL_ENV, BUNNY_CDN_HOSTNAME: undefined }).isConfigured).toBe(false);
    });
  });

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
    // No network calls were attempted.
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  describe('createDirectUpload — verified TUS presigned flow', () => {
    it('creates the video object and returns scoped TUS credentials (never the API key)', async () => {
      http.post.mockResolvedValueOnce({ data: { guid: 'video-guid-1', title: 'Lesson' } });

      const handle = await build().createDirectUpload({ title: 'Lesson' });

      expect(http.post).toHaveBeenCalledWith('/library/1234/videos', { title: 'Lesson' });
      expect(handle.uploadUrl).toBe('https://video.bunnycdn.com/tusupload');
      expect(handle.uploadId).toBe('video-guid-1');
      expect(handle.uploadKind).toBe('tus');

      const headers = handle.uploadHeaders!;
      expect(headers.LibraryId).toBe('1234');
      expect(headers.VideoId).toBe('video-guid-1');

      const expire = Number(headers.AuthorizationExpire);
      expect(expire).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3600); // official minimum

      // SHA256(libraryId + apiKey + expirationTime + videoId) — official formula.
      const expectedSig = crypto
        .createHash('sha256')
        .update(`1234${FULL_ENV.BUNNY_API_KEY}${expire}video-guid-1`)
        .digest('hex');
      expect(headers.AuthorizationSignature).toBe(expectedSig);

      // The raw API key must never appear anywhere in the browser-facing handle.
      expect(JSON.stringify(handle)).not.toContain(FULL_ENV.BUNNY_API_KEY);
    });

    it('fails observably when Bunny returns no guid', async () => {
      http.post.mockResolvedValueOnce({ data: {} });
      await expect(build().createDirectUpload({ title: 'x' })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('createAssetFromSource — verified fetch endpoint', () => {
    it('POSTs the source URL to /videos/fetch', async () => {
      http.post.mockResolvedValueOnce({ data: { guid: 'fetch-guid-9' } });

      const result = await build().createAssetFromSource({
        sourceUrl: 'https://zoom.us/rec/download?access_token=tok',
        passthrough: { sessionId: 'sess-1', title: 'Zoom Recording' },
      });

      expect(http.post).toHaveBeenCalledWith('/library/1234/videos/fetch', {
        url: 'https://zoom.us/rec/download?access_token=tok',
        title: 'Zoom Recording',
      });
      expect(result.assetId).toBe('fetch-guid-9');
    });

    it('Phase 7E LIVE finding: fetch answers ApiResult.id (not VideoModel.guid) — both accepted', async () => {
      // Live-verified response shape: {"id":"...","success":true,"message":"OK"}
      http.post.mockResolvedValueOnce({ data: { id: 'apiresult-id-1', success: true, message: 'OK' } });

      const result = await build().createAssetFromSource({
        sourceUrl: 'https://example.com/video.mp4',
        passthrough: { title: 'X' },
      });

      expect(result.assetId).toBe('apiresult-id-1');
    });
  });

  describe('getAssetStatus — official VideoModelStatus enum mapping', () => {
    it.each([
      [0, 'processing'], // Created
      [1, 'processing'], // Uploaded
      [2, 'processing'], // Processing
      [3, 'processing'], // Transcoding
      [4, 'ready'], // Finished
      [5, 'failed'], // Error
      [6, 'failed'], // UploadFailed
      [7, 'processing'], // JitSegmenting
      [8, 'processing'], // JitPlaylistsCreated
      [99, 'processing'], // unknown -> conservative
      [undefined, 'processing'],
    ])('maps status %s -> %s', async (raw, expected) => {
      http.get.mockResolvedValueOnce({
        data: { guid: 'guid-x', status: raw, length: 0 },
      });
      const status = await build().getAssetStatus('guid-x');
      expect(status.status).toBe(expected);
      expect(status.playbackId).toBe('guid-x');
    });

    it('surfaces duration when length is positive', async () => {
      http.get.mockResolvedValueOnce({ data: { guid: 'g', status: 4, length: 61 } });
      const status = await build().getAssetStatus('g');
      expect(status.durationSeconds).toBe(61);
    });
  });

  describe('deleteAsset', () => {
    it('deletes via the verified endpoint', async () => {
      http.delete.mockResolvedValueOnce({ data: {} });
      await build().deleteAsset('guid-del');
      expect(http.delete).toHaveBeenCalledWith('/library/1234/videos/guid-del');
    });

    it('tolerates already-deleted videos (404)', async () => {
      http.delete.mockRejectedValueOnce({ response: { status: 404 } });
      await expect(build().deleteAsset('gone')).resolves.toBeUndefined();
    });

    it('rethrows non-404 failures observably', async () => {
      http.delete.mockRejectedValueOnce(new Error('network down'));
      await expect(build().deleteAsset('x')).rejects.toThrow('network down');
    });
  });

  describe('getPlaybackUrls — path-based directory tokens for HLS', () => {
    it('requires BUNNY_TOKEN_SIGNING_KEY', async () => {
      const provider = build({ ...FULL_ENV, BUNNY_TOKEN_SIGNING_KEY: undefined });
      await expect(provider.getPlaybackUrls('pb', { sessionId: 's' })).rejects.toThrow(
        /BUNNY_TOKEN_SIGNING_KEY/,
      );
    });

    it('signs the manifest with a directory token scoped to the video GUID', async () => {
      const urls = await build().getPlaybackUrls('pb-guid', { sessionId: 'sess' });

      const match = /^https:\/\/vz-xxxx\.b-cdn\.net\/bcdn_token=(HS256-[A-Za-z0-9_-]+)&token_path=%2Fpb-guid%2F&expires=(\d+)\/pb-guid\/playlist\.m3u8$/.exec(
        urls.url,
      );
      expect(match).not.toBeNull();

      const [, token, expires] = match!;
      // Independent recomputation per official algorithm:
      // hmacMessage = tokenPath + expires + signingData(token_path=/pb-guid/)
      const expected = expectedToken(FULL_ENV.BUNNY_TOKEN_SIGNING_KEY, '/pb-guid/', expires, 'token_path=/pb-guid/');
      expect(token).toBe(expected);

      const ttlSeconds = Number(expires) - Math.floor(Date.now() / 1000);
      expect(ttlSeconds).toBeGreaterThanOrEqual(14400 - 5);
      expect(ttlSeconds).toBeLessThanOrEqual(14400 + 5);
      expect(urls.expiresAt).toBe(new Date(Number(expires) * 1000).toISOString());
    });

    it('returns a query-string signed thumbnail on thumbnail.jpg', async () => {
      const urls = await build().getPlaybackUrls('pb-guid', { sessionId: 'sess' });

      const match = /^https:\/\/vz-xxxx\.b-cdn\.net\/pb-guid\/thumbnail\.jpg\?token=(HS256-[A-Za-z0-9_-]+)&expires=(\d+)$/.exec(
        urls.thumbnailUrl,
      );
      expect(match).not.toBeNull();
      const [, token, expires] = match!;
      // Exact-path token: signaturePath is the file path itself (no token_path).
      const expected = expectedToken(FULL_ENV.BUNNY_TOKEN_SIGNING_KEY, '/pb-guid/thumbnail.jpg', expires, '');
      expect(token).toBe(expected);
    });

    it('honours a configured CDN token TTL', async () => {
      const provider = build({ ...FULL_ENV, BUNNY_CDN_TOKEN_TTL_SECONDS: '7200' });
      const urls = await provider.getPlaybackUrls('pb', { sessionId: 's' });
      const expires = Number(/expires=(\d+)\//.exec(urls.url)![1]);
      const ttl = expires - Math.floor(Date.now() / 1000);
      expect(ttl).toBeGreaterThanOrEqual(7200 - 5);
      expect(ttl).toBeLessThanOrEqual(7200 + 5);
    });
  });

  describe('webhookStatusToCanonical — docs/stream/webhooks catalogue', () => {
    it('maps terminal and intermediate webhook statuses', () => {
      const provider = build();
      expect(provider.webhookStatusToCanonical(3)).toBe('ready'); // Finished
      expect(provider.webhookStatusToCanonical(4)).toBe('ready'); // Resolution finished
      expect(provider.webhookStatusToCanonical(5)).toBe('failed'); // Failed
      expect(provider.webhookStatusToCanonical(0)).toBe('processing'); // Queued
      expect(provider.webhookStatusToCanonical(2)).toBe('processing'); // Encoding
      expect(provider.webhookStatusToCanonical(9)).toBe('processing'); // CaptionsGenerated
    });
  });

  describe('verifyWebhookSignature — v1 HMAC-SHA256 hex scheme', () => {
    const body = Buffer.from(JSON.stringify({ VideoLibraryId: 133, VideoGuid: 'g-1', Status: 3 }));

    function sigFor(secret: string, payload: Buffer): string {
      return crypto.createHmac('sha256', secret).update(payload).digest('hex');
    }

    function headers(signature: string) {
      return { version: 'v1', algorithm: 'hmac-sha256', signature };
    }

    it('accepts a valid lowercase-hex signature of the exact raw body', () => {
      expect(build().verifyWebhookSignature(body, headers(sigFor('webhook-secret', body)))).toBe(true);
    });

    it('accepts a Buffer or string body identically', () => {
      const provider = build();
      const sig = sigFor('webhook-secret', body);
      expect(provider.verifyWebhookSignature(body.toString('utf8'), headers(sig))).toBe(true);
    });

    it('rejects tampered bodies', () => {
      const tampered = Buffer.from(body.toString('utf8').replace('3', '4'));
      expect(build().verifyWebhookSignature(tampered, headers(sigFor('webhook-secret', body)))).toBe(false);
    });

    it('rejects wrong secrets, uppercase hex, non-hex, short signatures', () => {
      const provider = build();
      expect(provider.verifyWebhookSignature(body, headers(sigFor('wrong-secret', body)))).toBe(false);
      expect(provider.verifyWebhookSignature(body, headers(sigFor('webhook-secret', body).toUpperCase()))).toBe(false);
      expect(provider.verifyWebhookSignature(body, headers('not-hex!'))).toBe(false);
      expect(provider.verifyWebhookSignature(body, headers('abc123'))).toBe(false);
    });

    it('rejects missing version/algorithm headers', () => {
      const provider = build();
      const sig = sigFor('webhook-secret', body);
      expect(provider.verifyWebhookSignature(body, { ...headers(sig), version: 'v2' })).toBe(false);
      expect(provider.verifyWebhookSignature(body, { ...headers(sig), algorithm: 'md5' })).toBe(false);
      expect(
        provider.verifyWebhookSignature(body, {
          algorithm: 'hmac-sha256',
          signature: sig,
          version: undefined,
        }),
      ).toBe(false);
    });

    it('never trusts anything when BUNNY_WEBHOOK_SECRET is unset', () => {
      const provider = build({ ...FULL_ENV, BUNNY_WEBHOOK_SECRET: undefined });
      expect(provider.verifyWebhookSignature(body, headers(sigFor('', body)))).toBe(false);
    });
  });
});
