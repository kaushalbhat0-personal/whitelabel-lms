import { Controller, Post, Param, Get, Query } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@lms/shared-types';

@Controller('receipts')
@Roles(UserRole.ADMIN)
export class ReceiptsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  async listReceipts(@Query('studentId') studentId?: string) {
    return this.invoicesService.listReceipts(studentId);
  }

  @Get('by-payment/:paymentId')
  async getByPayment(@Param('paymentId') paymentId: string) {
    const receipt = await this.invoicesService.getReceiptByPaymentId(paymentId);
    if (!receipt) throw new (await import('@nestjs/common')).NotFoundException('Receipt not found for payment');
    return receipt;
  }

  @Post(':id/send')
  async sendReceipt(@Param('id') id: string, @CurrentUser() user: any) {
    return this.invoicesService.sendReceiptEmail(id, user.id);
  }
}
