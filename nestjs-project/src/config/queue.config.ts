import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redisHost: process.env.QUEUE_REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.QUEUE_REDIS_PORT || '6379', 10),
  defaultAttempts: parseInt(process.env.QUEUE_DEFAULT_ATTEMPTS || '3', 10),
  backoffDelayMs: parseInt(process.env.QUEUE_BACKOFF_DELAY_MS || '5000', 10),
}));
