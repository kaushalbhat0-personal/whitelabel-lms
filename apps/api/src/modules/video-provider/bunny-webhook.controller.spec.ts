/*
 * Phase 7C security suite for the Bunny webhook receiver.
 * Covers: signature enforcement, replay/tamper rejection, canonical lifecycle
 * mapping, and the hard RCCF guarantee that a Bunny event can NEVER mutate a
 * Mux recording (provider-scoped row resolution).
 */
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BunnyWebhookController } from './bunny-webhook.controller';
import { BunnyProvider } from './providers/bunny.provider';
import { SupabaseService } from '../../common/services/supabase.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';

// Never allow real network traffic from unit tests.
jest.mock('axios', () => {
  const httpMock = { post: jest.fn(), get: jest.fn(), delete: jest.fn() };
  return {
    __esModule: true,
    default: { ...(jest.requireActual('axios') as object), create: jest.fn(() => httpMock) },
  };
});

const SECRET = 'read-only-api-key-secret';

function buildProvider(): BunnyProvider {
  const env: Record<string, string> = {
    BUNNY_ENABLED: 'true',
    BUNNY_LIBRARY_ID: '133',
    BUNNY_API_KEY: 'write-key',
    BUNNY_CDN_HOSTNAME: 'vz-x.b-cdn.net',
    BUNNY_TOKEN_SIGNING_KEY: 'token-key',
    BUNNY_WEBHOOK_SECRET: SECRET,
  };
  return new BunnyProvider({ get: (k: string) => env[k] } as unknown as ConfigService);
}

function sign(payload: Buffer | string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function payload(status: number, guid = 'guid-bunny-1', libraryId = 133): string {
  return JSON.stringify({ VideoLibraryId: libraryId, VideoGuid: guid, Status: status });
}

function signedRequest(body: string) {
  return {
    rawBody: Buffer.from(body),
    headers: {
      'x-bunnystream-signature-version': 'v1',
      'x-bunnystream-signature-algorithm': 'hmac-sha256',
      'x-bunnystream-signature': sign(Buffer.from(body)),
    },
  } as any;
}

function mockSupabase(existingRecording: any) {
  const captured: { updateArgs?: any; eqArgs: any[][] } = { eqArgs: [] };
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn((...args: any[]) => {
    captured.eqArgs.push(args);
    return chain;
  });
  chain.or = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: existingRecording, error: null });
  chain.update = jest.fn((args: any) => {
    captured.updateArgs = args;
    return chain;
  });
  const supabase = {
    client: { from: jest.fn(() => chain) },
  };
  return { supabase, chain, captured };
}

const redisCache = { invalidateRecordingsCache: jest.fn().mockResolvedValue(undefined) };

