import { writeFile } from 'node:fs/promises';
import type { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import { Video, VideoStatus } from '../entities/video.entity';
import { PROCESS_VIDEO_JOB } from '../video-processing-queue.constants';
import type { VideoProcessingJobData } from '../video-processing-queue.service';
import { VideoStorageService } from '../storage/video-storage.service';
import { VideoMediaProbeService } from './video-media-probe.service';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoThumbnailService } from './video-thumbnail.service';

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-1',
    channel_id: 'channel-1',
    title: 'Video title',
    public_id: 'public-id',
    status: VideoStatus.PROCESSING,
    original_file_name: 'video.mp4',
    mime_type: 'video/mp4',
    size_bytes: 1024,
    original_file_key: 'original-key',
    thumbnail_key: null,
    upload_id: 'upload-1',
    part_size_bytes: 104_857_600,
    part_count: 1,
    duration_seconds: null,
    metadata: null,
    processing_job_id: 'process-video-video-1',
    processing_error_code: null,
    processing_error_message: null,
    processing_error_details: null,
    upload_completed_at: new Date(),
    processed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: {} as Video['channel'],
    ...overrides,
  };
}

function buildJob(overrides: Partial<Job<VideoProcessingJobData>> = {}) {
  return {
    id: 'process-video-video-1',
    name: PROCESS_VIDEO_JOB,
    data: {
      videoId: 'video-1',
      channelId: 'channel-1',
      originalFileKey: 'original-key',
    },
    attemptsMade: 0,
    opts: { attempts: 1 },
    ...overrides,
  } as Job<VideoProcessingJobData>;
}

describe('VideoProcessingProcessor', () => {
  let videoRepository: jest.Mocked<Repository<Video>>;
  let storageService: jest.Mocked<VideoStorageService>;
  let probeService: jest.Mocked<VideoMediaProbeService>;
  let thumbnailService: jest.Mocked<VideoThumbnailService>;
  let processor: VideoProcessingProcessor;

  beforeEach(() => {
    videoRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (video) => video as Video),
    } as unknown as jest.Mocked<Repository<Video>>;
    storageService = {
      getOriginalObjectStream: jest.fn().mockResolvedValue({
        body: {
          transformToByteArray: async () => Buffer.from('video-bytes'),
        },
      }),
      buildThumbnailKey: jest
        .fn()
        .mockReturnValue(
          'channels/channel-1/videos/video-1/thumbnails/default.jpg',
        ),
      putThumbnail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VideoStorageService>;
    probeService = {
      probe: jest.fn().mockResolvedValue({
        durationSeconds: 12,
        metadata: { format: { duration: '12.0' }, streams: [] },
      }),
    } as unknown as jest.Mocked<VideoMediaProbeService>;
    thumbnailService = {
      generate: jest.fn(async (_inputPath: string, outputPath: string) => {
        await writeFile(outputPath, Buffer.from('thumbnail'));
        return outputPath;
      }),
    } as unknown as jest.Mocked<VideoThumbnailService>;

    processor = new VideoProcessingProcessor(
      videoRepository,
      storageService,
      probeService,
      thumbnailService,
    );
  });

  it('should process a video and mark it ready', async () => {
    const video = buildVideo();
    videoRepository.findOne.mockResolvedValue(video);

    await processor.process(buildJob());

    expect(storageService.getOriginalObjectStream).toHaveBeenCalledWith({
      key: 'original-key',
    });
    expect(probeService.probe).toHaveBeenCalled();
    expect(thumbnailService.generate).toHaveBeenCalled();
    expect(storageService.putThumbnail).toHaveBeenCalledWith({
      key: 'channels/channel-1/videos/video-1/thumbnails/default.jpg',
      body: Buffer.from('thumbnail'),
    });
    expect(video.status).toBe(VideoStatus.READY);
    expect(video.duration_seconds).toBe(12);
    expect(video.thumbnail_key).toBe(
      'channels/channel-1/videos/video-1/thumbnails/default.jpg',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });

  it('should skip videos that are already ready', async () => {
    videoRepository.findOne.mockResolvedValue(
      buildVideo({ status: VideoStatus.READY }),
    );

    await processor.process(buildJob());

    expect(storageService.getOriginalObjectStream).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
  });

  it('should persist processing error on the final attempt', async () => {
    const video = buildVideo();
    videoRepository.findOne.mockResolvedValue(video);
    storageService.getOriginalObjectStream.mockRejectedValue(
      new Error('storage unavailable'),
    );

    await expect(processor.process(buildJob())).rejects.toThrow(
      'storage unavailable',
    );

    expect(video.status).toBe(VideoStatus.ERROR);
    expect(video.processing_error_code).toBe('VIDEO_PROCESSING_FAILED');
    expect(video.processing_error_message).toBe('storage unavailable');
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });
});
