import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailWebhookService } from './email-webhook.service';
import { EmailTemplatesService } from './email-templates.service';

/**
 * Resend webhook fail-closed contract (ISOLATION-02, Step 4 + Step 11).
 * - valid signature → accepted
 * - invalid signature → 401, handler NOT called
 * - missing secret → 401 (fail closed), handler NOT called
 * - malformed request (missing headers) → 401
 */
describe('EmailController.handleResendWebhook', () => {
  const SECRET_B64 = Buffer.from('test-webhook-secret-32bytes!!').toString('base64');
  let controller: EmailController;
  let configGet: jest.Mock;
  let handleSpy: jest.Mock;

  function sign(id: string, ts: string, body: unknown): string {
    const raw = JSON.stringify(body);
    return (
      'v1,' +
      createHmac('sha256', Buffer.from(SECRET_B64, 'base64'))
        .update(`${id}.${ts}.${raw}`)
        .digest('base64')
    );
  }

  async function build(secret: string | undefined) {
    configGet = jest.fn((key: string) => (key === 'RESEND_WEBHOOK_SECRET' ? secret : undefined));
    handleSpy = jest.fn().mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        { provide: EmailService, useValue: {} },
        { provide: EmailWebhookService, useValue: { handleResendWebhook: handleSpy } },
        { provide: EmailTemplatesService, useValue: {} },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    controller = module.get(EmailController);
    jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((controller as any).logger, 'error').mockImplementation(() => {});
  }

  it('accepts a valid signature', async () => {
    await build('whsec_' + SECRET_B64);
    const payload = { type: 'email.delivered', data: { email_id: '1' } };
    const id = 'msg_123';
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await controller.handleResendWebhook(
      {} as any,
      payload,
      id,
      ts,
      sign(id, ts, payload),
    );
    expect(res).toEqual({ received: true });
    expect(handleSpy).toHaveBeenCalledWith(payload);
  });

  it('rejects an invalid signature without invoking the handler', async () => {
    await build('whsec_' + SECRET_B64);
    const payload = { type: 'email.delivered' };
    await expect(
      controller.handleResendWebhook({} as any, payload, 'msg_1', String(Math.floor(Date.now() / 1000)), 'v1,bm90LXJlYWw='),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('rejects when the webhook secret is missing (fail closed)', async () => {
    await build(undefined);
    const payload = { type: 'email.delivered' };
    await expect(
      controller.handleResendWebhook({} as any, payload, 'msg_1', String(Math.floor(Date.now() / 1000)), 'v1,abcd'),
    ).rejects.toThrow('Webhook verification is not configured');
    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed requests missing signature headers', async () => {
    await build('whsec_' + SECRET_B64);
    await expect(controller.handleResendWebhook({} as any, { type: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(handleSpy).not.toHaveBeenCalled();
  });
});