function buildController(opts: {
  provider?: BunnyProvider;
  supabase: any;
  env?: Record<string, string>;
}) {
  const env: Record<string, string | undefined> = { BUNNY_LIBRARY_ID: '133', ...(opts.env ?? {}) };
  return new BunnyWebhookController(
    opts.provider ?? buildProvider(),
    opts.supabase as unknown as SupabaseService,
    redisCache as unknown as RedisCacheService,
    { get: (k: string) => env[k] } as unknown as ConfigService,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BunnyWebhookController', () => {
  it('applies Status=3 (Finished) to the bunny recording row only', async () => {
    const { supabase, captured } = mockSupabase({ id: 'rec-1', status: 'processing', mux_playback_id: null });
    const controller = buildController({ supabase });

    const res = await controller.handleWebhook(signedRequest(payload(3)));

    expect(res).toEqual({ message: 'ok' });
    // Provider-scoped lookup is mandatory.
    expect(captured.eqArgs).toContainEqual(['provider', 'bunny']);
    expect(captured.updateArgs.status).toBe('ready');
    expect(captured.updateArgs.mux_asset_id).toBe('guid-bunny-1');
    expect(captured.updateArgs.mux_playback_id).toBe('guid-bunny-1'); // playback id == video GUID
    expect(redisCache.invalidateRecordingsCache).toHaveBeenCalled();
  });

  it('backfills duration best-effort on ready without failing the webhook', async () => {
    const { supabase, captured } = mockSupabase({ id: 'rec-1', status: 'processing', mux_playback_id: null });
    const provider = buildProvider();
    jest.spyOn(provider, 'getAssetStatus').mockRejectedValue(new Error('api down'));
    const controller = buildController({ provider, supabase });

    await controller.handleWebhook(signedRequest(payload(4)));

    expect(captured.updateArgs.status).toBe('ready');
    expect(captured.updateArgs.duration_seconds).toBeUndefined();
  });

  it('applies Status=5 (Failed) to the bunny recording row', async () => {
    const { supabase, captured } = mockSupabase({ id: 'rec-2', status: 'processing' });
    const controller = buildController({ supabase });

    await controller.handleWebhook(signedRequest(payload(5)));

    expect(captured.updateArgs.status).toBe('failed');
    expect(redisCache.invalidateRecordingsCache).toHaveBeenCalled();
  });

  it('ignores intermediate statuses without mutating anything', async () => {
    const { supabase, captured } = mockSupabase(null);
    const controller = buildController({ supabase });

    await controller.handleWebhook(signedRequest(payload(2)));

    expect(captured.updateArgs).toBeUndefined();
  });

  describe('signature enforcement (no unsigned production webhooks)', () => {
    it.each([
      ['missing signature header', (body: string) => ({ rawBody: Buffer.from(body), headers: {} })],
      [
        'tampered body',
        (body: string) => {
          const req = signedRequest(body) as any;
          req.rawBody = Buffer.from(payload(3, 'DIFFERENT-guid'));
          return req;
        },
      ],
      [
        'wrong secret',
        (body: string) => ({
          rawBody: Buffer.from(body),
          headers: {
            'x-bunnystream-signature-version': 'v1',
            'x-bunnystream-signature-algorithm': 'hmac-sha256',
            'x-bunnystream-signature': crypto.createHmac('sha256', 'other').update(body).digest('hex'),
          },
        }),
      ],
      [
        'unsupported version',
        (body: string) => {
          const req = signedRequest(body) as any;
          req.headers['x-bunnystream-signature-version'] = 'v2';
          return req;
        },
      ],
      [
        'unsupported algorithm',
        (body: string) => {
          const req = signedRequest(body) as any;
          req.headers['x-bunnystream-signature-algorithm'] = 'md5';
          return req;
        },
      ],
    ])('rejects with 401 and zero mutations: %s', async (_name, makeReq) => {
      const { supabase, captured } = mockSupabase(null);
      const controller = buildController({ supabase });

      await expect(controller.handleWebhook(makeReq(payload(3)))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(captured.updateArgs).toBeUndefined();
    });

    it('rejects oversized payloads before parsing', async () => {
      const { supabase, captured } = mockSupabase(null);
      const controller = buildController({ supabase });
      const huge = 'x'.repeat(65 * 1024);

      await expect(controller.handleWebhook(signedRequest(huge))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(captured.updateArgs).toBeUndefined();
    });
  });

  describe('cross-provider isolation (RCCF hard guarantees)', () => {
    it('never mutates a MUX recording even when asset ids collide', async () => {
      // The bunny-scoped query finds nothing because the colliding row has
      // provider='mux' — assert no update was issued at all.
      const { supabase, captured } = mockSupabase(null);
      const controller = buildController({ supabase });

      await controller.handleWebhook(signedRequest(payload(3, 'shared-asset-id')));

      expect(captured.eqArgs).toContainEqual(['provider', 'bunny']);
      expect(captured.updateArgs).toBeUndefined();
    });

    it('ignores events originating from a foreign Bunny library', async () => {
      const { supabase, captured } = mockSupabase({ id: 'rec-x', status: 'processing' });
      const controller = buildController({ supabase });

      await controller.handleWebhook(signedRequest(payload(3, 'guid-bunny-1', 999999)));

      expect(captured.updateArgs).toBeUndefined();
    });
  });

  it('links unlinked direct uploads via mux_upload_id when mux_asset_id is null', async () => {
    const { supabase, captured, chain } = mockSupabase({
      id: 'rec-3',
      status: 'processing',
      mux_playback_id: 'already-set',
    });
    const controller = buildController({ supabase });

    await controller.handleWebhook(signedRequest(payload(3, 'tus-guid')));

    // or() filter must cover both storage slots.
    expect(chain.or).toHaveBeenCalledWith(
      'mux_asset_id.eq.tus-guid,and(mux_asset_id.is.null,mux_upload_id.eq.tus-guid)',
    );
    expect(captured.updateArgs.mux_playback_id).toBeUndefined(); // not overwritten
    expect(captured.updateArgs.mux_asset_id).toBe('tus-guid'); // linkage established
  });

  it('responds ok but mutates nothing when rawBody is absent', async () => {
    const { supabase, captured } = mockSupabase(null);
    const controller = buildController({ supabase });

    const res = await controller.handleWebhook({ rawBody: undefined, headers: {} } as any);

    expect(res).toEqual({ message: 'ok' });
    expect(captured.updateArgs).toBeUndefined();
  });

  it('Phase 7E: accepts a validly-signed MALFORMED (non-JSON) body without mutating anything', async () => {
    // Signature is computed over the exact raw bytes, so a signed-but-garbage
    // body passes verification and must then be discarded by the JSON guard.
    const garbage = '{{{not-json}}}';
    const { supabase, captured } = mockSupabase(null);
    const controller = buildController({ supabase });

    const res = await controller.handleWebhook(signedRequest(garbage));

    expect(res).toEqual({ message: 'ok' });
    expect(captured.updateArgs).toBeUndefined();
  });

  it('Phase 7E: repeated (replayed/redispatched) ready events are safe — outcome stays ready, linkage preserved', async () => {
    const { supabase, captured } = mockSupabase({
      id: 'rec-1',
      status: 'ready',
      mux_playback_id: 'guid-bunny-1',
    });
    const controller = buildController({ supabase });

    const first = await controller.handleWebhook(signedRequest(payload(3)));
    const second = await controller.handleWebhook(signedRequest(payload(3)));

    expect(first).toEqual({ message: 'ok' });
    expect(second).toEqual({ message: 'ok' });
    // Re-application is monotonic/idempotent in OUTCOME: still ready.
    expect(captured.updateArgs.status).toBe('ready');
    expect(captured.updateArgs.mux_playback_id).toBeUndefined(); // never overwritten
  });
});
