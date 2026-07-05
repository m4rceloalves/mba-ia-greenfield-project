import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateVideoUploadDto {
  @ApiProperty({ example: 'My first StreamTube video', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'my-video.mp4', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalFileName: string;

  @ApiProperty({ example: 'video/mp4', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mimeType: string;

  @ApiProperty({ example: 524288000, maximum: 10737418240 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;
}
