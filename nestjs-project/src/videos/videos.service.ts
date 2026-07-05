import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import {
  VideoForbiddenException,
  VideoInvalidPartsException,
  VideoInvalidUploadStateException,
  VideoNotFoundException,
  VideoQueueFailedException,
  VideoStorageFailedException,
  VideoUnsupportedTypeException,
  VideoUploadTooLargeException,
} from '../common/exceptions/domain.exception';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { InitiateVideoUploadDto } from './dto/initiate-video-upload.dto';
import { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import {
  CompleteVideoUploadResponseDto,
  InitiateVideoUploadResponseDto,
  OwnerVideoStatusResponseDto,
  PublicVideoMetadataResponseDto,
  RequestUploadPartsResponseDto,
} from './dto/video-upload-response.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoProcessingQueueService } from './video-processing-queue.service';
import { VideoStorageService } from './storage/video-storage.service';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_COLUMN = 'public_id';
const MAX_PUBLIC_ID_RETRIES = 5;

function isPgUniqueViolationOnColumn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }

  const e = err.driverError as unknown as {
    code?: unknown;
    detail?: unknown;
  };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(column)
  );
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    @Inject(videoConfig.KEY)
    private readonly videoCfg: ConfigType<typeof videoConfig>,
    private readonly storageService: VideoStorageService,
    private readonly queueService: VideoProcessingQueueService,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateVideoUploadDto,
  ): Promise<InitiateVideoUploadResponseDto> {
    this.validateUploadRequest(dto);
    const channel = await this.getUserChannel(userId);
    const video = await this.createDraftVideo(channel.id, dto);

    let uploadId: string;
    try {
      const createdUpload = await this.storageService.createMultipartUpload({
        channelId: channel.id,
        videoId: video.id,
        originalFileName: dto.originalFileName,
        mimeType: dto.mimeType,
      });
      uploadId = createdUpload.uploadId;
      video.upload_id = uploadId;
      await this.videoRepository.save(video);
    } catch {
      await this.videoRepository.delete({ id: video.id });
      throw new VideoStorageFailedException();
    }

    return {
      videoId: video.id,
      publicId: video.public_id,
      status: video.status,
      uploadId,
      partSizeBytes: video.part_size_bytes,
      partCount: video.part_count,
    };
  }

  async createUploadPartUrls(
    userId: string,
    videoId: string,
    dto: RequestUploadPartsDto,
  ): Promise<RequestUploadPartsResponseDto> {
    const video = await this.getOwnedVideo(userId, videoId);
    this.assertDraftUpload(video);
    this.assertRequestedParts(video, dto);

    try {
      const parts = await this.storageService.createPresignedUploadPartUrls({
        key: video.original_file_key,
        uploadId: video.upload_id!,
        partNumbers: dto.partNumbers,
      });
      return { parts };
    } catch {
      throw new VideoInvalidPartsException();
    }
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<CompleteVideoUploadResponseDto> {
    const video = await this.getOwnedVideo(userId, videoId);
    this.assertDraftUpload(video);
    this.assertCompleteParts(video, dto);

    try {
      await this.storageService.completeMultipartUpload({
        key: video.original_file_key,
        uploadId: video.upload_id!,
        parts: dto.parts,
      });
    } catch {
      throw new VideoStorageFailedException();
    }

    video.status = VideoStatus.PROCESSING;
    video.upload_completed_at = new Date();

    try {
      const jobId = await this.queueService.enqueueProcessingJob({
        videoId: video.id,
        channelId: video.channel_id,
        originalFileKey: video.original_file_key,
      });
      video.processing_job_id = jobId;
      await this.videoRepository.save(video);
    } catch {
      video.status = VideoStatus.ERROR;
      video.processing_error_code = 'VIDEO_QUEUE_FAILED';
      video.processing_error_message =
        'Video processing job could not be queued';
      await this.videoRepository.save(video);
      throw new VideoQueueFailedException();
    }

    return {
      videoId: video.id,
      publicId: video.public_id,
      status: video.status,
    };
  }

  async abortUpload(userId: string, videoId: string): Promise<void> {
    const video = await this.getOwnedVideo(userId, videoId);
    this.assertDraftUpload(video);

    if (video.upload_id) {
      try {
        await this.storageService.abortMultipartUpload(
          video.original_file_key,
          video.upload_id,
        );
      } catch {
        throw new VideoStorageFailedException();
      }
    }

    await this.videoRepository.delete({ id: video.id });
  }

  async getOwnerStatus(
    userId: string,
    videoId: string,
  ): Promise<OwnerVideoStatusResponseDto> {
    const video = await this.getOwnedVideo(userId, videoId);

    return {
      videoId: video.id,
      publicId: video.public_id,
      status: video.status,
      ...(video.duration_seconds !== null && {
        durationSeconds: video.duration_seconds,
      }),
      ...(video.thumbnail_key !== null && {
        thumbnailUrl: `/videos/${video.public_id}/thumbnail`,
      }),
      ...(video.processing_error_code !== null && {
        processingErrorCode: video.processing_error_code,
      }),
      ...(video.processing_error_message !== null && {
        processingErrorMessage: video.processing_error_message,
      }),
    };
  }

  async getPublicMetadata(
    publicId: string,
  ): Promise<PublicVideoMetadataResponseDto> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });

    if (!video || video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    return {
      publicId: video.public_id,
      title: video.title,
      status: VideoStatus.READY,
      ...(video.duration_seconds !== null && {
        durationSeconds: video.duration_seconds,
      }),
      ...(video.thumbnail_key !== null && {
        thumbnailUrl: `/videos/${video.public_id}/thumbnail`,
      }),
    };
  }

  private validateUploadRequest(dto: InitiateVideoUploadDto): void {
    if (dto.sizeBytes > this.videoCfg.maxUploadBytes) {
      throw new VideoUploadTooLargeException();
    }

    if (!this.videoCfg.allowedMimeTypes.includes(dto.mimeType)) {
      throw new VideoUnsupportedTypeException();
    }
  }

  private async getUserChannel(userId: string): Promise<Channel> {
    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });

    if (!channel) {
      throw new VideoForbiddenException();
    }

    return channel;
  }

  private async getOwnedVideo(userId: string, videoId: string): Promise<Video> {
    const [channel, video] = await Promise.all([
      this.getUserChannel(userId),
      this.videoRepository.findOne({ where: { id: videoId } }),
    ]);

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.channel_id !== channel.id) {
      throw new VideoForbiddenException();
    }

    return video;
  }

  private async createDraftVideo(
    channelId: string,
    dto: InitiateVideoUploadDto,
  ): Promise<Video> {
    for (let attempt = 0; attempt < MAX_PUBLIC_ID_RETRIES; attempt++) {
      const id = randomUUID();
      const publicId = this.generatePublicId();
      const partSizeBytes = this.videoCfg.multipartPartSizeBytes;
      const partCount = this.storageService.calculatePartCount(
        dto.sizeBytes,
        partSizeBytes,
      );

      if (partCount > 10000) {
        throw new VideoInvalidPartsException();
      }

      const video = this.videoRepository.create({
        id,
        channel_id: channelId,
        title: dto.title,
        public_id: publicId,
        status: VideoStatus.DRAFT,
        original_file_name: dto.originalFileName,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes,
        original_file_key: this.storageService.buildOriginalVideoKey({
          channelId,
          videoId: id,
          originalFileName: dto.originalFileName,
        }),
        thumbnail_key: null,
        upload_id: null,
        part_size_bytes: partSizeBytes,
        part_count: partCount,
        duration_seconds: null,
        metadata: null,
        processing_job_id: null,
        processing_error_code: null,
        processing_error_message: null,
        processing_error_details: null,
        upload_completed_at: null,
        processed_at: null,
      });

      try {
        return await this.videoRepository.save(video);
      } catch (error) {
        if (isPgUniqueViolationOnColumn(error, PUBLIC_ID_COLUMN)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Video public id conflict could not be resolved');
  }

  private assertDraftUpload(video: Video): void {
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new VideoInvalidUploadStateException();
    }
  }

  private assertCompleteParts(video: Video, dto: CompleteVideoUploadDto): void {
    if (dto.parts.length !== video.part_count) {
      throw new VideoInvalidPartsException();
    }

    const partNumbers = dto.parts.map((part) => part.partNumber);
    const uniquePartNumbers = new Set(partNumbers);
    if (uniquePartNumbers.size !== partNumbers.length) {
      throw new VideoInvalidPartsException();
    }

    const hasInvalidPart = partNumbers.some(
      (partNumber) => partNumber < 1 || partNumber > video.part_count,
    );
    if (hasInvalidPart) {
      throw new VideoInvalidPartsException();
    }
  }

  private assertRequestedParts(video: Video, dto: RequestUploadPartsDto): void {
    if (dto.partNumbers.length === 0) {
      throw new VideoInvalidPartsException();
    }

    const uniquePartNumbers = new Set(dto.partNumbers);
    if (uniquePartNumbers.size !== dto.partNumbers.length) {
      throw new VideoInvalidPartsException();
    }

    const hasInvalidPart = dto.partNumbers.some(
      (partNumber) =>
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > video.part_count,
    );
    if (hasInvalidPart) {
      throw new VideoInvalidPartsException();
    }
  }

  private generatePublicId(): string {
    return randomBytes(12).toString('base64url');
  }
}
