import { IsString, IsOptional, IsUUID, MinLength, IsIn } from 'class-validator';

export class UpdateRecordingDto {
  @IsString()
  @MinLength(2)
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID('4')
  @IsOptional()
  topicId?: string | null;

  @IsString()
  // Live DB CHECK allows ONLY these canonical statuses. Writing 'error'
  // violates the constraint and leaves the row stuck in 'processing' (7B R3).
  @IsIn(['processing', 'ready', 'failed'])
  @IsOptional()
  status?: string;
}
