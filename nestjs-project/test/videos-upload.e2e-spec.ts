import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/video-processing-queue.constants';
import type { VideoProcessingJobData } from '../src/videos/video-processing-queue.service';

describe('Videos upload API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let queue: Queue<VideoProcessingJobData>;

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
    videoRepository = dataSource.getRepository(Video);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    queue = moduleFixture.get<Queue<VideoProcessingJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await queue.drain(true);
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

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

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const token = await captureConfirmationToken(email, password);

    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token })
      .expect(204);

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return res.body.access_token;
  }

  function initiateUpload(accessToken: string, sizeBytes = 6 * 1024 * 1024) {
    return request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Integration Video',
        originalFileName: 'integration.mp4',
        mimeType: 'video/mp4',
        sizeBytes,
      });
  }

  it('should reject unauthenticated upload initiation', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({
        title: 'No auth',
        originalFileName: 'no-auth.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
      })
      .expect(401);
  });

  it('should create a draft upload for an authenticated channel owner', async () => {
    const accessToken = await registerConfirmAndLogin(
      'video-owner@example.com',
    );

    const res = await initiateUpload(accessToken).expect(201);

    expect(res.body).toMatchObject({
      publicId: expect.any(String),
      status: VideoStatus.DRAFT,
      uploadId: expect.any(String),
      partSizeBytes: 104_857_600,
      partCount: 1,
    });

    const stored = await videoRepository.findOneByOrFail({
      id: res.body.videoId,
    });
    expect(stored.status).toBe(VideoStatus.DRAFT);
    expect(stored.upload_id).toBe(res.body.uploadId);
  });

  it('should return 413 for uploads above 10GB', async () => {
    const accessToken = await registerConfirmAndLogin('too-large@example.com');

    const res = await initiateUpload(accessToken, 10_737_418_241).expect(413);

    expect(res.body.error).toBe('VIDEO_UPLOAD_TOO_LARGE');
  });

  it('should return 415 for unsupported MIME types', async () => {
    const accessToken = await registerConfirmAndLogin('bad-type@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Bad type',
        originalFileName: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      })
      .expect(415);

    expect(res.body.error).toBe('VIDEO_UNSUPPORTED_TYPE');
  });

  it('should sign parts, complete upload, and enqueue processing', async () => {
    const accessToken = await registerConfirmAndLogin('complete@example.com');
    const initiated = await initiateUpload(accessToken).expect(201);

    const partsRes = await request(app.getHttpServer())
      .post(`/videos/uploads/${initiated.body.videoId}/parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ partNumbers: [1] })
      .expect(200);

    const [part] = partsRes.body.parts;
    const uploadResponse = await fetch(part.uploadUrl, {
      method: 'PUT',
      body: Buffer.alloc(6 * 1024 * 1024, 'v'),
    });
    expect(uploadResponse.ok).toBe(true);

    const eTag = uploadResponse.headers.get('etag');
    expect(eTag).toBeTruthy();

    const completeRes = await request(app.getHttpServer())
      .post(`/videos/uploads/${initiated.body.videoId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ partNumber: 1, eTag }] });

    if (completeRes.status !== 200) {
      throw new Error(
        `complete upload failed: ${completeRes.status} ${JSON.stringify(
          completeRes.body,
        )}`,
      );
    }
    expect(completeRes.body).toMatchObject({
      videoId: initiated.body.videoId,
      publicId: initiated.body.publicId,
      status: VideoStatus.PROCESSING,
    });

    const job = await queue.getJob(`process-video-${initiated.body.videoId}`);
    expect(job?.data).toEqual({
      videoId: initiated.body.videoId,
      channelId: expect.any(String),
      originalFileKey: expect.stringContaining(initiated.body.videoId),
    });

    const statusRes = await request(app.getHttpServer())
      .get(`/videos/uploads/${initiated.body.videoId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(statusRes.body.status).toBe(VideoStatus.PROCESSING);
  }, 30000);

  it('should reject upload part signing by a non-owner', async () => {
    const ownerToken = await registerConfirmAndLogin('owner@example.com');
    const otherToken = await registerConfirmAndLogin('other@example.com');
    const initiated = await initiateUpload(ownerToken).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/videos/uploads/${initiated.body.videoId}/parts`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ partNumbers: [1] })
      .expect(403);

    expect(res.body.error).toBe('VIDEO_FORBIDDEN');
  });

  it('should abort a draft upload and remove the video row', async () => {
    const accessToken = await registerConfirmAndLogin('abort@example.com');
    const initiated = await initiateUpload(accessToken).expect(201);

    await request(app.getHttpServer())
      .delete(`/videos/uploads/${initiated.body.videoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await expect(
      videoRepository.findOneBy({ id: initiated.body.videoId }),
    ).resolves.toBeNull();
  });
});
