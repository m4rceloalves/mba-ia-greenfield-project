import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import storageConfig from '../../config/storage.config';
import { VideoStorageService } from './video-storage.service';

const createS3Client = () => {
  const config = storageConfig();

  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
};

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

describe('VideoStorageService (integration)', () => {
  const config = storageConfig();
  let client: S3Client;
  let service: VideoStorageService;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    client = createS3Client();
    service = new VideoStorageService(client, config);
    await ensureBucket(client, config.videoBucket);
    await ensureBucket(client, config.thumbnailBucket);
  }, 30000);

  afterEach(async () => {
    await Promise.all(
      createdKeys.splice(0).map((key) =>
        client.send(
          new DeleteObjectCommand({
            Bucket: config.videoBucket,
            Key: key,
          }),
        ),
      ),
    );
  });

  afterAll(() => {
    client.destroy();
  });

  it('should complete a multipart upload and read the object by byte range', async () => {
    const { key, uploadId } = await service.createMultipartUpload({
      channelId: 'integration-channel',
      videoId: `integration-video-${Date.now()}`,
      originalFileName: 'sample.mp4',
      mimeType: 'video/mp4',
    });
    createdKeys.push(key);

    const [part] = await service.createPresignedUploadPartUrls({
      key,
      uploadId,
      partNumbers: [1],
    });

    const body = Buffer.alloc(6 * 1024 * 1024, 'a');
    const uploadResponse = await fetch(part.uploadUrl, {
      method: 'PUT',
      body,
    });
    expect(uploadResponse.ok).toBe(true);

    const eTag = uploadResponse.headers.get('etag');
    expect(eTag).toBeTruthy();

    await service.completeMultipartUpload({
      key,
      uploadId,
      parts: [{ partNumber: 1, eTag: eTag! }],
    });

    await expect(service.headOriginalObject(key)).resolves.toMatchObject({
      contentLength: body.length,
      contentType: 'video/mp4',
    });

    const stream = await service.getOriginalObjectStream({
      key,
      range: 'bytes=0-9',
    });
    const streamBody = stream.body as {
      transformToByteArray: () => Promise<Uint8Array>;
    };
    const bytes = await streamBody.transformToByteArray();

    expect(Buffer.from(bytes).toString()).toBe('aaaaaaaaaa');
    expect(stream.contentLength).toBe(10);
  }, 30000);

  it('should abort an unfinished multipart upload', async () => {
    const { key, uploadId } = await service.createMultipartUpload({
      channelId: 'integration-channel',
      videoId: `integration-abort-${Date.now()}`,
      originalFileName: 'abort.mp4',
      mimeType: 'video/mp4',
    });

    await expect(
      service.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  }, 30000);
});
