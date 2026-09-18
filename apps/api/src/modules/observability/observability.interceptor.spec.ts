import { ObservabilityInterceptor } from './observability.interceptor';
import { ObservabilityService } from './observability.service';
import { UnauthorizedException, ForbiddenException, BadRequestException, NotFoundException, ConflictException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';

describe('ObservabilityInterceptor - noise classification', () => {
  let interceptor: ObservabilityInterceptor;
  let obsMock: any;

  beforeEach(() => {
    obsMock = {
      logError: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      trackMetric: jest.fn().mockResolvedValue(undefined),
    };
    interceptor = new ObservabilityInterceptor(obsMock as unknown as ObservabilityService);
  });

  const mockContext = (url = '/api/test', method = 'GET', userId?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        url,
        method,
        headers: { 'user-agent': 'jest' },
        ip: '127.0.0.1',
        user: userId ? { id: userId } : undefined,
      }),
    }),
  } as any);

  const interceptError = async (error: any) => {
    const ctx = mockContext();
    const handler = { handle: () => throwError(() => error) } as any;
    try {
      await lastValueFrom(interceptor.intercept(ctx, handler));
    } catch (e) {
      // expected rethrow
    }
  };

  it('SESSION_REPLACED 409 → event, no system_error', async () => {
    const err = new ConflictException({ code: 'SESSION_REPLACED', message: 'An active session was found for this account. For security, the previous session has been signed out. Please log in again.' });
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SESSION_REPLACED', source: 'auth', severity: 'info' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('Session expired 401 → event, no system_error', async () => {
    const err = new UnauthorizedException('Session expired — please log in again');
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SESSION_EXPIRED' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('Session expired or signed in on another device 401 → event', async () => {
    const err = new UnauthorizedException('Session expired or signed in on another device');
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SESSION_EXPIRED' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('Invalid credentials 401 → no system_error and no duplicate event (suppressed)', async () => {
    const err = new UnauthorizedException('Invalid email or password');
    await interceptError(err);
    expect(obsMock.logError).not.toHaveBeenCalled();
    // Should not create SESSION_EXPIRED or SESSION_REPLACED either, and not duplicate LOGIN_FAILED
    expect(obsMock.logEvent).not.toHaveBeenCalled();
  });

  it('Known enrollment 403 → event', async () => {
    const err = new ForbiddenException('You are not enrolled in any batch assigned to this test');
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ATTEMPT_REJECTED' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('Maximum attempts 403 → event', async () => {
    const err = new ForbiddenException('Maximum attempts reached for this test');
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ATTEMPT_REJECTED' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('Known validation 400 Invalid email format → event', async () => {
    const err = new BadRequestException('Invalid email format');
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'VALIDATION_FAILED' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('ValidationPipe array 400 → event', async () => {
    const err: any = new BadRequestException(['email must be an email', 'name should not be empty']);
    // Simulate Nest ValidationPipe error shape where message is array
    err.response = { message: ['email must be an email'], error: 'Bad Request', statusCode: 400 };
    // getResponse returns same
    err.getResponse = () => ({ message: ['email must be an email'], error: 'Bad Request', statusCode: 400 });
    err.status = 400;
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'VALIDATION_FAILED' }));
    expect(obsMock.logError).not.toHaveBeenCalled();
  });

  it('Unknown 404 → system_error', async () => {
    const err = new NotFoundException('Some random not found');
    await interceptError(err);
    expect(obsMock.logError).toHaveBeenCalled();
    expect(obsMock.logEvent).not.toHaveBeenCalled();
  });

  it('Unknown 401 → system_error', async () => {
    const err = new UnauthorizedException('Some unknown 401 reason');
    await interceptError(err);
    expect(obsMock.logError).toHaveBeenCalled();
    expect(obsMock.logEvent).not.toHaveBeenCalled();
  });

  it('Unknown 403 → system_error', async () => {
    const err = new ForbiddenException('Some random forbidden');
    await interceptError(err);
    expect(obsMock.logError).toHaveBeenCalled();
  });

  it('Unknown 409 → system_error', async () => {
    const err = new ConflictException('Some other conflict');
    await interceptError(err);
    expect(obsMock.logError).toHaveBeenCalled();
    expect(obsMock.logEvent).not.toHaveBeenCalled();
  });

  it('500 → system_error', async () => {
    const err = new InternalServerErrorException('DB failed');
    await interceptError(err);
    expect(obsMock.logError).toHaveBeenCalled();
    expect(obsMock.logEvent).not.toHaveBeenCalled();
  });

  it('503 → system_error', async () => {
    const err = new ServiceUnavailableException('Service down');
    await interceptError(err);
    expect(obsMock.logError).toHaveBeenCalled();
    expect(obsMock.logEvent).not.toHaveBeenCalled();
  });

  it('original exception still reaches client', async () => {
    const err = new BadRequestException('test');
    const ctx = mockContext();
    const handler = { handle: () => throwError(() => err) } as any;
    await expect(lastValueFrom(interceptor.intercept(ctx, handler))).rejects.toBe(err);
  });

  it('endpoint latency metric still recorded on success', async () => {
    const ctx = mockContext('/api/ok', 'GET');
    const handler = { handle: () => of({ success: true }) } as any;
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(obsMock.trackMetric).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'endpoint_latency' }));
  });

  it('event contains audit context', async () => {
    const err = new UnauthorizedException('Session expired — please log in again');
    await interceptError(err);
    expect(obsMock.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ url: expect.any(String), method: expect.any(String), statusCode: 401 }),
    }));
  });
});
