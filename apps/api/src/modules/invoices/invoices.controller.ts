import {
  Controller,
  Get,
  Post,
  Param,
  UseInterceptors,
  UploadedFile,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InvoicesService } from './invoices.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@lms/shared-types';

@Controller('invoices')
@Roles(UserRole.ADMIN)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  async listInvoices(@Query('studentId') studentId?: string) {
    return this.invoicesService.listInvoices(studentId);
  }

  @Get('by-payment/:paymentId')
  async getByPayment(@Param('paymentId') paymentId: string) {
    const invoice = await this.invoicesService.getInvoiceByPaymentId(paymentId);
    if (!invoice) throw new (await import('@nestjs/common')).NotFoundException('Invoice not found for payment');
    return invoice;
  }

  @Get(':id/download')
  async download(@Param('id') id: string) {
    return this.invoicesService.getDownloadUrl(id);
  }

  @Post(':id/send')
  async sendInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.invoicesService.sendInvoiceEmail(id, user.id);
  }

  @Post('receipts/:id/send')
  async sendReceiptViaInvoices(@Param('id') id: string, @CurrentUser() user: any) {
    return this.invoicesService.sendReceiptEmail(id, user.id);
  }

  @Post('bulk-generate')
  @UseInterceptors(FileInterceptor('file'))
  async bulkGenerate(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.invoicesService.bulkGenerate(user.id, file);
  }
}
