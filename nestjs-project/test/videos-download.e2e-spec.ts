import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type superagent from 'superagent';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import storageConfig from '../src/config/storage.config';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

type BinaryParserCallback = (error: Error | null, body: Buffer) => void;

const parseBinary = (
  response: superagent.Response,
  callback: BinaryParserCallback,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
};

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

describe('Videos download API (e2e)', () => {
  const config = storageConfig();
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let client: S3Client;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
    await ensureBucket(client, config.videoBucket);
    await ensureBucket(client, config.thumbnailBucket);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  }, 30000);

  afterAll(async () => {
    await Promise.all(
      createdKeys.splice(0).map((key) =>
        client.send(
          new DeleteObjectCommand({
            Bucket: key.includes('/thumbnails/')
              ? config.thumbnailBucket
              : config.videoBucket,
            Key: key,
          }),
        ),
      ),
    );
    client.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function createVideo(
    status: VideoStatus,
    body: Buffer,
    thumbnailBody?: Buffer,
  ): Promise<Video> {
    const suffix = `${Date.now().toString(36)}_${status}`;
    const user = await userRepository.save(
      userRepository.create({
        email: `download-${suffix}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Download Channel ${suffix}`,
        nickname: `download_${suffix}`,
        user_id: user.id,
      }),
    );
    const key = `channels/${channel.id}/videos/download-${suffix}/original/my-video.mp4`;
    const thumbnailKey = `channels/${channel.id}/videos/download-${suffix}/thumbnails/default.jpg`;
    createdKeys.push(key);

    if (status === VideoStatus.READY) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.videoBucket,
          Key: key,
          Body: body,
          ContentType: 'video/mp4',
        }),
      );

      if (thumbnailBody !== undefined) {
        createdKeys.push(thumbnailKey);
        await client.send(
          new PutObjectCommand({
            Bucket: config.thumbnailBucket,
            Key: thumbnailKey,
            Body: thumbnailBody,
            ContentType: 'image/jpeg',
          }),
        );
      }
    }

    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Ready Download Video',
        public_id: `download_${suffix}`,
        status,
        original_file_name: 'my-video.mp4',
        mime_type: 'video/mp4',
        size_bytes: body.length,
        original_file_key: key,
        thumbnail_key:
          status === VideoStatus.READY && thumbnailBody !== undefined
            ? thumbnailKey
            : null,
        upload_id: null,
        part_size_bytes: 104_857_600,
        part_count: 1,
        duration_seconds: status === VideoStatus.READY ? 1 : null,
        metadata: null,
        processing_job_id: null,
        processing_error_code: null,
        processing_error_message: null,
        processing_error_details: null,
        upload_completed_at: new Date(),
        processed_at: status === VideoStatus.READY ? new Date() : null,
      }),
    );
  }

  it('should download a ready video as an attachment stream', async () => {
    const video = await createVideo(
      VideoStatus.READY,
      Buffer.from('download-body'),
    );

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/download`)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('my-video.mp4');
    expect(res.headers['content-length']).toBe('13');
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.body.toString()).toBe('download-body');
  });

  it('should hide non-ready videos from public downloads', async () => {
    const video = await createVideo(
      VideoStatus.PROCESSING,
      Buffer.from('not-ready'),
    );

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/download`)
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });

  it('should stream a ready video thumbnail from the thumbnail bucket', async () => {
    const video = await createVideo(
      VideoStatus.READY,
      Buffer.from('download-body'),
      Buffer.from('thumbnail-body'),
    );

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/thumbnail`)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(res.headers['content-length']).toBe('14');
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body.toString()).toBe('thumbnail-body');
  });
});
