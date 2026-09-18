import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async checkDatabase(): Promise<boolean> {
    await this.dataSource.query('SELECT 1');
    return true;
  }

  async databaseLatencyMs(): Promise<number> {
    const start = process.hrtime.bigint();
    await this.dataSource.query('SELECT 1');
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return Math.round(elapsed * 1000) / 1000;
  }
}
