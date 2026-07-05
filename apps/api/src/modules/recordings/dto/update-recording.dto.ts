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
  @IsIn(['ready', 'error'])
  @IsOptional()
  status?: string;
}
