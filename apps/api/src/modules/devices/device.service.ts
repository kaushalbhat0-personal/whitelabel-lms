import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { REDIS_KEYS } from '../../common/constants/redis-keys.constant';

export interface DeviceInfo {
  browser?: string;
  os?: string;
  screenResolution?: string;
  timezone?: string;
  language?: string;
}

export interface DeviceRow {
  id: string;
  userId: string;
  fingerprintHash: string;
  browser: string | null;
  os: string | null;
  screenResolution: string | null;
  timezone: string | null;
  language: string | null;
  ipAddress: string | null;
  lastIpAddress: string | null;
  userAgent: string | null;
  isTrusted: boolean;
  name: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  private readonly redis: Redis;

  constructor(
    private readonly supabaseService: SupabaseService,
    redisService: RedisService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  private stripVersion(value: string): string {
    return value.replace(/[\d.]+/g, '').trim();
  }

  computeFingerprintHash(info: DeviceInfo): string {
    const raw = [
      this.stripVersion(info.browser ?? ''),
      this.stripVersion(info.os ?? ''),
      info.screenResolution ?? '',
      info.timezone ?? '',
      info.language ?? '',
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async registerDevice(
    userId: string,
    ip: string,
    userAgent: string,
    info?: DeviceInfo,
  ): Promise<{ device: DeviceRow | null; isNew: boolean }> {
    if (!info || !info.browser) {
      this.logger.debug(`No fingerprint data for user ${userId} — skipping device registration`);
      return { device: null, isNew: false };
    }

    const fingerprintHash = this.computeFingerprintHash(info);

    const existing = await this.supabaseService.client
      .from(TABLES.USER_DEVICES)
      .select('id, first_seen_at')
      .eq('user_id', userId)
      .eq('fingerprint_hash', fingerprintHash)
      .maybeSingle();

    const existingDevice = existing.data;
    const isNew = !existingDevice;
    const now = new Date().toISOString();

    if (isNew) {
      const { data, error } = await this.supabaseService.client
        .from(TABLES.USER_DEVICES)
        .insert({
          user_id: userId,
          fingerprint_hash: fingerprintHash,
          browser: info.browser ?? null,
          os: info.os ?? null,
          screen_resolution: info.screenResolution ?? null,
          timezone: info.timezone ?? null,
          language: info.language ?? null,
          ip_address: ip,
          last_ip_address: ip,
          user_agent: userAgent,
          first_seen_at: now,
          last_seen_at: now,
        })
        .select()
        .single();

      if (error) {
        this.logger.error(`Failed to register device: ${error.message}`);
        return { device: null, isNew: false };
      }

      this.logger.log(`New device registered for user ${userId}: ${info.browser} on ${info.os}`);
      return { device: this.toCamelCase(data), isNew: true };
    }

    const { data, error } = await this.supabaseService.client
      .from(TABLES.USER_DEVICES)
      .update({
        last_ip_address: ip,
        user_agent: userAgent,
        last_seen_at: now,
      })
      .eq('id', existingDevice.id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update device: ${error.message}`);
    }

    return { device: data ? this.toCamelCase(data) : null, isNew: false };
  }

  async getUserDevices(userId: string): Promise<DeviceRow[]> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.USER_DEVICES)
      .select('*')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch devices: ${error.message}`);
      return [];
    }

    return (data ?? []).map((row) => this.toCamelCase(row));
  }

  async getDevice(deviceId: string, userId: string): Promise<DeviceRow> {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.USER_DEVICES)
      .select('*')
      .eq('id', deviceId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Device not found');
    }

    return this.toCamelCase(data);
  }

  async updateDevice(
    deviceId: string,
    userId: string,
    updates: { name?: string; isTrusted?: boolean },
  ): Promise<DeviceRow> {
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.isTrusted !== undefined) payload.is_trusted = updates.isTrusted;

    if (Object.keys(payload).length === 0) {
      throw new NotFoundException('No updates provided');
    }

    const { data, error } = await this.supabaseService.client
      .from(TABLES.USER_DEVICES)
      .update(payload)
      .eq('id', deviceId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Device not found');
    }

    return this.toCamelCase(data);
  }

  async deleteDevice(deviceId: string, userId: string): Promise<void> {
    const device = await this.getDevice(deviceId, userId);

    await this.supabaseService.client
      .from(TABLES.USER_DEVICES)
      .delete()
      .eq('id', deviceId)
      .eq('user_id', userId);

    await this.redis.del(REDIS_KEYS.userSession(userId));
    const storedSessionId = await this.redis.get(REDIS_KEYS.userSession(userId));
    if (storedSessionId) {
      await this.redis.del(REDIS_KEYS.session(storedSessionId));
      await this.redis.del(REDIS_KEYS.userSession(userId));
    }

    this.logger.log(`Device ${deviceId} deleted and session invalidated for user ${userId}`);
  }

  private toCamelCase(row: any): DeviceRow {
    return {
      id: row.id,
      userId: row.user_id,
      fingerprintHash: row.fingerprint_hash,
      browser: row.browser,
      os: row.os,
      screenResolution: row.screen_resolution,
      timezone: row.timezone,
      language: row.language,
      ipAddress: row.ip_address,
      lastIpAddress: row.last_ip_address,
      userAgent: row.user_agent,
      isTrusted: row.is_trusted,
      name: row.name,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    };
  }
}
