/*
 * Bunny webhook receiver — OBSERVATION MODE ONLY.
 *
 * PHASE 7B STATUS: NOT OPERATIONAL (audit blocker B-3).
 *   - Bunny's webhook catalogue and signature scheme are not confirmed from
 *     repository evidence, so this endpoint performs ZERO database mutations.
 *   - It exists so the routing path is live and events become observable in
 *     logs as soon as Bunny is pointed at it, and so activation is a
 *     code-only change inside one file later.
 *   - Signature verification is deliberately absent until the scheme is
 *     confirmed; therefore no trust is placed in the payload. Payload size is
 *     capped before parsing to limit unauthenticated abuse.
 */
import { Controller, Post, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';

const MAX_INSPECT_BYTES = 64 * 1024;

@Controller('bunny')
export class BunnyWebhookController {
  private readonly logger = new Logger(BunnyWebhookController.name);

  /**
   * POST /bunny/webhook
   * Always returns 200 (same contract as the Mux webhook) so providers do not
   * retry while the endpoint is in observation mode.
   */
  @Public()
  @Post('webhook')
  handleWebhook(@Req() req: Request) {
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      this.logger.warn('Bunny webhook received with empty rawBody — ignoring');
      return { message: 'ok' };
    }

    let event: { type?: string; videoGuid?: string } | null = null;
    try {
      if (Buffer.byteLength(rawBody) <= MAX_INSPECT_BYTES) {
        event = JSON.parse(rawBody);
      } else {
        this.logger.warn(
          `Bunny webhook payload too large to inspect (${Buffer.byteLength(rawBody)} bytes)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Bunny webhook payload was not JSON: ${(err as Error).message}`,
      );
    }

    // OBSERVATION MODE: log only. Mutation handling is added once Bunny's
    // signature scheme + event catalogue are verified (blocker B-3).
    this.logger.log(
      `Bunny webhook (observation mode, no mutation): type=${event?.type ?? 'unknown'}`,
    );

    return { message: 'ok' };
  }
}
