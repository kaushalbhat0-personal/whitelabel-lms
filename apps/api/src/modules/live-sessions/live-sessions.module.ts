/*
 * Live Sessions module — manages Zoom webinar sessions and student registration
 *
 * Why this module exists:
 *   - Wires together the session controller, service, and its dependencies.
 *   - Imports BatchesModule (for batch validation) and ZoomModule (for webinar creation).
 *   - Exports LiveSessionsService so other modules (e.g. AttendanceModule) can use it.
 *
 * A junior should know:
 *   - BatchesModule provides BatchesService (validates batch IDs exist).
 *   - ZoomModule provides ZoomService (creates webinars and registers attendees).
 *   - New service? Add it to providers AND exports if other modules need it.
 */
import { Module } from '@nestjs/common';
import { LiveSessionsController } from './live-sessions.controller';
import { LiveSessionsService } from './live-sessions.service';
import { BatchesModule } from '../batches/batches.module';
import { LiveProviderModule } from '../live-provider/live-provider.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [BatchesModule, LiveProviderModule, ObservabilityModule],
  controllers: [LiveSessionsController],
  providers: [LiveSessionsService],
  exports: [LiveSessionsService],
})
export class LiveSessionsModule {}
