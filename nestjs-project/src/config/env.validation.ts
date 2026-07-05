import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('db'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  STORAGE_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  STORAGE_REGION: Joi.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  STORAGE_VIDEO_BUCKET: Joi.string().default('streamtube-videos'),
  STORAGE_THUMBNAIL_BUCKET: Joi.string().default('streamtube-thumbnails'),
  STORAGE_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  STORAGE_PRESIGNED_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .default(900),
  QUEUE_REDIS_HOST: Joi.string().default('redis'),
  QUEUE_REDIS_PORT: Joi.number().port().default(6379),
  QUEUE_DEFAULT_ATTEMPTS: Joi.number().integer().min(1).default(3),
  QUEUE_BACKOFF_DELAY_MS: Joi.number().integer().min(0).default(5000),
  VIDEO_MAX_UPLOAD_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(10737418240)
    .default(10737418240),
  VIDEO_MULTIPART_PART_SIZE_BYTES: Joi.number()
    .integer()
    .min(5242880)
    .default(104857600),
  VIDEO_ALLOWED_MIME_TYPES: Joi.string().default(
    'video/mp4,video/webm,video/quicktime',
  ),
  VIDEO_PROCESSING_TIMEOUT_MS: Joi.number().integer().min(1000).default(120000),
});
