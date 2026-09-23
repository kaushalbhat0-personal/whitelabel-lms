import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { BatchCurriculumService } from './batch-curriculum.service';
import { AddCurriculumItemDto } from './dto/add-curriculum-item.dto';
import { UpdateCurriculumItemDto } from './dto/update-curriculum-item.dto';
import { ReorderCurriculumDto } from './dto/reorder-curriculum.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

@Controller()
export class BatchCurriculumController {
  constructor(private readonly service: BatchCurriculumService) {}

  @Get('admin/batch-curriculum/:batchId')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  findAll(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.service.findAll(batchId);
  }

  @Get('batches/:batchId/curriculum')
  @Roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT)
  findPublished(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.service.findPublished(batchId);
  }

  @Post('admin/batch-curriculum/:batchId')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  add(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: AddCurriculumItemDto,
  ) {
    return this.service.add(batchId, dto);
  }

  @Patch('admin/batch-curriculum/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCurriculumItemDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete('admin/batch-curriculum/:id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Patch('admin/batch-curriculum/:batchId/reorder')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  reorder(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: ReorderCurriculumDto,
  ) {
    return this.service.reorder(batchId, dto);
  }

  @Patch('admin/batch-curriculum/:batchId/reorder-categories')
  @Roles(UserRole.ADMIN)
  reorderCategories(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: ReorderCategoriesDto,
  ) {
    return this.service.reorderCategories(batchId, dto);
  }

  @Get('admin/batch-curriculum/:batchId/integrity')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  integrity(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.service.integrityCheck(batchId);
  }
}
