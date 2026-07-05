import { registerAs } from '@nestjs/config';

const parseAllowedMimeTypes = (value: string | undefined): string[] =>
  (value || 'video/mp4,video/webm,video/quicktime')
    .split(',')
    .map((mimeType) => mimeType.trim())
    .filter(Boolean);

export default registerAs('video', () => ({
  maxUploadBytes: parseInt(
    process.env.VIDEO_MAX_UPLOAD_BYTES || '10737418240',
    10,
  ),
  multipartPartSizeBytes: parseInt(
    process.env.VIDEO_MULTIPART_PART_SIZE_BYTES || '104857600',
    10,
  ),
  allowedMimeTypes: parseAllowedMimeTypes(process.env.VIDEO_ALLOWED_MIME_TYPES),
  processingTimeoutMs: parseInt(
    process.env.VIDEO_PROCESSING_TIMEOUT_MS || '120000',
    10,
  ),
}));
