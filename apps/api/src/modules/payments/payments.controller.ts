/*
 * Payments controller — endpoints for payment plans and installments
 *
 * Why this controller exists:
 *   - Admin routes: create plans, fetch any student's plans, mark installments paid.
 *   - Student route: fetch own plans with installments for the dashboard.
 */
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { PaymentsService } from './payments.service';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { MarkInstallmentPaidDto } from './dto/mark-installment-paid.dto';
import { RecordBookingPaymentDto } from './dto/record-booking-payment.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles(UserRole.ADMIN)
  @Post('plans')
  createPlan(@Body() dto: CreatePaymentPlanDto, @CurrentUser() user: any) {
    return this.paymentsService.createPaymentPlan(dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Get('plans/student/:studentId')
  getStudentPlans(@Param('studentId') studentId: string) {
    return this.paymentsService.getStudentPlans(studentId);
  }

  @Roles(UserRole.ADMIN)
  @Patch('installments/:id/pay')
  markInstallmentPaid(
    @Param('id') id: string,
    @Body() dto: MarkInstallmentPaidDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.markInstallmentPaid(id, dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Post('plans/:id/booking')
  recordBookingPayment(
    @Param('id') id: string,
    @Body() dto: RecordBookingPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.recordBookingPayment(id, dto, user.id);
  }

  @Roles(UserRole.STUDENT)
  @Get('my')
  getMyPlans(@CurrentUser() user: { id: string }) {
    return this.paymentsService.getStudentPlans(user.id);
  }
}
