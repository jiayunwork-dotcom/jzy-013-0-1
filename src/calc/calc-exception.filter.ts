import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ValidationFailure } from './calc.service';

/**
 * Turns domain/validation failures into a stable, readable JSON error shape:
 *
 *   400 { "error": "VALIDATION_FAILED", "message": "...", "details": [...] }
 *
 * It also guards every other throw so the process never crashes on a bad
 * request and the client never receives a misleading numeric result.
 */
@Catch()
export class CalcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('CalcExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ValidationFailure) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: 'VALIDATION_FAILED',
        message:
          exception.errors[0]?.message ??
          'one or more parameters are invalid',
        details: exception.errors,
      });
      return;
    }

    // Nest's own HttpExceptions (404, body-parser syntax errors, ...) keep
    // their status, but 400s are reshaped into the stable error envelope so
    // every client-side failure reads the same way.
    const anyEx = exception as {
      getStatus?: () => number;
      getResponse?: () => unknown;
      message?: string;
    };
    if (typeof anyEx?.getStatus === 'function') {
      const status = anyEx.getStatus();
      const body =
        typeof anyEx.getResponse === 'function'
          ? anyEx.getResponse()
          : { message: anyEx.message };
      if (status === HttpStatus.BAD_REQUEST) {
        const message =
          typeof body === 'object' && body !== null && 'message' in body
            ? Array.isArray((body as { message: unknown }).message)
              ? String((body as { message: string[] }).message[0])
              : String((body as { message: unknown }).message)
            : 'malformed request';
        response.status(status).json({
          error: 'VALIDATION_FAILED',
          message,
          details: [{ field: '(body)', code: 'NOT_AN_OBJECT', message }],
        });
        return;
      }
      response.status(status).json(
        typeof body === 'string' ? { error: 'HTTP_ERROR', message: body } : body,
      );
      return;
    }

    this.logger.error(exception as Error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'INTERNAL_ERROR',
      message: 'an unexpected error occurred while evaluating the request',
    });
  }
}
