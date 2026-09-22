import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { PaymentMethod } from '@lms/shared-types';

export class RecordBookingPaymentDto {
  @IsEnum(PaymentMethod, { message: 'paymentMethod must be a valid PaymentMethod enum value' })
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString({ message: 'transactionId must be a string' })
  transactionId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'paymentDate must be a valid ISO date string' })
  paymentDate?: string;
}
