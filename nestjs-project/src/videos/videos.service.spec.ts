import type { ConfigType } from '@nestjs/config';
import type { Repository } from 'typeorm';
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
import { Video, VideoStatus } from './entities/video.entity';
import { VideoProcessingQueueService } from './video-processing-queue.service';
import { VideoStorageService } from './storage/video-storage.service';
import { VideosService } from './videos.service';

const videoCfg: ConfigType<typeof videoConfig> = {
  maxUploadBytes: 10_737_418_240,
  multipartPartSizeBytes: 104_857_600,
  allowedMimeTypes: ['video/mp4', 'video/webm'],
  processingTimeoutMs: 120_000,
};

const uploadDto = {
  title: 'Video title',
  originalFileName: 'video.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 200_000_000,
};

function buildDraftVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-1',
    channel_id: 'channel-1',
    title: 'Video title',
    public_id: 'public-id',
    status: VideoStatus.DRAFT,
    original_file_name: 'video.mp4',
    mime_type: 'video/mp4',
    size_bytes: 200_000_000,
    original_file_key: 'original-key',
    thumbnail_key: null,
    upload_id: 'upload-1',
    part_size_bytes: 104_857_600,
    part_count: 2,
    duration_seconds: null,
    metadata: null,
    processing_job_id: null,
    processing_error_code: null,
    processing_error_message: null,
    processing_error_details: null,
    upload_completed_at: null,
    processed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: {} as Channel,
    ...overrides,
  };
}

