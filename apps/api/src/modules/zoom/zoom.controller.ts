/*
 * Zoom controller — webhook endpoint + SDK signature generation
 */
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ZoomService } from './zoom.service';
import { ZoomWebhookHandler } from './zoom-webhook.handler';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { CreateSignatureDto } from './dto/create-signature.dto';

@Controller('zoom')
export class ZoomController {
  private readonly logger = new Logger(ZoomController.name);

  constructor(
    private readonly zoomService: ZoomService,
    private readonly supabaseService: SupabaseService,
    private readonly zoomWebhookHandler: ZoomWebhookHandler,
  ) {}

  /**
   * POST /zoom/signature
   *
   * Generates a time-limited HMAC signature for the Zoom Meeting SDK.
   * Only accessible to authenticated users with batch access to the session.
   *
   * Steps:
   *   1. Verify the user is authenticated (JWT guard handles this)
   *   2. Look up the session by zoom_meeting_id
   *   3. Verify the user belongs to a batch assigned to this session
   *   4. Generate and return the SDK signature
   */
  @Post('signature')
  async createSignature(
    @Body() dto: CreateSignatureDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    // Look up session by Zoom webinar ID
    const { data: sessions, error: sessionError } = await this.supabaseService.client
      .from(TABLES.LIVE_SESSIONS)
      .select('id, status, start_time')
      .eq('zoom_webinar_id', dto.meetingNumber)
      .limit(1);

    if (sessionError || !sessions || sessions.length === 0) {
      throw new NotFoundException('Session not found');
    }

    const session = sessions[0];

    if (session.status !== 'live') {
      throw new ForbiddenException('Session is not live');
    }

    // Verify user has batch access to this session
    const { data: userBatches } = await this.supabaseService.client
      .from(TABLES.BATCH_STUDENTS)
      .select('batch_id')
      .eq('user_id', userId);

    const userBatchIds = (userBatches ?? []).map((b: any) => b.batch_id);

    if (userBatchIds.length === 0) {
      throw new ForbiddenException('You do not have access to this session');
    }

    const { data: accessRecords } = await this.supabaseService.client
      .from(TABLES.SESSION_BATCHES)
      .select('batch_id')
      .eq('session_id', session.id)
      .in('batch_id', userBatchIds);

    if (!accessRecords || accessRecords.length === 0) {
      throw new ForbiddenException('You do not have access to this session');
    }

    // Generate SDK signature
    const { signature, sdkKey } = this.zoomService.generateSignature(
      dto.meetingNumber,
      dto.role,
    );

    return {
      signature,
      sdkKey,
      meetingNumber: dto.meetingNumber,
      role: dto.role,
    };
  }

  @Public()
  @Post('webhook')
  async handleZoomWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const body = req.body as any;
    this.logger.log(`Zoom webhook received: ${body?.event ?? 'unknown'}`);

    // Zoom's endpoint URL validation challenge — must NOT require the HMAC header.
    if (body?.event === 'endpoint.url_validation') {
      const validationResponse = this.zoomService.validateWebhookChallenge(body.payload.plainToken);
      return res.status(200).json(validationResponse);
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      this.logger.error('req.rawBody is empty — did main.ts forget rawBody: true?');
      return res.status(200).json({ success: true });
    }

    const zoomSignature = req.headers['x-zm-signature'] as string | undefined;
    const zoomTimestamp = req.headers['x-zm-request-timestamp'] as string | undefined;

    if (!zoomSignature || !zoomTimestamp) {
      this.logger.warn('Zoom webhook missing signature headers — ignoring');
      return res.status(200).json({ success: true });
    }

    // Verify the signature against the raw body before dispatching. Always return
    // 200 (never throw) so Zoom does not retry unverified/failed events.
    try {
      this.zoomService.verifyWebhookSignature(rawBody, zoomSignature, zoomTimestamp);
    } catch (err) {
      this.logger.error(`Zoom webhook signature verification failed: ${(err as Error).message}`);
      return res.status(200).json({ success: true });
    }

    // Dispatch verified events to the handler (attendance, recording, status).
    // The handler expects the `payload` sub-object, not the full body wrapper.
    try {
      await this.zoomWebhookHandler.handle(body?.event, body?.payload, this.supabaseService.client);
    } catch (err) {
      this.logger.error(`Zoom webhook handler error: ${(err as Error).message}`);
    }

    return res.status(200).json({ success: true });
  }
}
