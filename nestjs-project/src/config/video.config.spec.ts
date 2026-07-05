import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import videoConfig from './video.config';

const videoEnvKeys = [
  'VIDEO_MAX_UPLOAD_BYTES',
  'VIDEO_MULTIPART_PART_SIZE_BYTES',
  'VIDEO_ALLOWED_MIME_TYPES',
  'VIDEO_PROCESSING_TIMEOUT_MS',
];

const clearVideoEnv = () => {
  for (const key of videoEnvKeys) {
    delete process.env[key];
  }
};

const loadConfig = async (
  env: Record<string, string> = {},
): Promise<ConfigType<typeof videoConfig>> => {
  clearVideoEnv();
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [videoConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);
  await module.close();
  return config;
};

describe('videoConfig', () => {
  afterEach(clearVideoEnv);

  it('should return 10GB upload and 100MiB part-size defaults', async () => {
    const config = await loadConfig();

    expect(config).toEqual({
      maxUploadBytes: 10_737_418_240,
      multipartPartSizeBytes: 104_857_600,
      allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
      processingTimeoutMs: 120_000,
    });
  });

  it('should parse custom limits and trim the allowed MIME list', async () => {
    const config = await loadConfig({
      VIDEO_MAX_UPLOAD_BYTES: '1000',
      VIDEO_MULTIPART_PART_SIZE_BYTES: '500',
      VIDEO_ALLOWED_MIME_TYPES: 'video/mp4, video/webm, ,video/x-matroska',
      VIDEO_PROCESSING_TIMEOUT_MS: '60000',
    });

    expect(config).toEqual({
      maxUploadBytes: 1000,
      multipartPartSizeBytes: 500,
      allowedMimeTypes: ['video/mp4', 'video/webm', 'video/x-matroska'],
      processingTimeoutMs: 60_000,
    });
  });
});
