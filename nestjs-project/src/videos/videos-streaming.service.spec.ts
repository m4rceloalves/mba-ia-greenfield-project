import { Readable } from 'node:stream';
import type { Repository } from 'typeorm';
import {
  VideoNotFoundException,
  VideoRangeNotSatisfiableException,
  VideoStorageFailedException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import {
  type ObjectStream,
  VideoStorageService,
} from './storage/video-storage.service';
import { VideosStreamingService } from './videos-streaming.service';

const storageBody = (body: Readable): ObjectStream['body'] =>
  body as unknown as ObjectStream['body'];

function buildReadyVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-1',
    channel_id: 'channel-1',
    title: 'Video title',
    public_id: 'public-id',
    status: VideoStatus.READY,
    original_file_name: 'video.mp4',
    mime_type: 'video/mp4',
    size_bytes: 10,
    original_file_key: 'original-key',
    thumbnail_key: 'thumbnail-key',
    upload_id: null,
    part_size_bytes: 104_857_600,
    part_count: 1,
    duration_seconds: 3,
    metadata: null,
    processing_job_id: null,
    processing_error_code: null,
    processing_error_message: null,
    processing_error_details: null,
    upload_completed_at: new Date(),
    processed_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    channel: {} as Channel,
    ...overrides,
  };
}

describe('VideosStreamingService', () => {
  let videoRepository: jest.Mocked<Repository<Video>>;
  let storageService: jest.Mocked<VideoStorageService>;
  let service: VideosStreamingService;

  beforeEach(() => {
    videoRepository = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Video>>;
    storageService = {
      headOriginalObject: jest.fn(),
      getOriginalObjectStream: jest.fn(),
      headThumbnailObject: jest.fn(),
      getThumbnailObjectStream: jest.fn(),
    } as unknown as jest.Mocked<VideoStorageService>;
    service = new VideosStreamingService(videoRepository, storageService);
  });

  it('should stream a full ready video when no Range header is present', async () => {
    const body = Readable.from(Buffer.from('0123456789'));
    videoRepository.findOne.mockResolvedValue(buildReadyVideo());
    storageService.headOriginalObject.mockResolvedValue({
      contentLength: 10,
      contentType: 'video/mp4',
    });
    storageService.getOriginalObjectStream.mockResolvedValue({
      body: storageBody(body),
      contentLength: 10,
      contentType: 'video/mp4',
    });

    await expect(
      service.streamReadyVideo('public-id', undefined),
    ).resolves.toEqual({
      statusCode: 200,
      body,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': '10',
        'Content-Type': 'video/mp4',
      },
    });
    expect(storageService.getOriginalObjectStream).toHaveBeenCalledWith({
      key: 'original-key',
    });
  });

  it('should stream a ready video byte range', async () => {
    const body = Readable.from(Buffer.from('2345'));
    videoRepository.findOne.mockResolvedValue(buildReadyVideo());
    storageService.headOriginalObject.mockResolvedValue({
      contentLength: 10,
      contentType: 'video/mp4',
    });
    storageService.getOriginalObjectStream.mockResolvedValue({
      body: storageBody(body),
      contentLength: 4,
      contentType: 'video/mp4',
    });

    await expect(
      service.streamReadyVideo('public-id', 'bytes=2-5'),
    ).resolves.toEqual({
      statusCode: 206,
      body,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes 2-5/10',
        'Content-Length': '4',
        'Content-Type': 'video/mp4',
      },
    });
    expect(storageService.getOriginalObjectStream).toHaveBeenCalledWith({
      key: 'original-key',
      range: 'bytes=2-5',
    });
  });

  it('should stream a full ready video as an attachment for download', async () => {
    const body = Readable.from(Buffer.from('0123456789'));
    videoRepository.findOne.mockResolvedValue(buildReadyVideo());
    storageService.headOriginalObject.mockResolvedValue({
      contentLength: 10,
      contentType: 'video/mp4',
    });
    storageService.getOriginalObjectStream.mockResolvedValue({
      body: storageBody(body),
      contentLength: 10,
      contentType: 'video/mp4',
    });

    await expect(service.downloadReadyVideo('public-id')).resolves.toEqual({
      statusCode: 200,
      body,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Disposition':
          'attachment; filename="video.mp4"; filename*=UTF-8\'\'video.mp4',
        'Content-Length': '10',
        'Content-Type': 'video/mp4',
      },
    });
    expect(storageService.getOriginalObjectStream).toHaveBeenCalledWith({
      key: 'original-key',
    });
  });

  it('should stream a ready video thumbnail', async () => {
    const body = Readable.from(Buffer.from('thumbnail'));
    videoRepository.findOne.mockResolvedValue(buildReadyVideo());
    storageService.headThumbnailObject.mockResolvedValue({
      contentLength: 9,
      contentType: 'image/jpeg',
    });
    storageService.getThumbnailObjectStream.mockResolvedValue({
      body: storageBody(body),
      contentLength: 9,
      contentType: 'image/jpeg',
    });

    await expect(service.thumbnailReadyVideo('public-id')).resolves.toEqual({
      statusCode: 200,
      body,
      headers: {
        'Content-Length': '9',
        'Content-Type': 'image/jpeg',
      },
    });
    expect(storageService.getThumbnailObjectStream).toHaveBeenCalledWith(
      'thumbnail-key',
    );
  });

  it('should hide missing or non-ready videos', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildReadyVideo({ status: VideoStatus.PROCESSING }),
    );

    await expect(
      service.streamReadyVideo('public-id', undefined),
    ).rejects.toThrow(VideoNotFoundException);

    videoRepository.findOne.mockResolvedValue(null);

    await expect(
      service.streamReadyVideo('missing', undefined),
    ).rejects.toThrow(VideoNotFoundException);
  });

  it('should hide ready videos without thumbnails from thumbnail requests', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildReadyVideo({ thumbnail_key: null }),
    );

    await expect(service.thumbnailReadyVideo('public-id')).rejects.toThrow(
      VideoNotFoundException,
    );
  });

  it('should translate invalid ranges to a 416 domain exception', async () => {
    videoRepository.findOne.mockResolvedValue(buildReadyVideo());
    storageService.headOriginalObject.mockResolvedValue({
      contentLength: 10,
      contentType: 'video/mp4',
    });

    await expect(
      service.streamReadyVideo('public-id', 'bytes=10-11'),
    ).rejects.toThrow(VideoRangeNotSatisfiableException);
  });

  it('should fail explicitly if storage returns no stream body', async () => {
    videoRepository.findOne.mockResolvedValue(buildReadyVideo());
    storageService.headOriginalObject.mockResolvedValue({
      contentLength: 10,
      contentType: 'video/mp4',
    });
    storageService.getOriginalObjectStream.mockResolvedValue({
      body: undefined,
      contentLength: 10,
      contentType: 'video/mp4',
    });

    await expect(
      service.streamReadyVideo('public-id', undefined),
    ).rejects.toThrow(VideoStorageFailedException);
  });
});
