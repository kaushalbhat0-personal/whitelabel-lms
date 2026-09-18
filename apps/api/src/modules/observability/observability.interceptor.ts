import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ObservabilityService } from './observability.service';

function classifyExpectedEvent(
  status: number,
  messageStr: string,
  rawMessage: any,
  errorName: string,
): { eventType: string; source: string; severity: string } | null {
  // 401 — known session/auth expected events
  if (status === 401) {
    const sessionExpiredMessages = new Set([
      'Session expired — please log in again',
      'Session expired or signed in on another device',
      'Invalid or expired token',
      'Missing or malformed Authorization header',
    ]);
    if (sessionExpiredMessages.has(messageStr)) {
      return { eventType: 'SESSION_EXPIRED', source: 'auth', severity: 'info' };
    }
    // Other 401s (unknown) remain errors
    return null;
  }

  // 403 — known business outcomes from attempts
  if (status === 403) {
    const attemptRejected = new Set([
      'You are not enrolled in any batch assigned to this test',
      'Maximum attempts reached for this test',
      'Test is not available for attempts',
      'Test not yet available',
      'Test window closed',
      'You are no longer enrolled in this test',
    ]);
    if (attemptRejected.has(messageStr)) {
      return { eventType: 'ATTEMPT_REJECTED', source: 'attempts', severity: 'info' };
    }
    return null;
  }

  // 400 — validation / expected client input
  if (status === 400) {
    // ValidationPipe produces array message
    if (Array.isArray(rawMessage)) {
      return { eventType: 'VALIDATION_FAILED', source: 'api', severity: 'info' };
    }
    if (messageStr === 'Invalid email format') {
      return { eventType: 'VALIDATION_FAILED', source: 'api', severity: 'info' };
    }
    return null;
  }

  // 404 — keep as error for now (only reclassify if clearly expected, none identified)
  // 409 — non-SESSION_REPLACED conflicts remain errors (already handled SESSION_REPLACED above)
  return null;
}

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  constructor(
    private readonly observabilityService: ObservabilityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<any>();
    const url = request.url ?? 'unknown';
    const method = request.method ?? 'UNKNOWN';

    return next.handle().pipe(
      tap(() => {
        try {
          const duration = Date.now() - startTime;
            this.observabilityService
              .trackMetric({
                metricName: 'endpoint_latency',
                value: duration,
                unit: 'ms',
                tags: { endpoint: url, method },
                userId: request.user?.id,
              })
              .catch(() => {});
        } catch {}
      }),
      catchError((error) => {
        try {
          const duration = Date.now() - startTime;
          const status: number = (() => {
            const s = (error as any)?.status;
            if (typeof s === 'number') return s;
            try {
              const gs = (error as any)?.getStatus?.();
              if (typeof gs === 'number') return gs;
            } catch {}
            return 500;
          })();
          const businessCode: string | undefined = (() => {
            const r = (error as any)?.response;
            if (r && typeof r === 'object' && (r as any).code) return (r as any).code;
            try {
              const gr = (error as any)?.getResponse?.();
              if (gr && typeof gr === 'object' && (gr as any).code) return (gr as any).code;
              if (typeof gr === 'object' && gr !== null && (gr as any).message && typeof (gr as any).message === 'object' && (gr as any).message?.code) return (gr as any).message.code;
            } catch {}
            return undefined;
          })();
          const rawMessage: any = (() => {
            try {
              const gr = (error as any)?.getResponse?.();
              if (gr && typeof gr === 'object' && gr !== null && 'message' in gr) return (gr as any).message;
            } catch {}
            const r = (error as any)?.response;
            if (r && typeof r === 'object' && (r as any).message) return (r as any).message;
            return (error as any)?.message;
          })();
          const messageStr: string = Array.isArray(rawMessage) ? rawMessage.join('; ') : String(rawMessage ?? 'Unknown error');
          const errorName: string = (error as any)?.name ?? 'InternalError';

          // 1. SESSION_REPLACED has explicit business code — highest priority
          if (businessCode === 'SESSION_REPLACED') {
            this.observabilityService
              .logEvent({
                eventType: 'SESSION_REPLACED',
                source: 'auth',
                severity: 'info',
                message: messageStr,
                metadata: { url, method, duration, statusCode: status, errorType: errorName, businessCode, userAgent: request.headers?.['user-agent'], ip: (request as any)?.ip },
              })
              .catch(() => {});
          } else if (messageStr === 'Invalid email or password') {
            // Already recorded as LOGIN_FAILED via auth.service — suppress duplicate system_errors row
            // No logError / logEvent here
          } else {
            const expected = classifyExpectedEvent(status, messageStr, rawMessage, errorName);
            if (expected) {
              this.observabilityService
                .logEvent({
                  eventType: expected.eventType,
                  source: expected.source,
                  severity: expected.severity,
                  message: messageStr,
                  metadata: {
                    url,
                    method,
                    duration,
                    statusCode: status,
                    errorType: errorName,
                    businessCode,
                    userAgent: request.headers?.['user-agent'],
                    ip: (request as any)?.ip,
                  },
                })
                .catch(() => {});
            } else {
              this.observabilityService
                .logError(
                  {
                    message: messageStr,
                    errorType: errorName,
                    severity: 'error',
                    stackTrace: (error as any)?.stack,
                    context: {
                      url,
                      method,
                      duration,
                      statusCode: status,
                    },
                  },
                  request.user?.id,
                )
                .catch(() => {});
            }
          }
        } catch {}

        return throwError(() => error);
      }),
    );
  }
}
