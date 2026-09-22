import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { InvoicesController } from './invoices.controller';
import { ReceiptsController } from './receipts.controller';
import { InvoicesService } from './invoices.service';
import { EmailModule } from '../email/email.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PdfGenerationModule } from '../pdf/pdf-generation.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }),
    EmailModule,
    forwardRef(() => OutboxModule),
    PdfGenerationModule,
    ObservabilityModule,
  ],
  controllers: [InvoicesController, ReceiptsController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
