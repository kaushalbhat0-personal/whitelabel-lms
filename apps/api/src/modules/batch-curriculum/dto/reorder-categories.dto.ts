import { IsArray, ArrayMinSize, IsString, MinLength, MaxLength } from 'class-validator';

export class ReorderCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  orderedCategoryNames!: string[];
}
