import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY: 'streamtube',
  STORAGE_SECRET_KEY: 'streamtube-secret',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — Phase 03 video infrastructure', () => {
  it('should require STORAGE_ACCESS_KEY', () => {
    const { STORAGE_ACCESS_KEY, ...envWithoutAccessKey } = requiredEnv;
    const { error } = envValidationSchema.validate(envWithoutAccessKey, {
      allowUnknown: true,
      abortEarly: false,
    });

    expect(STORAGE_ACCESS_KEY).toBe('streamtube');
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
  });

  it('should require STORAGE_SECRET_KEY', () => {
    const { STORAGE_SECRET_KEY, ...envWithoutSecretKey } = requiredEnv;
    const { error } = envValidationSchema.validate(envWithoutSecretKey, {
      allowUnknown: true,
      abortEarly: false,
    });

    expect(STORAGE_SECRET_KEY).toBe('streamtube-secret');
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_SECRET_KEY');
  });

  it('should default to Docker Compose service names for database, storage, and queue', () => {
    const { value, error } = validate({});

    expect(error).toBeUndefined();
    expect(value.DB_HOST).toBe('db');
    expect(value.STORAGE_ENDPOINT).toBe('http://minio:9000');
    expect(value.QUEUE_REDIS_HOST).toBe('redis');
  });

  it('should reject upload limits above 10GB', () => {
    const { error } = validate({ VIDEO_MAX_UPLOAD_BYTES: '10737418241' });

    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_MAX_UPLOAD_BYTES');
  });

  it('should reject multipart part sizes below 5MiB', () => {
    const { error } = validate({ VIDEO_MULTIPART_PART_SIZE_BYTES: '5242879' });

    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_MULTIPART_PART_SIZE_BYTES');
  });
});
