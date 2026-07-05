import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class InitiateVideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  videoId: string;

  @ApiProperty()
  publicId: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty()
  uploadId: string;

  @ApiProperty()
  partSizeBytes: number;

  @ApiProperty()
  partCount: number;
}

export class PresignedUploadPartDto {
  @ApiProperty()
  partNumber: number;

  @ApiProperty()
  uploadUrl: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;
}

export class RequestUploadPartsResponseDto {
  @ApiProperty({ type: [PresignedUploadPartDto] })
  parts: PresignedUploadPartDto[];
}

export class CompleteVideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  videoId: string;

  @ApiProperty()
  publicId: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.PROCESSING })
  status: VideoStatus;
}

export class OwnerVideoStatusResponseDto {
  @ApiProperty({ format: 'uuid' })
  videoId: string;

  @ApiProperty()
  publicId: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiPropertyOptional()
  durationSeconds?: number;

  @ApiPropertyOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional()
  processingErrorCode?: string;

  @ApiPropertyOptional()
  processingErrorMessage?: string;
}

export class PublicVideoMetadataResponseDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  durationSeconds?: number;

  @ApiPropertyOptional()
  thumbnailUrl?: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.READY })
  status: VideoStatus.READY;
}
