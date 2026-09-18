import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationRecord, RequestType } from './calculation-record.entity';

export interface RecordInput {
  requestType: RequestType;
  batchId?: string | null;
  batchIndex?: number | null;
  input: unknown;
  success: boolean;
  mode?: string | null;
  result?: unknown;
  errors?: unknown;
}

export interface HistoryFilter {
  mode?: 'CCM' | 'DCM';
  success?: boolean;
  requestType?: RequestType;
  batchId?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(CalculationRecord)
    private readonly repo: Repository<CalculationRecord>,
  ) {}

  /** 持久化一条核算记录；批量内逐组各写一条 */
  async save(entry: RecordInput): Promise<CalculationRecord> {
    const record = this.repo.create({
      requestType: entry.requestType,
      batchId: entry.batchId ?? null,
      batchIndex: entry.batchIndex ?? null,
      input: entry.input,
      success: entry.success,
      mode: entry.mode ?? null,
      result: entry.result ?? null,
      errors: entry.errors ?? null,
    });
    return this.repo.save(record);
  }

  /** 按条件查询历史（模式 / 成功与否 / 接口类型 / 批次 / 分页） */
  async query(filter: HistoryFilter): Promise<{ items: CalculationRecord[]; total: number }> {
    const qb = this.repo.createQueryBuilder('r');
    if (filter.mode) {
      qb.andWhere('r.mode = :mode', { mode: filter.mode });
    }
    if (filter.success !== undefined) {
      qb.andWhere('r.success = :success', { success: filter.success });
    }
    if (filter.requestType) {
      qb.andWhere('r.requestType = :requestType', { requestType: filter.requestType });
    }
    if (filter.batchId) {
      qb.andWhere('r.batchId = :batchId', { batchId: filter.batchId });
    }
    qb.orderBy('r.id', 'DESC').skip(filter.offset).take(filter.limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
