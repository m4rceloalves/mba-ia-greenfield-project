import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteVideoUploadPartDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  @ApiProperty({ example: '"9b2cf535f27731c974343645a3985328"' })
  @IsString()
  @IsNotEmpty()
  eTag: string;
}

export class CompleteVideoUploadDto {
  @ApiProperty({ type: [CompleteVideoUploadPartDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CompleteVideoUploadPartDto)
  parts: CompleteVideoUploadPartDto[];
}
