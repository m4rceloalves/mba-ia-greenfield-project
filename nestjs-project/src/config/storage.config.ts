import { registerAs } from '@nestjs/config';

const parseBoolean = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) {
    return defaultValue;
  }

  return value === 'true';
};

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY || 'streamtube',
  secretKey: process.env.STORAGE_SECRET_KEY || 'streamtube-secret',
  videoBucket: process.env.STORAGE_VIDEO_BUCKET || 'streamtube-videos',
  thumbnailBucket:
    process.env.STORAGE_THUMBNAIL_BUCKET || 'streamtube-thumbnails',
  forcePathStyle: parseBoolean(process.env.STORAGE_FORCE_PATH_STYLE, true),
  presignedUrlTtlSeconds: parseInt(
    process.env.STORAGE_PRESIGNED_URL_TTL_SECONDS || '900',
    10,
  ),
}));
