import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

const DEFAULT_TTL = 300; // 5 minutes

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly redis: Redis;

  constructor(redisService: RedisService) {
    this.redis = redisService.getOrThrow();
  }

  key(prefix: string, ...parts: string[]): string {
    return ['cache', prefix, ...parts].join(':');
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Cache GET error for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttl = DEFAULT_TTL): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.redis.setex(key, ttl, serialized);
    } catch (err) {
      this.logger.warn(`Cache SET error for ${key}: ${(err as Error).message}`);
    }
  }

  async wrap<T>(key: string, ttl: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      this.logger.debug(`[DEBUG_REDIS] CACHE HIT | key=${key}`);
      return cached;
    }
    this.logger.debug(`[DEBUG_REDIS] CACHE MISS | key=${key} | computing...`);
    const fresh = await factory();
    await this.set(key, fresh, ttl);
    this.logger.debug(`[DEBUG_REDIS] CACHE SET | key=${key} | ttl=${ttl}`);
    return fresh;
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`Cache DEL error for ${key}: ${(err as Error).message}`);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      let keys: string[] = [];
      do {
        const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys = result[1];
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
      this.logger.log(`Invalidated ${keys.length} key(s) matching ${pattern}`);
    } catch (err) {
      this.logger.warn(`Cache SCAN/DEL error for ${pattern}: ${(err as Error).message}`);
    }
  }

  async invalidateRecordingsCache(): Promise<void> {
    this.logger.debug(`[DEBUG_REDIS] CACHE INVALIDATED | pattern=cache:recordings:*`);
    await this.delByPattern('cache:recordings:*');
  }

  async invalidateRecordingsCacheForUser(userId: string): Promise<void> {
    if (!userId) return;
    this.logger.debug(`[DEBUG_REDIS] CACHE INVALIDATED FOR USER | userId=${userId}`);
    await this.delByPattern(`cache:recordings:flat:${userId}:*`);
    await this.del(`cache:recordings:grouped:${userId}`);
    // Fallback: cover any future flat key shape without trailing colon
    await this.delByPattern(`cache:recordings:*${userId}*`);
  }

  async invalidateRecordingsCacheForUsers(userIds: string[]): Promise<void> {
    const unique = [...new Set((userIds ?? []).filter(Boolean))];
    if (unique.length === 0) return;
    this.logger.debug(`[DEBUG_REDIS] CACHE INVALIDATED FOR USERS | count=${unique.length}`);
    for (const uid of unique) {
      await this.invalidateRecordingsCacheForUser(uid);
    }
  }
}
