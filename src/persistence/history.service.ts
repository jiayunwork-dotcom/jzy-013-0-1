import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CalcRecord } from './entities/calc-record.entity';
import { BatchRecord } from './entities/batch-record.entity';

export interface RecordInput {
  endpoint: 'mode' | 'ripple' | 'batch';
  batchId?: string | null;
  itemIndex?: number | null;
  success: boolean;
  mode?: string | null;
  params?: {
    inputVoltage?: number;
    dutyCycle?: number;
    inductance?: number;
    capacitance?: number;
    switchPeriod?: number;
    loadResistance?: number;
    esr?: number;
  } | null;
  outputVoltage?: number | null;
  ccmOutputVoltage?: number | null;
  inductorCurrentRipple?: number | null;
  capacitorVoltageRipple?: number | null;
  totalOutputVoltageRipple?: number | null;
  request?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errors?: Record<string, unknown>[] | null;
}

export interface HistoryQuery {
  endpoint?: string;
  mode?: string;
  success?: boolean;
  batchId?: string;
  /** ISO timestamp; only records created at/after this instant. */
  from?: string;
  /** ISO timestamp; only records created before this instant. */
  to?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(CalcRecord)
    private readonly records: Repository<CalcRecord>,
    @InjectRepository(BatchRecord)
    private readonly batches: Repository<BatchRecord>,
    private readonly dataSource: DataSource,
  ) {}

  async saveSingle(input: RecordInput): Promise<CalcRecord> {
    const record = this.records.create(this.toEntity(input));
    return this.records.save(record);
  }

  /**
   * Persist a batch header and all its item rows atomically. Either the whole
   * batch is stored or nothing is — concurrent requests never interleave
   * partial batch rows.
   */
  async saveBatch(
    items: RecordInput[],
  ): Promise<{ batchId: string; records: CalcRecord[] }> {
    return this.dataSource.transaction(async (manager) => {
      const successCount = items.filter((i) => i.success).length;
      const header = await manager.save(
        manager.create(BatchRecord, {
          totalItems: items.length,
          successCount,
          failureCount: items.length - successCount,
        }),
      );

      const entities = items.map((item, index) =>
        manager.create(
          CalcRecord,
          this.toEntity({
            ...item,
            endpoint: 'batch',
            batchId: header.id,
            itemIndex: item.itemIndex ?? index,
          }),
        ),
      );
      const records = await manager.save(entities);
      return { batchId: header.id as string, records };
    });
  }

  async query(q: HistoryQuery): Promise<{ total: number; items: CalcRecord[] }> {
    const qb = this.records.createQueryBuilder('r');

    if (q.endpoint) qb.andWhere('r.endpoint = :endpoint', { endpoint: q.endpoint });
    if (q.mode) qb.andWhere('r.mode = :mode', { mode: q.mode });
    if (q.batchId) qb.andWhere('r.batchId = :batchId', { batchId: q.batchId });
    if (typeof q.success === 'boolean') {
      qb.andWhere('r.success = :success', { success: q.success });
    }
    if (q.from) qb.andWhere('r.createdAt >= :from', { from: new Date(q.from) });
    if (q.to) qb.andWhere('r.createdAt < :to', { to: new Date(q.to) });

    qb.orderBy('r.createdAt', 'DESC').addOrderBy('r.itemIndex', 'ASC', 'NULLS LAST');

    const limit = clampInt(q.limit, 1, 200, 50);
    const offset = clampInt(q.offset, 0, 1_000_000, 0);
    qb.take(limit).skip(offset);

    const [items, total] = await qb.getManyAndCount();
    return { total, items };
  }

  async count(): Promise<number> {
    return this.records.count();
  }

  /** Used by the readiness probe. */
  async ping(): Promise<boolean> {
    await this.dataSource.query('SELECT 1');
    return true;
  }

  private toEntity(i: RecordInput): Partial<CalcRecord> {
    const p = i.params ?? null;
    return {
      endpoint: i.endpoint,
      batchId: i.batchId ?? null,
      itemIndex: i.itemIndex ?? null,
      success: i.success,
      mode: i.mode ?? null,
      inputVoltage: p?.inputVoltage ?? null,
      dutyCycle: p?.dutyCycle ?? null,
      inductance: p?.inductance ?? null,
      capacitance: p?.capacitance ?? null,
      switchPeriod: p?.switchPeriod ?? null,
      loadResistance: p?.loadResistance ?? null,
      esr: p?.esr ?? null,
      outputVoltage: i.outputVoltage ?? null,
      ccmOutputVoltage: i.ccmOutputVoltage ?? null,
      inductorCurrentRipple: i.inductorCurrentRipple ?? null,
      capacitorVoltageRipple: i.capacitorVoltageRipple ?? null,
      totalOutputVoltageRipple: i.totalOutputVoltageRipple ?? null,
      request: i.request ?? null,
      result: i.result ?? null,
      errors: i.errors ?? null,
    };
  }
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
