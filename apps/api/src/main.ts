/*
 * Application entry point — bootstraps the NestJS server
 *
 * Why this file exists:
 *   - Creates the Nest application, attaches global middleware (CORS, validation),
 *     and starts listening on the configured port.
 *   - The ValidationPipe is configured to strip unknown properties and transform
 *     payloads so DTOs work correctly.
 *
 * A junior should know:
 *   - `whitelist: true` strips properties not in your DTO — prevents mass-assignment.
 *   - `forbidNonWhitelisted: true` throws an error if extra properties are sent.
 *   - `transform: true` automatically converts strings to numbers/booleans per DTO types.
 *   - Changes to CORS origin are made via the FRONTEND_URL env variable.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { resolveSessionPolicy } from './common/constants/session-policy.constant';

async function bootstrap() {
  // Fail fast on an invalid SESSION_POLICY before creating the application.
  // Allowed: 'single' | 'multi'. Unset defaults to 'single'. An invalid value
  // must never silently become 'multi' (weakened client sessions) or be
  // ignored (broken demo). Constructors re-resolve the same value, so a
  // misconfiguration in file-based env also fails during Nest DI init.
  resolveSessionPolicy(process.env.SESSION_POLICY);

  // rawBody: true tells NestJS's body-parser to preserve the exact byte
  // sequence on req.rawBody.  The Mux webhook handler needs this to verify
  // HMAC signatures — JSON.stringify(req.body) can produce a different
  // string than the original body after a parse/stringify round-trip.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  // ── CORS ────────────────────────────────────────────────────
  const frontendUrl = configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
  });

  // ── Global validation pipe ──────────────────────────────────
  // Automatically validates all incoming DTOs using class-validator decorators
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,                // Strip unknown properties
      forbidNonWhitelisted: true,     // Throw error if unknown props sent
      transform: true,                // Auto-transform types (string → number, etc.)
    }),
  );

  // ── Start listening ─────────────────────────────────────────
  const port = configService.get<number>('PORT') ?? 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`API is running on http://0.0.0.0:${port}`);
}
bootstrap();
