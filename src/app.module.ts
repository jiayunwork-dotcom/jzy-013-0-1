import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './config/database.config';
import { CalculationModule } from './calculation/calculation.module';
import { HealthModule } from './health/health.module';
import { HistoryModule } from './history/history.module';

@Module({
  imports: [
    // forRootAsync 保证环境变量在应用初始化时才读取，便于测试切换 sqljs
    TypeOrmModule.forRootAsync({ useFactory: () => buildDataSourceOptions() }),
    HistoryModule,
    CalculationModule,
    HealthModule,
  ],
})
export class AppModule {}
