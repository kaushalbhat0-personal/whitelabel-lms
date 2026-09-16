import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { REDIS_KEYS, REDIS_TTL } from '../../common/constants/redis-keys.constant';
import { RiskScoreData } from './screen-recording.types';

interface ViolationPayload {
  userId: string;
  contextType: 'recording' | 'live_session' | 'test';
  contextId?: string;
  detectionType: string;
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

const VIOLATION_WEIGHTS: Record<string, number> = {
  visibilitychange_hidden: 5,
  window_blur: 3,
  window_focus_lost: 3,
  printscreen_key: 10,
  devtools_open: 15,
  get_display_media: 25,
  multiple_displays: 8,
};

@Injectable()
export class ScreenRecordingService {
  private readonly logger = new Logger(ScreenRecordingService.name);
  private readonly redis: Redis;

  constructor(
    redisService: RedisService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  async reportViolation(payload: ViolationPayload): Promise<void> {
    const rateKey = REDIS_KEYS.screenRecordingRateLimit(payload.userId);
    const exists = await this.redis.exists(rateKey);
    if (exists) {
      this.logger.debug(`Rate-limited violation report for user ${payload.userId}`);
      return;
    }

    await this.redis.setex(rateKey, REDIS_TTL.SCREEN_RECORDING_RATE, '1');

    await this.supabaseService.client
      .from(TABLES.SCREEN_RECORDING_VIOLATIONS)
      .insert({
        user_id: payload.userId,
        context_type: payload.contextType,
        context_id: payload.contextId ?? null,
        detection_type: payload.detectionType,
        details: payload.details ?? {},
        ip_address: payload.ip ?? null,
        user_agent: payload.userAgent ?? null,
      });

    await this.upsertViolationCounter(payload.userId, payload.contextType, payload.detectionType);
    await this.updateRiskScore(payload.userId);

    this.logger.warn(
      `Screen recording violation: user=${payload.userId} type=${payload.detectionType} context=${payload.contextType}`,
    );
  }

  private columnMap: Record<string, string> = {
    visibilitychange_hidden: 'visibilitychange_count',
    window_blur: 'blur_count',
    window_focus_lost: 'focus_loss_count',
    printscreen_key: 'printscreen_count',
    devtools_open: 'devtools_count',
    get_display_media: 'display_media_count',
    multiple_displays: 'display_media_count',
  };

  private async upsertViolationCounter(
    userId: string,
    contextType: 'recording' | 'live_session' | 'test',
    detectionType: string,
  ): Promise<void> {
    const { data: existing } = await this.supabaseService.client
      .from(TABLES.VIOLATION_COUNTERS)
      .select('*')
      .eq('user_id', userId)
      .eq('context_type', contextType)
      .maybeSingle();

    const column = this.columnMap[detectionType] || null;
    const now = new Date().toISOString();

    if (existing) {
      const updates: Record<string, any> = {
        total_violations: (existing.total_violations || 0) + 1,
        last_violation_at: now,
        updated_at: now,
      };
      if (column) {
        updates[column] = (existing[column] || 0) + 1;
      }

      await this.supabaseService.client
        .from(TABLES.VIOLATION_COUNTERS)
        .update(updates)
        .eq('id', existing.id);
    } else {
      const insert: Record<string, any> = {
        user_id: userId,
        context_type: contextType,
        total_violations: 1,
        last_violation_at: now,
      };
      if (column) {
        insert[column] = 1;
      }

      await this.supabaseService.client
        .from(TABLES.VIOLATION_COUNTERS)
        .insert(insert);
    }
  }

  private async updateRiskScore(userId: string): Promise<void> {
    const score = await this.calculateRiskScore(userId);

    await this.supabaseService.client
      .from(TABLES.RISK_SCORES)
      .upsert({
        user_id: userId,
        overall_score: score.overall_score,
        recording_score: score.recording_score,
        live_session_score: score.live_session_score,
        test_score: score.test_score,
        total_violations: score.total_violations,
        violations_24h: score.violations_24h,
        violations_7d: score.violations_7d,
        last_violation_at: new Date().toISOString(),
        calculated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    await this.redis.setex(
      REDIS_KEYS.riskScore(userId),
      REDIS_TTL.RISK_SCORE_CACHE,
      JSON.stringify(score),
    );
  }

  private async calculateRiskScore(userId: string): Promise<RiskScoreData> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const { data: allViolations } = await this.supabaseService.client
      .from(TABLES.SCREEN_RECORDING_VIOLATIONS)
      .select('detection_type, context_type, created_at')
      .eq('user_id', userId)
      .gte('created_at', ninetyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(1000);

    const violations = allViolations ?? [];
    const totalViolations = violations.length;

    const violations24h = violations.filter((v) => new Date(v.created_at) >= twentyFourHoursAgo).length;
    const violations7d = violations.filter((v) => new Date(v.created_at) >= sevenDaysAgo).length;

    const contextScores: Record<string, number> = { recording: 0, live_session: 0, test: 0 };
    for (const v of violations) {
      const weight = VIOLATION_WEIGHTS[v.detection_type] || 1;
      if (v.context_type && contextScores[v.context_type] !== undefined) {
        contextScores[v.context_type] += weight;
      }
    }

    const clamp = (val: number) => Math.min(100, Math.max(0, val));
    const recordingScore = clamp(contextScores.recording);
    const liveSessionScore = clamp(contextScores.live_session);
    const testScore = clamp(contextScores.test);
    const overallScore = clamp(
      recordingScore * 0.4 + liveSessionScore * 0.35 + testScore * 0.25 +
      Math.min(violations24h * 5, 30),
    );

    return {
      overall_score: overallScore,
      recording_score: recordingScore,
      live_session_score: liveSessionScore,
      test_score: testScore,
      total_violations: totalViolations,
      violations_24h: violations24h,
      violations_7d: violations7d,
    };
  }

  async getViolations(options?: { userId?: string; contextType?: string; page?: number; limit?: number }): Promise<{ items: any[]; total: number; page: number; limit: number }> {
    const page = options?.page ?? 1;
    const limit = Math.min(options?.limit ?? 50, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let countQuery = this.supabaseService.client
      .from(TABLES.SCREEN_RECORDING_VIOLATIONS)
      .select('*', { count: 'exact', head: true });

    let dataQuery = this.supabaseService.client
      .from(TABLES.SCREEN_RECORDING_VIOLATIONS)
      .select('*, profiles!inner(id, name, email)')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (options?.userId) {
      countQuery = countQuery.eq('user_id', options.userId);
      dataQuery = dataQuery.eq('user_id', options.userId);
    }
    if (options?.contextType) {
      countQuery = countQuery.eq('context_type', options.contextType);
      dataQuery = dataQuery.eq('context_type', options.contextType);
    }

    const [{ count }, { data }] = await Promise.all([countQuery, dataQuery]);

    return { items: data ?? [], total: count ?? 0, page, limit };
  }

  async getViolationCounters(userId?: string): Promise<any[]> {
    let query = this.supabaseService.client
      .from(TABLES.VIOLATION_COUNTERS)
      .select('*, profiles!inner(id, name, email)')
      .order('total_violations', { ascending: false })
      .limit(200);

    if (userId) query = query.eq('user_id', userId);

    const { data } = await query;
    return data ?? [];
  }

  async getRiskScore(userId: string): Promise<RiskScoreData | null> {
    const cached = await this.redis.get(REDIS_KEYS.riskScore(userId));
    if (cached) {
      return JSON.parse(cached);
    }

    const { data } = await this.supabaseService.client
      .from(TABLES.RISK_SCORES)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) return null;

    await this.redis.setex(
      REDIS_KEYS.riskScore(userId),
      REDIS_TTL.RISK_SCORE_CACHE,
      JSON.stringify(data),
    );

    return data;
  }

  async getAllRiskScores(limit = 200): Promise<any[]> {
    const { data } = await this.supabaseService.client
      .from(TABLES.RISK_SCORES)
      .select('*, profiles!inner(id, name, email)')
      .order('overall_score', { ascending: false })
      .limit(limit);

    return data ?? [];
  }
}
