/*
 * Root module of the NestJS API
 *
 * Why this module exists:
 *   - Ties together every feature module, global provider, and third-party module.
 *   - ConfigModule reads .env so every service has access to environment variables.
 *   - JwtModule is global — no need to import it in child modules.
 *   - Guards, filters, and interceptors registered here apply to EVERY route.
 *
 * A junior should know:
 *   - Adding a new feature? Create its module and add it to the `imports` array.
 *   - Need a new global provider? Add it to the `providers` array.
 *   - The order of imports generally doesn't matter, but feature modules are listed
 *     alphabetically for readability.
 */
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

// ── Feature modules ──────────────────────────────────────────
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CoursesModule } from './modules/courses/courses.module';
import { BatchesModule } from './modules/batches/batches.module';
import { LiveSessionsModule } from './modules/live-sessions/live-sessions.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { TradingSessionsModule } from './modules/trading-sessions/trading-sessions.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { EmailModule } from './modules/email/email.module';
import { TestsModule } from './modules/tests/tests.module';
import { ZoomModule } from './modules/zoom/zoom.module';
import { MuxModule } from './modules/mux/mux.module';
import { VideoProviderModule } from './modules/video-provider/video-provider.module';
import { BulkUploadModule } from './modules/bulk-upload/bulk-upload.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BusinessConfigModule } from './modules/business-config/business-config.module';
import { DeviceModule } from './modules/devices/device.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PlaybackModule } from './modules/playback/playback.module';
import { ScreenRecordingModule } from './modules/screen-recording/screen-recording.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { BatchCurriculumModule } from './modules/batch-curriculum/batch-curriculum.module';
import { CurriculumProgressModule } from './modules/curriculum-progress/curriculum-progress.module';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { AttemptsModule } from './modules/attempts/attempts.module';
import { AuditModule } from './modules/audit/audit.module';
import { EvaluationModule } from './modules/evaluation/evaluation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { RecordingCurriculumReconciliationModule } from './modules/recordings/reconciliation/recording-curriculum-reconciliation.module';
import { ResultsModule } from './modules/results/results.module';
import { UploadsModule } from './modules/uploads/uploads.module';

// ── Root controller ──────────────────────────────────────────
import { AppController } from './app.controller';

// ── Common providers ─────────────────────────────────────────
import { SupabaseService } from './common/services/supabase.service';
import { RedisCacheService } from './common/services/redis-cache.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { ObservabilityInterceptor } from './modules/observability/observability.interceptor';

// ── Jobs ─────────────────────────────────────────────────────
import { RecordingUploadJob } from './jobs/recording-upload.job';
import { RecordingCleanupJob } from './jobs/recording-cleanup.job';

@Global()
@Module({
  imports: [
    // ── Config ────────────────────────────────────────────────
    // Makes ConfigService available everywhere without importing ConfigModule
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // ── JWT ───────────────────────────────────────────────────
    // Global so every service can inject JwtService directly
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '24h',
        },
      }),
    }),

    // ── Redis ─────────────────────────────────────────────────
    // Used for session storage, caching, and rate-limiting
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
          port: config.get<number>('REDIS_PORT') ?? 6379,
          password: config.get<string>('REDIS_PASSWORD'),
          tls: config.get<string>('REDIS_PASSWORD') ? {} : undefined,
        },
      }),
    }),

    // ── Scheduling ────────────────────────────────────────────
    // Enables @Cron() decorators used in jobs (e.g. recording upload pipeline)
    ScheduleModule.forRoot(),

    // ── Feature modules ───────────────────────────────────────
    AuthModule,
    UsersModule,
    BatchCurriculumModule,
    CurriculumProgressModule,
    AchievementsModule,
    CoursesModule,
    BatchesModule,
    LiveSessionsModule,
    RecordingsModule,
    RecordingCurriculumReconciliationModule,
    TradingSessionsModule,
    AttendanceModule,
    EmailModule,
    TestsModule,
    ZoomModule,
    MuxModule,
    VideoProviderModule,
    BulkUploadModule,
    PaymentsModule,
    OutboxModule,
    InvoicesModule,
    BusinessConfigModule,
    DeviceModule,
    AnalyticsModule,
    PlaybackModule,
    ScreenRecordingModule,
    QuestionsModule,
    AttemptsModule,
    AuditModule,
    EvaluationModule,
    NotificationsModule,
    ObservabilityModule,
    ResultsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  exports: [
    SupabaseService,
    RedisCacheService,
  ],
  providers: [
    // ── Singleton services ────────────────────────────────────
    SupabaseService,
    RedisCacheService,
    RecordingUploadJob,
    RecordingCleanupJob,

    // ── Global guards ─────────────────────────────────────────
    // Order matters: JwtAuthGuard runs first, then RolesGuard
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    // ── Global filter ─────────────────────────────────────────
    // Catches every HttpException and returns a consistent shape
    { provide: APP_FILTER, useClass: HttpExceptionFilter },

    // ── Global interceptors ──────────────────────────────────
    // Order matters: ObservabilityInterceptor runs first (captures timing + errors)
    { provide: APP_INTERCEPTOR, useClass: ObservabilityInterceptor },
    // Wraps every successful response in { success, data, timestamp }
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
  ],
})
export class AppModule {}
