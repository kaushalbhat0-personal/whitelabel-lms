import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ZoomService } from './zoom.service';

describe('ZoomService (webhook signature)', () => {
  let service: ZoomService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoomService,
        { provide: ConfigService, useValue: { get: jest.fn().mockImplementation((k: string) => (k === 'ZOOM_WEBHOOK_SECRET' ? 'secret-123' : null)) } },
      ],
    }).compile();
    service = module.get(ZoomService);
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a valid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify({ event: 'webinar.ended' });
      const crypto = require('crypto');
      const sig = 'v0=' + crypto.createHmac('sha256', 'secret-123').update(`v0:${timestamp}:${raw}`).digest('hex');
      expect(() => service.verifyWebhookSignature(raw, sig, timestamp)).not.toThrow();
    });

    it('rejects an invalid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      expect(() => service.verifyWebhookSignature('{"x":1}', 'v0=wrong', timestamp)).toThrow(BadRequestException);
    });

    it('rejects an expired timestamp (>5 min old)', () => {
      const oldTs = (Math.floor(Date.now() / 1000) - 400).toString();
      const crypto = require('crypto');
      const raw = '{}';
      const sig = 'v0=' + crypto.createHmac('sha256', 'secret-123').update(`v0:${oldTs}:${raw}`).digest('hex');
      // 400s > 300s window -> reject
      expect(() => service.verifyWebhookSignature(raw, sig, oldTs)).toThrow(BadRequestException);
    });
  });

  describe('validateWebhookChallenge', () => {
    it('returns HMAC of the plain token', () => {
      const crypto = require('crypto');
      const result = service.validateWebhookChallenge('abc');
      const expected = crypto.createHmac('sha256', 'secret-123').update('abc').digest('hex');
      expect(result.encryptedToken).toBe(expected);
      expect(result.plainToken).toBe('abc');
    });
  });

  describe('ZOOM_ENABLED recorded-only guard', () => {
    async function buildService(zoomEnabled: string | undefined) {
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          ZoomService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((k: string) => {
                if (k === 'ZOOM_ENABLED') return zoomEnabled;
                if (k === 'ZOOM_ACCOUNT_ID') return 'acc';
                if (k === 'ZOOM_CLIENT_ID') return 'cid';
                if (k === 'ZOOM_CLIENT_SECRET') return 'csecret';
                return null;
              }),
            },
          },
        ],
      }).compile();
      return mod.get(ZoomService);
    }

    it('ZOOM_ENABLED=false rejects credential issuance with 503', async () => {
      const { ServiceUnavailableException } = await import('@nestjs/common');
      const svc = await buildService('disabled');
      await expect((svc as any).getAccessToken()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('ZOOM_ENABLED unset preserves legacy behavior (no guard trip)', async () => {
      const svc = await buildService(undefined);
      // Creds are present in this mock, so the guard passes; the failure (if
      // any) must come from the network layer, never from the guard.
      // getAccessToken would attempt axios — assert the guard itself passes by
      // calling with creds removed and expecting the legacy credential error.
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          ZoomService,
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
        ],
      }).compile();
      const noCreds = mod.get(ZoomService);
      await expect((noCreds as any).getAccessToken()).rejects.toThrow(/ZOOM_ACCOUNT_ID/);
      expect(svc).toBeDefined();
    });
  });
});
