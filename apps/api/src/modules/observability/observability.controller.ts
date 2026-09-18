import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { ObservabilityService } from './observability.service';
import { LogErrorDto } from './dto/log-error.dto';
import { LogEventDto } from './dto/log-event.dto';
import { TrackMetricDto } from './dto/track-metric.dto';
import { ReconcileErrorsDto } from './dto/reconcile-errors.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('observability')
export class ObservabilityController {
  constructor(private readonly observabilityService: ObservabilityService) {}

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post('errors')
  logError(
    @Body() dto: LogErrorDto,
    @CurrentUser() user: { id: string } | undefined,
  ) {
    return this.observabilityService.logError(dto, user?.id);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post('events')
  logEvent(@Body() dto: LogEventDto) {
    return this.observabilityService.logEvent(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT)
  @Post('metrics')
  trackMetric(
    @Body() dto: TrackMetricDto,
    @CurrentUser() user: { id: string } | undefined,
  ) {
    return this.observabilityService.trackMetric({ ...dto, userId: user?.id });
  }

  @Roles(UserRole.ADMIN)
  @Get('errors')
  getErrors(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('errorType') errorType?: string,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.observabilityService.getErrors({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      errorType,
      severity,
      resolved: resolved !== undefined ? resolved === 'true' : undefined,
      startDate,
      endDate,
    });
  }

  @Roles(UserRole.ADMIN)
  @Get('events')
  getEvents(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('eventType') eventType?: string,
    @Query('source') source?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.observabilityService.getEvents({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      eventType,
      source,
      startDate,
      endDate,
    });
  }

  @Roles(UserRole.ADMIN)
  @Get('metrics')
  getMetrics(
    @Query('metricName') metricName?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.observabilityService.getMetrics({
      metricName,
      startDate,
      endDate,
    });
  }

  @Roles(UserRole.ADMIN)
  @Patch('errors/reconcile')
  reconcileErrors(
    @Body() dto: ReconcileErrorsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.observabilityService.reconcileErrors(dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('errors/:id/resolve')
  resolveError(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.observabilityService.resolveError(id, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('errors/:id/reopen')
  reopenError(
    @Param('id') id: string,
  ) {
    return this.observabilityService.reopenError(id);
  }

  @Roles(UserRole.ADMIN)
  @Get('dashboard')
  getDashboard() {
    return this.observabilityService.getDashboard();
  }
}
