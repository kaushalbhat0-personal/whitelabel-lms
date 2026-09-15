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
});
