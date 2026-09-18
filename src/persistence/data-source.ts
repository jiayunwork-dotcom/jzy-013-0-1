import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CalcRecord } from './entities/calc-record.entity';
import { BatchRecord } from './entities/batch-record.entity';

export const entities = [CalcRecord, BatchRecord];

/**
 * Build the TypeORM connection configuration from the environment.
 *
 * Production / docker-compose uses PostgreSQL. Tests (and local runs without a
 * database) select an in-process sql.js database with DB_TYPE=sqljs, so the
 * service stays fully exercisable without external dependencies.
 */
export function buildDataSourceOptions(): TypeOrmModuleOptions {
  const type = (process.env.DB_TYPE ?? 'postgres').toLowerCase();
  const synchronize = process.env.DB_SYNCHRONIZE !== 'false';

  if (type === 'sqljs') {
    return {
      type: 'sqljs',
      location: process.env.DB_SQLJS_LOCATION || undefined,
      autoSave: Boolean(process.env.DB_SQLJS_LOCATION),
      entities,
      synchronize: true,
      logging: false,
    };
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'buck',
    password: process.env.DB_PASSWORD ?? 'buck_secret',
    database: process.env.DB_NAME ?? 'buckcalc',
    entities,
    synchronize,
    logging: false,
  };
}
