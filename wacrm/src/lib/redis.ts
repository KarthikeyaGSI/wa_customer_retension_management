// ============================================================
// Redis Client — Single shared instance for rate limiting, queues, etc.
// ============================================================

import Redis from 'ioredis';

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    _redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      enableReadyCheck: true,
      lazyConnect: true,
    });
    _redis.on('error', (err) => console.error('[redis] error:', err.message));
    _redis.on('connect', () => console.log('[redis] connected'));
  }
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}