import {
  IsString,
  IsArray,
  IsUUID,
  IsBoolean,
  IsOptional,
  ArrayMinSize,
  MinLength,
  IsObject,
} from 'class-validator';

export class CreateRecordingDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  batchIds: string[];

  @IsString()
  @IsOptional()
  categoryName?: string;

  @IsOptional()
  @IsObject()
  categoryByBatch?: Record<string, string>;

  @IsString()
  @IsOptional()
  moduleName?: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsString()
  @IsOptional()
  titleOverride?: string;
}
