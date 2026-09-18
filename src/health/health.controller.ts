import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';

/**
 * Minimal operational endpoints for monitoring scrapers:
 *   GET /health/live  - process is up (no dependencies checked)
 *   GET /health/ready - 200 if the database is reachable, 503 otherwise
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Get('ready')
  async ready(@Res() res: Response) {
    try {
      const latencyMs = await this.health.databaseLatencyMs();
      res.status(HttpStatus.OK).json({
        status: 'ok',
        checks: { database: { ok: true, latencyMs } },
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch (e) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'unavailable',
        checks: { database: { ok: false, error: (e as Error).message } },
        uptimeSeconds: Math.round(process.uptime()),
      });
    }
  }
}
