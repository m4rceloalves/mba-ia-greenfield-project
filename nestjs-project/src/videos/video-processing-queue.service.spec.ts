import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing-queue.constants';
import { VideoProcessingQueueService } from './video-processing-queue.service';

const config: ConfigType<typeof queueConfig> = {
  redisHost: 'redis',
  redisPort: 6379,
  defaultAttempts: 3,
  backoffDelayMs: 5000,
};

describe('VideoProcessingQueueService', () => {
  it('should enqueue process-video jobs with deterministic job id and retry options', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'process-video-video-1' }),
    } as unknown as jest.Mocked<Queue>;
    const service = new VideoProcessingQueueService(queue, config);

    await expect(
      service.enqueueProcessingJob({
        videoId: 'video-1',
        channelId: 'channel-1',
        originalFileKey: 'original-key',
      }),
    ).resolves.toBe('process-video-video-1');

    expect(queue.add).toHaveBeenCalledWith(
      PROCESS_VIDEO_JOB,
      {
        videoId: 'video-1',
        channelId: 'channel-1',
        originalFileKey: 'original-key',
      },
      {
        jobId: 'process-video-video-1',
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    expect(VIDEO_PROCESSING_QUEUE).toBe('video-processing');
  });
});
