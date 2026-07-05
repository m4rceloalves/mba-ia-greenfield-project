import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../../config/storage.config';
import { VideoStorageService } from './video-storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const mockedGetSignedUrl = jest.mocked(getSignedUrl);

const config: ConfigType<typeof storageConfig> = {
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  accessKey: 'streamtube',
  secretKey: 'streamtube-secret',
  videoBucket: 'videos',
  thumbnailBucket: 'thumbs',
  forcePathStyle: true,
  presignedUrlTtlSeconds: 900,
};

describe('VideoStorageService', () => {
  let send: jest.Mock;
  let service: VideoStorageService;

  beforeEach(() => {
    send = jest.fn();
    service = new VideoStorageService({ send } as unknown as S3Client, config);
    mockedGetSignedUrl.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should build safe original and thumbnail keys', () => {
    expect(
      service.buildOriginalVideoKey({
        channelId: 'channel-1',
        videoId: 'video-1',
        originalFileName: 'folder/video name.mp4',
      }),
    ).toBe('channels/channel-1/videos/video-1/original/folder-video_name.mp4');

    expect(service.buildThumbnailKey('channel-1', 'video-1')).toBe(
      'channels/channel-1/videos/video-1/thumbnails/default.jpg',
    );
  });

  it('should calculate the part count for a 10GB upload using 100MiB parts', () => {
    expect(service.calculatePartCount(10_737_418_240, 104_857_600)).toBe(103);
  });

  it('should reject invalid part-count inputs', () => {
    expect(() => service.calculatePartCount(0, 104_857_600)).toThrow(
      'sizeBytes',
    );
    expect(() => service.calculatePartCount(1024, 0)).toThrow('partSizeBytes');
  });

  it('should create a multipart upload in the video bucket', async () => {
    send.mockResolvedValue({ UploadId: 'upload-1' });

    const result = await service.createMultipartUpload({
      channelId: 'channel-1',
      videoId: 'video-1',
      originalFileName: 'video.mp4',
      mimeType: 'video/mp4',
    });

    expect(result).toEqual({
      key: 'channels/channel-1/videos/video-1/original/video.mp4',
      uploadId: 'upload-1',
    });

    const command = send.mock.calls[0][0] as CreateMultipartUploadCommand;
    expect(command).toBeInstanceOf(CreateMultipartUploadCommand);
    expect(command.input).toMatchObject({
      Bucket: 'videos',
      Key: 'channels/channel-1/videos/video-1/original/video.mp4',
      ContentType: 'video/mp4',
    });
  });

  it('should reject multipart upload creation when storage returns no upload id', async () => {
    send.mockResolvedValue({});

    await expect(
      service.createMultipartUpload({
        channelId: 'channel-1',
        videoId: 'video-1',
        originalFileName: 'video.mp4',
        mimeType: 'video/mp4',
      }),
    ).rejects.toThrow('multipart upload id');
  });

  it('should create sorted presigned upload part URLs', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-05T12:00:00.000Z'));
    mockedGetSignedUrl.mockImplementation(async (_client, command) => {
      const uploadPartCommand = command as UploadPartCommand;
      return `https://signed/${uploadPartCommand.input.PartNumber}`;
    });

    const result = await service.createPresignedUploadPartUrls({
      key: 'video-key',
      uploadId: 'upload-1',
      partNumbers: [2, 1],
    });

    expect(result.map((part) => part.partNumber)).toEqual([1, 2]);
    expect(result.map((part) => part.uploadUrl)).toEqual([
      'https://signed/1',
      'https://signed/2',
    ]);
    expect(result[0].expiresAt.toISOString()).toBe('2026-07-05T12:15:00.000Z');
    expect(mockedGetSignedUrl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(UploadPartCommand),
      { expiresIn: 900 },
    );
  });

  it('should reject duplicate or out-of-range part numbers', async () => {
    await expect(
      service.createPresignedUploadPartUrls({
        key: 'video-key',
        uploadId: 'upload-1',
        partNumbers: [1, 1],
      }),
    ).rejects.toThrow('Duplicate');

    await expect(
      service.createPresignedUploadPartUrls({
        key: 'video-key',
        uploadId: 'upload-1',
        partNumbers: [10001],
      }),
    ).rejects.toThrow('between 1 and 10000');
  });

  it('should complete multipart upload with sorted completed parts', async () => {
    send.mockResolvedValue({});

    await service.completeMultipartUpload({
      key: 'video-key',
      uploadId: 'upload-1',
      parts: [
        { partNumber: 2, eTag: '"etag-2"' },
        { partNumber: 1, eTag: '"etag-1"' },
      ],
    });

    const command = send.mock.calls[0][0] as CompleteMultipartUploadCommand;
    expect(command).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(command.input.MultipartUpload?.Parts).toEqual([
      { ETag: '"etag-1"', PartNumber: 1 },
      { ETag: '"etag-2"', PartNumber: 2 },
    ]);
  });

  it('should reject completed parts without ETags', async () => {
    await expect(
      service.completeMultipartUpload({
        key: 'video-key',
        uploadId: 'upload-1',
        parts: [{ partNumber: 1, eTag: ' ' }],
      }),
    ).rejects.toThrow('ETag');
  });

  it('should abort a multipart upload in the video bucket', async () => {
    send.mockResolvedValue({});

    await service.abortMultipartUpload('video-key', 'upload-1');

    const command = send.mock.calls[0][0] as AbortMultipartUploadCommand;
    expect(command).toBeInstanceOf(AbortMultipartUploadCommand);
    expect(command.input).toMatchObject({
      Bucket: 'videos',
      Key: 'video-key',
      UploadId: 'upload-1',
    });
  });

  it('should read original object metadata', async () => {
    send.mockResolvedValue({
      ContentLength: 123,
      ContentType: 'video/mp4',
    });

    await expect(service.headOriginalObject('video-key')).resolves.toEqual({
      contentLength: 123,
      contentType: 'video/mp4',
    });

    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('should read thumbnail object metadata from the thumbnail bucket', async () => {
    send.mockResolvedValue({
      ContentLength: 321,
      ContentType: 'image/jpeg',
    });

    await expect(service.headThumbnailObject('thumbnail-key')).resolves.toEqual(
      {
        contentLength: 321,
        contentType: 'image/jpeg',
      },
    );

    const command = send.mock.calls[0][0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'thumbs',
      Key: 'thumbnail-key',
    });
  });

  it('should request an object stream with an optional byte range', async () => {
    send.mockResolvedValue({
      Body: 'stream-body',
      ContentLength: 10,
      ContentType: 'video/mp4',
    });

    await expect(
      service.getOriginalObjectStream({
        key: 'video-key',
        range: 'bytes=0-9',
      }),
    ).resolves.toEqual({
      body: 'stream-body',
      contentLength: 10,
      contentType: 'video/mp4',
    });

    const command = send.mock.calls[0][0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'videos',
      Key: 'video-key',
      Range: 'bytes=0-9',
    });
  });

  it('should request a thumbnail object stream from the thumbnail bucket', async () => {
    send.mockResolvedValue({
      Body: 'thumbnail-stream',
      ContentLength: 15,
      ContentType: 'image/jpeg',
    });

    await expect(
      service.getThumbnailObjectStream('thumbnail-key'),
    ).resolves.toEqual({
      body: 'thumbnail-stream',
      contentLength: 15,
      contentType: 'image/jpeg',
    });

    const command = send.mock.calls[0][0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'thumbs',
      Key: 'thumbnail-key',
    });
  });

  it('should upload thumbnails to the thumbnail bucket', async () => {
    send.mockResolvedValue({});
    const body = Buffer.from('thumbnail');

    await service.putThumbnail({
      key: 'thumbnail-key',
      body,
    });

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'thumbs',
      Key: 'thumbnail-key',
      Body: body,
      ContentType: 'image/jpeg',
    });
  });
});
