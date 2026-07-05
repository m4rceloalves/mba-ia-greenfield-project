import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { Queue, type Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import queueConfig from '../../config/queue.config';
import videoConfig from '../../config/video.config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../video-processing-queue.constants';
import type { VideoProcessingJobData } from '../video-processing-queue.service';
import { VideoStorageService } from '../storage/video-storage.service';
import { VideoMediaProcessRunner } from './video-media-process-runner.service';
import { VideoMediaProbeService } from './video-media-probe.service';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoWorkerModule } from './video-worker.module';
import { VideoThumbnailService } from './video-thumbnail.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const PROCESSING_WAIT_TIMEOUT_MS = 30_000;

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

function buildJob(video: Video): Job<VideoProcessingJobData> {
  return {
    id: `process-video-${video.id}`,
    name: PROCESS_VIDEO_JOB,
    data: {
      videoId: video.id,
      channelId: video.channel_id,
      originalFileKey: video.original_file_key,
    },
    attemptsMade: 0,
    opts: { attempts: 1 },
  } as Job<VideoProcessingJobData>;
}

describe('VideoProcessingProcessor (integration)', () => {
  const s3Config = storageConfig();
  const qConfig = queueConfig();
  const vConfig = videoConfig();
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let s3Client: S3Client;
  let storageService: VideoStorageService;
  let runner: VideoMediaProcessRunner;
  let queue: Queue<VideoProcessingJobData>;
  const createdObjects: Array<{ bucket: string; key: string }> = [];

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    s3Client = new S3Client({
      endpoint: s3Config.endpoint,
      region: s3Config.region,
      forcePathStyle: s3Config.forcePathStyle,
      credentials: {
        accessKeyId: s3Config.accessKey,
        secretAccessKey: s3Config.secretKey,
      },
    });
    await ensureBucket(s3Client, s3Config.videoBucket);
    await ensureBucket(s3Client, s3Config.thumbnailBucket);
    storageService = new VideoStorageService(s3Client, s3Config);
    runner = new VideoMediaProcessRunner();
    queue = new Queue<VideoProcessingJobData>(VIDEO_PROCESSING_QUEUE, {
      connection: {
        host: qConfig.redisHost,
        port: qConfig.redisPort,
      },
    });
  }, 30000);

  afterAll(async () => {
    await queue?.close();
    await dataSource.destroy();
    s3Client.destroy();
  });

  beforeEach(async () => {
    await queue.drain(true);
    await cleanAllTables(dataSource);
  });

  afterEach(async () => {
    await Promise.all(
      createdObjects.splice(0).map((object) =>
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: object.bucket,
            Key: object.key,
          }),
        ),
      ),
    );
  });

  async function createProcessingVideo(): Promise<Video> {
    const user = await userRepository.save(
      userRepository.create({
        email: `processor-${Date.now()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Processor Channel',
        nickname: `processor_${Date.now()}`,
        user_id: user.id,
      }),
    );
    const videoId = randomUUID();
    const originalKey = storageService.buildOriginalVideoKey({
      channelId: channel.id,
      videoId,
      originalFileName: 'fixture.mp4',
    });

    const fixturePath = join(tmpdir(), `streamtube-fixture-${videoId}.mp4`);
    await runner.run(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=16x16:rate=1',
        '-t',
        '2',
        '-pix_fmt',
        'yuv420p',
        fixturePath,
      ],
      vConfig.processingTimeoutMs,
    );

    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Config.videoBucket,
        Key: originalKey,
        Body: await readFile(fixturePath),
        ContentType: 'video/mp4',
      }),
    );
    await rm(fixturePath, { force: true });
    createdObjects.push({ bucket: s3Config.videoBucket, key: originalKey });

    return videoRepository.save(
      videoRepository.create({
        id: videoId,
        channel_id: channel.id,
        title: 'Processor Fixture',
        public_id: `processor_${Date.now()}`,
        status: VideoStatus.PROCESSING,
        original_file_name: 'fixture.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
        original_file_key: originalKey,
        thumbnail_key: null,
        upload_id: 'upload-id',
        part_size_bytes: 104_857_600,
        part_count: 1,
        duration_seconds: null,
        metadata: null,
        processing_job_id: `process-video-${videoId}`,
        processing_error_code: null,
        processing_error_message: null,
        processing_error_details: null,
        upload_completed_at: new Date(),
        processed_at: null,
      }),
    );
  }

  it('should process an uploaded object and persist ready video metadata', async () => {
    const video = await createProcessingVideo();
    const processor = new VideoProcessingProcessor(
      videoRepository,
      storageService,
      new VideoMediaProbeService(runner, vConfig),
      new VideoThumbnailService(runner, vConfig),
    );

    await processor.process(buildJob(video));

    const processed = await videoRepository.findOneByOrFail({ id: video.id });
    expect(processed.status).toBe(VideoStatus.READY);
    expect(processed.duration_seconds).toBeGreaterThanOrEqual(1);
    expect(processed.metadata).toEqual(
      expect.objectContaining({
        format: expect.any(Object),
        streams: expect.any(Array),
      }),
    );
    expect(processed.thumbnail_key).toBe(
      storageService.buildThumbnailKey(video.channel_id, video.id),
    );
    expect(processed.processed_at).toBeInstanceOf(Date);

    createdObjects.push({
      bucket: s3Config.thumbnailBucket,
      key: processed.thumbnail_key!,
    });
    await expect(
      s3Client.send(
        new HeadObjectCommand({
          Bucket: s3Config.thumbnailBucket,
          Key: processed.thumbnail_key!,
        }),
      ),
    ).resolves.toBeDefined();
  }, 30000);

  it('should consume a real BullMQ job through the worker module', async () => {
    const video = await createProcessingVideo();
    const workerApp = await NestFactory.createApplicationContext(
      VideoWorkerModule,
      { logger: false, abortOnError: false },
    );

    try {
      await queue.add(
        PROCESS_VIDEO_JOB,
        {
          videoId: video.id,
          channelId: video.channel_id,
          originalFileKey: video.original_file_key,
        },
        {
          jobId: `process-video-${video.id}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );

      const processed = await waitForProcessedVideo(video.id);
      expect(processed.status).toBe(VideoStatus.READY);
      expect(processed.duration_seconds).toBeGreaterThanOrEqual(1);
      expect(processed.thumbnail_key).toBe(
        storageService.buildThumbnailKey(video.channel_id, video.id),
      );

      createdObjects.push({
        bucket: s3Config.thumbnailBucket,
        key: processed.thumbnail_key!,
      });
    } finally {
      await workerApp.close();
    }
  }, 45000);

  async function waitForProcessedVideo(videoId: string): Promise<Video> {
    const deadline = Date.now() + PROCESSING_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const video = await videoRepository.findOneByOrFail({ id: videoId });

      if (video.status === VideoStatus.READY) {
        return video;
      }

      if (video.status === VideoStatus.ERROR) {
        throw new Error(
          `Video processing failed: ${video.processing_error_message}`,
        );
      }

      await wait(500);
    }

    throw new Error('Timed out waiting for worker to process video job');
  }
});
