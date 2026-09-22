import {
  IsUUID,
  IsNumber,
  IsInt,
  Min,
  IsOptional,
  IsDateString,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreatePaymentPlanDto {
  @IsUUID('4', { message: 'studentId must be a valid UUID' })
  studentId: string;

  @IsUUID('4', { message: 'courseId must be a valid UUID' })
  courseId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'totalAmount must be a number with up to 2 decimal places' })
  @Min(0.01, { message: 'totalAmount must be at least 0.01' })
  totalAmount: number;

  @IsInt({ message: 'numberOfInstallments must be an integer' })
  @Min(1, { message: 'numberOfInstallments must be at least 1' })
  numberOfInstallments: number;

  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @IsOptional()
  @MinLength(1, { message: 'notes must not be empty' })
  notes?: string;

  /**
   * Standard / list course fee at time of agreement.
   * NULL means legacy/unspecified. When supplied must equal
   * discount + total with cent precision (business rule P1-7).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'standardCourseFee must be a number with up to 2 decimal places' })
  @Min(0.01, { message: 'standardCourseFee must be at least 0.01' })
  standardCourseFee?: number;

  /**
   * Discount in rupees applied to reach final agreed fee.
   * Storing the rupee amount preserves audit trail; percent is derived.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'discountAmount must be a number with up to 2 decimal places' })
  @Min(0, { message: 'discountAmount must be at least 0' })
  discountAmount?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString({ message: 'discountReason must be a string' })
  @MinLength(1, { message: 'discountReason must not be empty' })
  discountReason?: string | null;

  /**
   * Booking amount for this student/plan. NULL = not specified (legacy).
   * 0 is a valid explicit value (no booking required). When supplied
   * must not exceed the final agreed fee (totalAmount).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'bookingAmount must be a number with up to 2 decimal places' })
  @Min(0, { message: 'bookingAmount must be at least 0' })
  bookingAmount?: number;
}
