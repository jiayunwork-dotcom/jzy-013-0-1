import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CalculationRecord } from '../history/calculation-record.entity';

/**
 * 数据库配置（启动时读取环境变量，保证测试可在 import 前注入 DB_TYPE=sqljs）。
 *  - DB_TYPE=postgres（默认，配合 docker-compose）：使用 PG_* 环境变量
 *  - DB_TYPE=sqljs：纯内存 SQLite（自动化测试 / 本地零依赖试跑）
 */
export function buildDataSourceOptions(): TypeOrmModuleOptions {
  const type = process.env.DB_TYPE ?? 'postgres';

  if (type === 'sqljs') {
    return {
      type: 'sqljs',
      entities: [CalculationRecord],
      synchronize: true,
      autoSave: false,
      logging: false,
    };
  }

  return {
    type: 'postgres',
    host: process.env.PG_HOST ?? 'db',
    port: Number(process.env.PG_PORT ?? 5432),
    username: process.env.PG_USER ?? 'buck',
    password: process.env.PG_PASSWORD ?? 'buck',
    database: process.env.PG_DATABASE ?? 'buckdb',
    entities: [CalculationRecord],
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
    autoLoadEntities: true,
    retryAttempts: 10,
    retryDelay: 2000,
    logging: false,
  };
}
