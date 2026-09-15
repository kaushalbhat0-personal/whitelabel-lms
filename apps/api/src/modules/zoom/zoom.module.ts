/*
 * Zoom module — integrations with the Zoom Webinar API
 *
 * Why this module exists:
 *   - Groups all Zoom-related code (API client, webhook handler, controller) in one place.
 *   - Exports ZoomService so LiveSessionsModule can create webinars and register attendees.
 *
 * A junior should know:
 *   - ZoomController handles incoming webhooks (participant_joined, etc.).
 *   - ZoomService is the Zoom API client — called by LiveSessionsService.
 *   - SupabaseService is globally available (provided in AppModule) so we don't
 *     need to import it here.
 */
import { Module } from '@nestjs/common';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';
import { ZoomWebhookHandler } from './zoom-webhook.handler';

@Module({
  controllers: [ZoomController],
  providers: [ZoomService, ZoomWebhookHandler],
  exports: [ZoomService, ZoomWebhookHandler],
})
export class ZoomModule {}
