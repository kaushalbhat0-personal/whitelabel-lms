import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  ParseBoolPipe,
} from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateCourseDto) {
    return this.coursesService.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe) includeInactive: boolean,
  ) {
    return this.coursesService.findAll(page, pageSize, includeInactive);
  }

  @Get('my')
  @Roles(UserRole.STUDENT)
  myCourses(@CurrentUser() user: { id: string }) {
    return this.coursesService.getCoursesForStudent(user.id);
  }

  @Get('my/dashboard')
  @Roles(UserRole.STUDENT)
  myDashboardCourses(@CurrentUser() user: { id: string }) {
    return this.coursesService.getDashboardCoursesForStudent(user.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.coursesService.findById(id, user);
  }

  @Get(':id/batches')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  getBatches(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.getBatches(id);
  }

  @Get(':id/stats')
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.getStats(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.coursesService.update(id, dto);
  }

  @Post(':id/duplicate')
  @Roles(UserRole.ADMIN)
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.duplicate(id);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.deactivate(id);
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.activate(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.deactivate(id);
  }
}
