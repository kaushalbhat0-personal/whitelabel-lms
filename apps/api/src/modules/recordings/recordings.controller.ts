import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '@lms/shared-types';
import { RecordingsService } from './recordings.service';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { UpdateRecordingDto } from './dto/update-recording.dto';
import { BulkDeleteRecordingsDto } from './dto/bulk-delete-recordings.dto';
import { CreateTopicDto } from '../videos/dto/create-topic.dto';
import { RequestUploadDto } from '../videos/dto/request-upload.dto';
import { UpdateVideoProgressDto } from '../videos/dto/update-video-progress.dto';
import { UpdateBatchCurriculumDto } from './dto/update-batch-curriculum.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class RecordingsController {
  private readonly logger = new Logger(RecordingsController.name);
  constructor(private readonly recordingsService: RecordingsService) {}

  // ── Admin: Topics ──────────────────────────────────────────

  @Roles(UserRole.ADMIN)
  @Post('admin/topics')
  createTopic(@Body() dto: CreateTopicDto) {
    return this.recordingsService.createTopic(dto);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/topics')
  getTopics() {
    return this.recordingsService.getTopics();
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('admin/topics/:id')
  getTopicById(@Param('id') id: string) {
    return this.recordingsService.getTopicById(id);
  }

  // ── Admin: Recordings ──────────────────────────────────────

  @Roles(UserRole.ADMIN)
  @Post('admin/recordings')
  create(@Body() dto: CreateRecordingDto) {
    return this.recordingsService.createRecordingWithUpload(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('admin/recordings')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recordingsService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/recordings/all')
  getAdminRecordings(
    @Query('topicId') topicId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('batchId') batchId?: string,
    @Query('published') published?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recordingsService.getAdminRecordings(
      { topicId, search, status, batchId, published, sort },
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/recordings/:id/batches')
  assignToBatches(
    @Param('id') id: string,
    @Body('batchIds') batchIds: string[],
  ) {
    return this.recordingsService.assignToBatches(id, batchIds);
  }

  @Roles(UserRole.ADMIN)
  @Delete('admin/recordings/:id/batches')
  removeBatchAccess(
    @Param('id') id: string,
    @Body('batchIds') batchIds: string[],
  ) {
    return this.recordingsService.removeBatchAccess(id, batchIds);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/recordings/:id/batch-curriculum')
  updateBatchCurriculum(
    @Param('id') id: string,
    @Body() dto: UpdateBatchCurriculumDto,
  ) {
    return this.recordingsService.updateBatchCurriculum(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/upload-url')
  requestUploadUrl(@Body() dto: RequestUploadDto) {
    return this.recordingsService.requestUploadUrl(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch('admin/recordings/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecordingDto,
  ) {
    return this.recordingsService.updateRecording(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/recordings/bulk')
  bulkDelete(@Body() dto: BulkDeleteRecordingsDto) {
    return this.recordingsService.bulkDeleteRecordings(dto.recordingIds);
  }

  @Roles(UserRole.ADMIN)
  @Delete('admin/recordings/bulk')
  bulkDeleteViaDelete(@Body() dto: BulkDeleteRecordingsDto) {
    return this.recordingsService.bulkDeleteRecordings(dto.recordingIds);
  }

  @Roles(UserRole.ADMIN)
  @Delete('admin/recordings/:id')
  delete(@Param('id') id: string) {
    return this.recordingsService.deleteRecording(id);
  }

  // ── Student: Batch Recordings ──────────────────────────────

  @Roles(UserRole.STUDENT)
  @Get('recordings/batch/:batchId')
  getBatchRecordings(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.recordingsService.getBatchRecordings(batchId, user.id);
  }

  // ── Student: My Recordings ─────────────────────────────────

  @Roles(UserRole.STUDENT)
  @Get('recordings/my')
  async getMyRecordings(
    @CurrentUser() user: { id: string },
    @Query('topicId') topicId?: string,
  ) {
    this.logger.debug(`[DEBUG_CONTROLLER] GET /recordings/my | studentId=${user.id} | topicId=${topicId ?? 'none'}`);
    const result = await this.recordingsService.getRecordingsForStudent(user.id, topicId);
    this.logger.debug(`[DEBUG_CONTROLLER] GET /recordings/my | response=${JSON.stringify(result)}`);
    return result;
  }

  @Roles(UserRole.STUDENT)
  @Get('recordings/my/grouped')
  async getMyRecordingsGrouped(@CurrentUser() user: { id: string }) {
    this.logger.debug(`[DEBUG_CONTROLLER] GET /recordings/my/grouped | studentId=${user.id}`);
    const result = await this.recordingsService.getMyRecordingsGrouped(user.id);
    this.logger.debug(`[DEBUG_CONTROLLER] GET /recordings/my/grouped | response=${JSON.stringify(result)}`);
    return result;
  }

  @Roles(UserRole.STUDENT)
  @Post('recordings/:id/authorize')
  authorizePlayback(
    @Param('id') id: string,
    @Body('deviceId') deviceId: string | undefined,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip || req.headers['x-forwarded-for'] || undefined) as string | undefined;
    return this.recordingsService.authorizePlayback(id, user.id, deviceId, ip);
  }

  @Roles(UserRole.STUDENT)
  @Get('recordings/:id/play')
  getPlaybackUrl(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('deviceId') deviceId: string | undefined,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip || req.headers['x-forwarded-for'] || undefined) as string | undefined;
    return this.recordingsService.getPlaybackUrl(id, user.id, token, deviceId, ip);
  }

  @Roles(UserRole.STUDENT)
  @Post('recordings/:id/progress')
  updateProgress(
    @Param('id') id: string,
    @Body() dto: UpdateVideoProgressDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.recordingsService.updateProgress(user.id, id, dto);
  }

  // ── Backward Compat: /videos routes (delegate to recordings) ──

  @Roles(UserRole.ADMIN)
  @Post('videos/topics')
  legacyCreateTopic(@Body() dto: CreateTopicDto) {
    return this.recordingsService.createTopic(dto);
  }

  @Roles(UserRole.ADMIN)
  @Get('videos/topics')
  legacyGetTopics() {
    return this.recordingsService.getTopics();
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get('videos/topics/:id')
  legacyGetTopicById(@Param('id') id: string) {
    return this.recordingsService.getTopicById(id);
  }

  @Roles(UserRole.ADMIN)
  @Post('videos')
  legacyCreate(@Body() createRecordingDto: CreateRecordingDto) {
    return this.recordingsService.createRecordingWithUpload(createRecordingDto);
  }

  @Roles(UserRole.ADMIN)
  @Post('videos/:id/batches')
  legacyAssignToBatches(
    @Param('id') id: string,
    @Body('batchIds') batchIds: string[],
  ) {
    return this.recordingsService.assignToBatches(id, batchIds);
  }

  @Roles(UserRole.ADMIN)
  @Delete('videos/:id/batches')
  legacyRemoveBatchAccess(
    @Param('id') id: string,
    @Body('batchIds') batchIds: string[],
  ) {
    return this.recordingsService.removeBatchAccess(id, batchIds);
  }

  @Roles(UserRole.ADMIN)
  @Post('videos/upload-url')
  legacyRequestUploadUrl(@Body() dto: RequestUploadDto) {
    return this.recordingsService.requestUploadUrl(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch('videos/:id')
  legacyUpdate(
    @Param('id') id: string,
    @Body() dto: UpdateRecordingDto,
  ) {
    return this.recordingsService.updateRecording(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete('videos/:id')
  legacyDelete(@Param('id') id: string) {
    return this.recordingsService.deleteRecording(id);
  }

  @Roles(UserRole.ADMIN)
  @Get('videos/admin')
  legacyGetAdminVideos(
    @Query('topicId') topicId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('batchId') batchId?: string,
    @Query('published') published?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recordingsService.getAdminRecordings(
      { topicId, search, status, batchId, published, sort },
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Roles(UserRole.STUDENT)
  @Get('videos/batch/:batchId')
  legacyGetBatchVideos(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.recordingsService.getBatchRecordings(batchId, user.id);
  }

  @Roles(UserRole.STUDENT)
  @Get('videos/my')
  legacyGetMyVideos(
    @CurrentUser() user: { id: string },
    @Query('topicId') topicId?: string,
  ) {
    return this.recordingsService.getRecordingsForStudent(user.id, topicId);
  }

  @Roles(UserRole.STUDENT)
  @Get('videos/my/grouped')
  legacyGetMyVideosGrouped(@CurrentUser() user: { id: string }) {
    return this.recordingsService.getMyRecordingsGrouped(user.id);
  }

  @Roles(UserRole.STUDENT)
  @Post('videos/:id/authorize')
  legacyAuthorizePlayback(
    @Param('id') id: string,
    @Body('deviceId') deviceId: string | undefined,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip || req.headers['x-forwarded-for'] || undefined) as string | undefined;
    return this.recordingsService.authorizePlayback(id, user.id, deviceId, ip);
  }

  @Roles(UserRole.STUDENT)
  @Get('videos/:id/play')
  legacyGetPlaybackUrl(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('deviceId') deviceId: string | undefined,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip || req.headers['x-forwarded-for'] || undefined) as string | undefined;
    return this.recordingsService.getPlaybackUrl(id, user.id, token, deviceId, ip);
  }

  @Roles(UserRole.STUDENT)
  @Post('videos/:id/progress')
  legacyUpdateProgress(
    @Param('id') id: string,
    @Body() dto: UpdateVideoProgressDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.recordingsService.updateProgress(user.id, id, dto);
  }
}
