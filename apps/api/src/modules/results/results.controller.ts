import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { ResultsService } from './results.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Roles(UserRole.ADMIN)
  @Get('admin/overall')
  getOverallAnalytics(@Query('batchId') batchId?: string) {
    return this.resultsService.getOverallAnalytics({ batchId });
  }

  @Roles(UserRole.STUDENT)
  @Get('my/dashboard')
  getDashboardResults(@CurrentUser() user: { id: string }) {
    return this.resultsService.getDashboardResults(user.id);
  }

  @Roles(UserRole.STUDENT)
  @Get('my')
  getMyResults(
    @CurrentUser() user: { id: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.resultsService.getMyResults(user.id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('test/:testId/analytics')
  getTestAnalytics(@Param('testId') testId: string) {
    return this.resultsService.getTestAnalytics(testId);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('test/:testId')
  getTestResults(
    @Param('testId') testId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orderBy') orderBy?: string,
  ) {
    return this.resultsService.getTestResults(testId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      orderBy,
    });
  }

  @Roles(UserRole.ADMIN)
  @Get('student/:userId/analytics')
  getStudentAnalytics(@Param('userId') userId: string) {
    return this.resultsService.getStudentAnalytics(userId);
  }

  @Roles(UserRole.STUDENT)
  @Get(':attemptId')
  getStudentResult(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.resultsService.getStudentResult(attemptId, user.id);
  }
}
