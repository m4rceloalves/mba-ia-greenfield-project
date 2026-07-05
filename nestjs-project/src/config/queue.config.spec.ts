import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from './queue.config';

const queueEnvKeys = [
  'QUEUE_REDIS_HOST',
  'QUEUE_REDIS_PORT',
  'QUEUE_DEFAULT_ATTEMPTS',
  'QUEUE_BACKOFF_DELAY_MS',
];

const clearQueueEnv = () => {
  for (const key of queueEnvKeys) {
    delete process.env[key];
  }
};

const loadConfig = async (
  env: Record<string, string> = {},
): Promise<ConfigType<typeof queueConfig>> => {
  clearQueueEnv();
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [queueConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY);
  await module.close();
  return config;
};

describe('queueConfig', () => {
  afterEach(clearQueueEnv);

  it('should return Redis defaults using the Docker Compose service name', async () => {
    const config = await loadConfig();

    expect(config).toEqual({
      redisHost: 'redis',
      redisPort: 6379,
      defaultAttempts: 3,
      backoffDelayMs: 5000,
    });
  });

  it('should parse custom Redis connection and retry values', async () => {
    const config = await loadConfig({
      QUEUE_REDIS_HOST: 'queue',
      QUEUE_REDIS_PORT: '6380',
      QUEUE_DEFAULT_ATTEMPTS: '5',
      QUEUE_BACKOFF_DELAY_MS: '2500',
    });

    expect(config).toEqual({
      redisHost: 'queue',
      redisPort: 6380,
      defaultAttempts: 5,
      backoffDelayMs: 2500,
    });
  });
});
