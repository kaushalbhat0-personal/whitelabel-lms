import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class BulkDeleteRecordingsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one recording ID is required' })
  @IsUUID('4', { each: true, message: 'Each recording ID must be a valid UUID' })
  recordingIds!: string[];
}
