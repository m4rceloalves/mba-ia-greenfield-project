import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Repository } from 'typeorm';
import { Video, VideoStatus } from '../entities/video.entity';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../video-processing-queue.constants';
import type { VideoProcessingJobData } from '../video-processing-queue.service';
import { VideoStorageService } from '../storage/video-storage.service';
import { VideoMediaProbeService } from './video-media-probe.service';
import { VideoThumbnailService } from './video-thumbnail.service';

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: VideoStorageService,
    private readonly probeService: VideoMediaProbeService,
    private readonly thumbnailService: VideoThumbnailService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB) {
      throw new Error(`Unsupported video job: ${job.name}`);
    }

    const video = await this.videoRepository.findOne({
      where: { id: job.data.videoId },
    });

    if (!video) {
      throw new Error(`Video ${job.data.videoId} was not found`);
    }

    if (video.status === VideoStatus.READY) {
      return;
    }

    try {
      await this.processVideo(video);
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        video.status = VideoStatus.ERROR;
        video.processing_error_code = 'VIDEO_PROCESSING_FAILED';
        video.processing_error_message =
          error instanceof Error ? error.message : 'Video processing failed';
        video.processing_error_details = {
          attemptsMade: job.attemptsMade + 1,
          jobId: String(job.id),
        };
        await this.videoRepository.save(video);
      }

      throw error;
    }
  }

  private async processVideo(video: Video): Promise<void> {
    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const inputPath = join(workDir, 'original-video');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      const object = await this.storageService.getOriginalObjectStream({
        key: video.original_file_key,
      });
      await this.writeBodyToFile(object.body, inputPath);

      const probe = await this.probeService.probe(inputPath);
      await this.thumbnailService.generate(inputPath, thumbnailPath);

      const thumbnailKey = this.storageService.buildThumbnailKey(
        video.channel_id,
        video.id,
      );
      await this.storageService.putThumbnail({
        key: thumbnailKey,
        body: await readFile(thumbnailPath),
      });

      video.duration_seconds = probe.durationSeconds;
      video.metadata = probe.metadata;
      video.thumbnail_key = thumbnailKey;
      video.status = VideoStatus.READY;
      video.processed_at = new Date();
      video.processing_error_code = null;
      video.processing_error_message = null;
      video.processing_error_details = null;
      await this.videoRepository.save(video);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async writeBodyToFile(
    body: Awaited<
      ReturnType<VideoStorageService['getOriginalObjectStream']>
    >['body'],
    filePath: string,
  ): Promise<void> {
    if (!body) {
      throw new Error('Storage object body is empty');
    }

    if (body instanceof Readable) {
      await pipeline(body, createWriteStream(filePath));
      return;
    }

    if (
      typeof body === 'object' &&
      'transformToByteArray' in body &&
      typeof body.transformToByteArray === 'function'
    ) {
      const bytes = await body.transformToByteArray();
      await writeFile(filePath, Buffer.from(bytes));
      return;
    }

    throw new Error('Unsupported storage object body type');
  }

  private isFinalAttempt(job: Job): boolean {
    const attempts =
      typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    return job.attemptsMade + 1 >= attempts;
  }
}
