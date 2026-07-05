import { IsString, MinLength } from 'class-validator';

export class RequestUploadDto {
  @IsString()
  @MinLength(2, { message: 'Title must be at least 2 characters' })
  title: string;
}
