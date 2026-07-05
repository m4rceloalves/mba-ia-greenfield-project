import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing-queue.constants';

export interface VideoProcessingJobData {
  videoId: string;
  channelId: string;
  originalFileKey: string;
}

@Injectable()
export class VideoProcessingQueueService {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<VideoProcessingJobData>,
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {}

  async enqueueProcessingJob(data: VideoProcessingJobData): Promise<string> {
    const job = await this.queue.add(PROCESS_VIDEO_JOB, data, {
      jobId: `${PROCESS_VIDEO_JOB}-${data.videoId}`,
      attempts: this.config.defaultAttempts,
      backoff: {
        type: 'exponential',
        delay: this.config.backoffDelayMs,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    return String(job.id);
  }
}
