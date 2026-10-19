import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { DeviceService } from './device.service';
import { SupabaseService } from '../../common/services/supabase.service';

function redisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    setex: jest.fn(async (k: string, _t: number, v: string) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (...keys: string[]) => { keys.forEach((k) => store.delete(k)); return keys.length; }),
    _store: store,
  };
}

describe('DeviceService — deleteDevice session invalidation', () => {
  const deviceRow = {
    id: 'dev-1',
    user_id: 'u1',
    fingerprint_hash: 'fp',
    browser: 'Chrome',
    os: 'Windows',
    screen_resolution: '1920x1080',
    timezone: 'Asia/Kolkata',
    language: 'en',
    ip_address: '1.1.1.1',
    last_ip_address: '1.1.1.1',
    user_agent: 'UA',
    is_trusted: false,
    name: 'Laptop',
    first_seen_at: '2026-01-01',
    last_seen_at: '2026-01-02',
  };

  function chain(result: any) {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => result),
      delete: jest.fn().mockReturnThis(),
    };
  }

  async function build(rowResult: any) {
    const redis = redisMock();
    const from = jest.fn().mockReturnValue(chain(rowResult));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: SupabaseService, useValue: { client: { from } } },
        { provide: RedisService, useValue: { getOrThrow: () => redis } },
      ],
    }).compile();
    return { service: module.get(DeviceService), redis };
  }

  it('deletes the row and clears BOTH the pointer and the per-session key', async () => {
    const { service, redis } = await build({ data: deviceRow, error: null });
    await redis.setex('user_session:u1', 86400, 'sess-1');
    await redis.setex('session:sess-1', 86400, '{}');
    await service.deleteDevice('dev-1', 'u1');
    expect(await redis.get('user_session:u1')).toBeNull();
    expect(await redis.get('session:sess-1')).toBeNull();
  });

  it('clears a stale pointer even when no per-session key exists', async () => {
    const { service, redis } = await build({ data: deviceRow, error: null });
    await redis.setex('user_session:u1', 86400, 'sess-gone');
    await service.deleteDevice('dev-1', 'u1');
    expect(await redis.get('user_session:u1')).toBeNull();
  });

  it('throws NotFound when the device does not belong to the user', async () => {
    const { service } = await build({ data: null, error: { message: 'nope' } });
    await expect(service.deleteDevice('dev-x', 'u1')).rejects.toThrow(NotFoundException);
  });
});
