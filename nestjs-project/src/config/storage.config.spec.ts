import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';

const storageEnvKeys = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_VIDEO_BUCKET',
  'STORAGE_THUMBNAIL_BUCKET',
  'STORAGE_FORCE_PATH_STYLE',
  'STORAGE_PRESIGNED_URL_TTL_SECONDS',
];

const clearStorageEnv = () => {
  for (const key of storageEnvKeys) {
    delete process.env[key];
  }
};

const loadConfig = async (
  env: Record<string, string> = {},
): Promise<ConfigType<typeof storageConfig>> => {
  clearStorageEnv();
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [storageConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof storageConfig>>(
    storageConfig.KEY,
  );
  await module.close();
  return config;
};

describe('storageConfig', () => {
  afterEach(clearStorageEnv);

  it('should return Docker Compose compatible defaults', async () => {
    const config = await loadConfig();

    expect(config).toEqual({
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      accessKey: 'streamtube',
      secretKey: 'streamtube-secret',
      videoBucket: 'streamtube-videos',
      thumbnailBucket: 'streamtube-thumbnails',
      forcePathStyle: true,
      presignedUrlTtlSeconds: 900,
    });
  });

  it('should parse custom endpoint, buckets, path-style flag, and URL TTL', async () => {
    const config = await loadConfig({
      STORAGE_ENDPOINT: 'https://storage.example.com',
      STORAGE_REGION: 'sa-east-1',
      STORAGE_ACCESS_KEY: 'access',
      STORAGE_SECRET_KEY: 'secret',
      STORAGE_VIDEO_BUCKET: 'videos',
      STORAGE_THUMBNAIL_BUCKET: 'thumbs',
      STORAGE_FORCE_PATH_STYLE: 'false',
      STORAGE_PRESIGNED_URL_TTL_SECONDS: '300',
    });

    expect(config).toMatchObject({
      endpoint: 'https://storage.example.com',
      region: 'sa-east-1',
      accessKey: 'access',
      secretKey: 'secret',
      videoBucket: 'videos',
      thumbnailBucket: 'thumbs',
      forcePathStyle: false,
      presignedUrlTtlSeconds: 300,
    });
  });
});
