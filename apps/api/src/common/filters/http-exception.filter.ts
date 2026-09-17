/*
 * Global HTTP exception filter — consistent error responses everywhere
 *
 * Why this filter exists:
 *   - NestJS error responses vary in shape depending on where they're thrown.
 *   - This filter catches EVERY HttpException and normalises the response so the
 *     frontend always receives: { success, message, statusCode, timestamp, path }.
 *
 * A junior should know:
 *   - This is registered globally in app.module.ts — no need to add @UseFilters().
 *   - Just throw `new BadRequestException('message')` and this filter handles formatting.
 *   - The `path` field helps debugging — you can see which URL caused the error.
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception.getResponse();
    // NestJS sometimes returns a string or an object with a `message` array
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message ?? exception.message;
    const code =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as any).code
        : undefined;

    // Log the error for server-side debugging (don't expose stack traces to clients)
    this.logger.error(
      `${request.method} ${request.url} → ${statusCode}: ${JSON.stringify(message)}`,
    );

    response.status(statusCode).json({
      success: false,
      ...(code ? { code } : {}),
      message: Array.isArray(message) ? message.join('; ') : message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
