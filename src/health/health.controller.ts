import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 供监控采集的基本运行状态：存活时长、数据库连通性、时间戳 */
  @Get()
  async check(): Promise<HealthStatus> {
    const status = await this.health.check();
    if (status.database !== 'up') {
      throw new HttpException(status, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return status;
  }

  /** 轻量存活探针，不触碰数据库 */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
