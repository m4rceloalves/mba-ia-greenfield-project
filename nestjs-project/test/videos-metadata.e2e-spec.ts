import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

describe('Videos metadata API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function createUserAndChannel(
    suffix = Date.now().toString(),
  ): Promise<{ user: User; channel: Channel }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `metadata-${suffix}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Metadata Channel ${suffix}`,
        nickname: `metadata_${suffix}`,
        user_id: user.id,
      }),
    );

    return { user, channel };
  }

  async function createVideo(
    channel: Channel,
    status: VideoStatus,
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Public Ready Video',
        public_id: `public_${Date.now()}`,
        status,
        original_file_name: 'ready.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
        original_file_key: `channels/${channel.id}/videos/original.mp4`,
        thumbnail_key:
          status === VideoStatus.READY
            ? `channels/${channel.id}/videos/thumb.jpg`
            : null,
        upload_id: 'upload-id',
        part_size_bytes: 104_857_600,
        part_count: 1,
        duration_seconds: status === VideoStatus.READY ? 15 : null,
        metadata: null,
        processing_job_id: null,
        processing_error_code: null,
        processing_error_message: null,
        processing_error_details: null,
        upload_completed_at: new Date(),
        processed_at: status === VideoStatus.READY ? new Date() : null,
        ...overrides,
      }),
    );
  }

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(
        async (_email: string, _name: string, token: string) => {
          capturedToken = token;
        },
      );

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    return capturedToken;
  }

  async function registerConfirmAndLogin(email: string): Promise<string> {
    const token = await captureConfirmationToken(email);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token })
      .expect(204);

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);

    return res.body.access_token;
  }

  it('should return public metadata for a ready video without auth', async () => {
    const { channel } = await createUserAndChannel('ready');
    const video = await createVideo(channel, VideoStatus.READY);

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}`)
      .expect(200);

    expect(res.body).toEqual({
      publicId: video.public_id,
      title: 'Public Ready Video',
      durationSeconds: 15,
      thumbnailUrl: `/videos/${video.public_id}/thumbnail`,
      status: VideoStatus.READY,
    });
  });

  it('should hide non-ready videos from public metadata', async () => {
    const { channel } = await createUserAndChannel('draft');
    const video = await createVideo(channel, VideoStatus.PROCESSING);

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}`)
      .expect(404);

    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  });

  it('should return owner status with persisted processing error fields', async () => {
    const email = 'metadata-owner@example.com';
    const accessToken = await registerConfirmAndLogin(email);
    const user = await userRepository.findOneByOrFail({ email });
    const channel = await channelRepository.findOneByOrFail({
      user_id: user.id,
    });
    const video = await createVideo(channel, VideoStatus.ERROR, {
      processing_error_code: 'VIDEO_QUEUE_FAILED',
      processing_error_message: 'Queue failed',
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/uploads/${video.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      videoId: video.id,
      publicId: video.public_id,
      status: VideoStatus.ERROR,
      processingErrorCode: 'VIDEO_QUEUE_FAILED',
      processingErrorMessage: 'Queue failed',
    });
  });
});
