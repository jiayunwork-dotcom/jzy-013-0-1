import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * 兜底异常过滤器：任何未预期错误都返回结构化可读响应，绝不让进程崩溃或裸栈泄漏给调用方。
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'object' && body !== null
          ? body
          : { ok: false, message: String(body) };
      response.status(status).json(payload);
      return;
    }

    // 物理层/持久化层可能抛出的一致性错误等
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      ok: false,
      message: '服务内部错误，本次核算未完成',
    });
  }
}