describe('VideosService', () => {
  let videoRepository: jest.Mocked<Repository<Video>>;
  let channelRepository: jest.Mocked<Repository<Channel>>;
  let storageService: jest.Mocked<VideoStorageService>;
  let queueService: jest.Mocked<VideoProcessingQueueService>;
  let service: VideosService;

  beforeEach(() => {
    videoRepository = {
      create: jest.fn((entity) => ({ ...entity }) as Video),
      save: jest.fn(async (entity) => entity as Video),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Video>>;
    channelRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'channel-1' }),
    } as unknown as jest.Mocked<Repository<Channel>>;
    storageService = {
      calculatePartCount: jest.fn().mockReturnValue(2),
      buildOriginalVideoKey: jest.fn().mockReturnValue('original-key'),
      createMultipartUpload: jest
        .fn()
        .mockResolvedValue({ key: 'original-key', uploadId: 'upload-1' }),
      createPresignedUploadPartUrls: jest.fn().mockResolvedValue([
        {
          partNumber: 1,
          uploadUrl: 'https://signed/1',
          expiresAt: new Date('2026-07-05T12:15:00.000Z'),
        },
      ]),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoStorageService>;
    queueService = {
      enqueueProcessingJob: jest
        .fn()
        .mockResolvedValue('process-video-video-1'),
    } as unknown as jest.Mocked<VideoProcessingQueueService>;
    service = new VideosService(
      videoRepository,
      channelRepository,
      videoCfg,
      storageService,
      queueService,
    );
  });

  it('should create a draft video and multipart upload on initiateUpload', async () => {
    const result = await service.initiateUpload('user-1', uploadDto);

    expect(channelRepository.findOne).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    });
    expect(videoRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'channel-1',
        title: 'Video title',
        status: VideoStatus.DRAFT,
        original_file_key: 'original-key',
        upload_id: null,
        part_count: 2,
      }),
    );
    expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        originalFileName: 'video.mp4',
        mimeType: 'video/mp4',
      }),
    );
    expect(videoRepository.save).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: VideoStatus.DRAFT,
      uploadId: 'upload-1',
      partSizeBytes: 104_857_600,
      partCount: 2,
    });
  });

  it('should reject uploads larger than the configured 10GB limit', async () => {
    await expect(
      service.initiateUpload('user-1', {
        ...uploadDto,
        sizeBytes: 10_737_418_241,
      }),
    ).rejects.toThrow(VideoUploadTooLargeException);
  });

  it('should reject unsupported video MIME types', async () => {
    await expect(
      service.initiateUpload('user-1', {
        ...uploadDto,
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(VideoUnsupportedTypeException);
  });

  it('should clean up the draft if storage upload creation fails', async () => {
    storageService.createMultipartUpload.mockRejectedValue(new Error('S3'));

    await expect(service.initiateUpload('user-1', uploadDto)).rejects.toThrow(
      VideoStorageFailedException,
    );
    expect(videoRepository.delete).toHaveBeenCalledWith({
      id: expect.any(String),
    });
  });

  it('should return presigned URLs for an owned draft upload', async () => {
    videoRepository.findOne.mockResolvedValue(buildDraftVideo());

    await expect(
      service.createUploadPartUrls('user-1', 'video-1', {
        partNumbers: [1],
      }),
    ).resolves.toEqual({
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://signed/1',
          expiresAt: new Date('2026-07-05T12:15:00.000Z'),
        },
      ],
    });
  });

  it('should reject non-owner access', async () => {
    channelRepository.findOne.mockResolvedValue({
      id: 'other-channel',
    } as Channel);
    videoRepository.findOne.mockResolvedValue(buildDraftVideo());

    await expect(
      service.createUploadPartUrls('user-1', 'video-1', {
        partNumbers: [1],
      }),
    ).rejects.toThrow(VideoForbiddenException);
  });

  it('should reject part signing outside draft state', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildDraftVideo({ status: VideoStatus.PROCESSING }),
    );

    await expect(
      service.createUploadPartUrls('user-1', 'video-1', {
        partNumbers: [1],
      }),
    ).rejects.toThrow(VideoInvalidUploadStateException);
  });

  it('should reject part signing outside the video part count', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildDraftVideo({ part_count: 1 }),
    );

    await expect(
      service.createUploadPartUrls('user-1', 'video-1', {
        partNumbers: [2],
      }),
    ).rejects.toThrow(VideoInvalidPartsException);
    expect(storageService.createPresignedUploadPartUrls).not.toHaveBeenCalled();
  });

  it('should complete upload, set processing status, and enqueue processing job', async () => {
    const video = buildDraftVideo();
    videoRepository.findOne.mockResolvedValue(video);

    await expect(
      service.completeUpload('user-1', 'video-1', {
        parts: [
          { partNumber: 1, eTag: '"etag-1"' },
          { partNumber: 2, eTag: '"etag-2"' },
        ],
      }),
    ).resolves.toEqual({
      videoId: 'video-1',
      publicId: 'public-id',
      status: VideoStatus.PROCESSING,
    });

    expect(storageService.completeMultipartUpload).toHaveBeenCalledWith({
      key: 'original-key',
      uploadId: 'upload-1',
      parts: [
        { partNumber: 1, eTag: '"etag-1"' },
        { partNumber: 2, eTag: '"etag-2"' },
      ],
    });
    expect(queueService.enqueueProcessingJob).toHaveBeenCalledWith({
      videoId: 'video-1',
      channelId: 'channel-1',
      originalFileKey: 'original-key',
    });
    expect(video.status).toBe(VideoStatus.PROCESSING);
    expect(video.processing_job_id).toBe('process-video-video-1');
  });

  it('should reject completion when the part list does not match part_count', async () => {
    videoRepository.findOne.mockResolvedValue(buildDraftVideo());

    await expect(
      service.completeUpload('user-1', 'video-1', {
        parts: [{ partNumber: 1, eTag: '"etag-1"' }],
      }),
    ).rejects.toThrow(VideoInvalidPartsException);
  });

  it('should mark the video as error when queue publication fails', async () => {
    const video = buildDraftVideo();
    videoRepository.findOne.mockResolvedValue(video);
    queueService.enqueueProcessingJob.mockRejectedValue(new Error('Redis'));

    await expect(
      service.completeUpload('user-1', 'video-1', {
        parts: [
          { partNumber: 1, eTag: '"etag-1"' },
          { partNumber: 2, eTag: '"etag-2"' },
        ],
      }),
    ).rejects.toThrow(VideoQueueFailedException);

    expect(video.status).toBe(VideoStatus.ERROR);
    expect(video.processing_error_code).toBe('VIDEO_QUEUE_FAILED');
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });

  it('should abort the multipart upload and delete the draft video', async () => {
    const video = buildDraftVideo();
    videoRepository.findOne.mockResolvedValue(video);

    await service.abortUpload('user-1', 'video-1');

    expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
      'original-key',
      'upload-1',
    );
    expect(videoRepository.delete).toHaveBeenCalledWith({ id: 'video-1' });
  });

  it('should return owner status with error fields', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildDraftVideo({
        status: VideoStatus.ERROR,
        processing_error_code: 'VIDEO_QUEUE_FAILED',
        processing_error_message: 'Queue failed',
      }),
    );

    await expect(service.getOwnerStatus('user-1', 'video-1')).resolves.toEqual({
      videoId: 'video-1',
      publicId: 'public-id',
      status: VideoStatus.ERROR,
      processingErrorCode: 'VIDEO_QUEUE_FAILED',
      processingErrorMessage: 'Queue failed',
    });
  });

  it('should return owner status with thumbnail URL instead of storage key', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildDraftVideo({
        status: VideoStatus.READY,
        thumbnail_key:
          'channels/channel-1/videos/video-1/thumbnails/default.jpg',
      }),
    );

    await expect(service.getOwnerStatus('user-1', 'video-1')).resolves.toEqual({
      videoId: 'video-1',
      publicId: 'public-id',
      status: VideoStatus.READY,
      thumbnailUrl: '/videos/public-id/thumbnail',
    });
  });

  it('should return public metadata only for ready videos', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildDraftVideo({
        status: VideoStatus.READY,
        duration_seconds: 42,
        thumbnail_key:
          'channels/channel-1/videos/video-1/thumbnails/default.jpg',
      }),
    );

    await expect(service.getPublicMetadata('public-id')).resolves.toEqual({
      publicId: 'public-id',
      title: 'Video title',
      status: VideoStatus.READY,
      durationSeconds: 42,
      thumbnailUrl: '/videos/public-id/thumbnail',
    });
  });

  it('should hide non-ready videos from public metadata', async () => {
    videoRepository.findOne.mockResolvedValue(buildDraftVideo());

    await expect(service.getPublicMetadata('public-id')).rejects.toThrow(
      VideoNotFoundException,
    );
  });
});
