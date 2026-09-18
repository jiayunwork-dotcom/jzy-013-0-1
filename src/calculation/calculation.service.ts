import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  BuckCircuitInput,
  FullResult,
  evaluateFull,
  evaluateRipple,
  evaluateVoltage,
} from '../buck/physics';
import { FieldError } from '../validation/validation';
import { HistoryService } from '../history/history.service';
import { RippleResult, VoltageResult } from '../buck/physics/types';

export interface SuccessSingle {
  ok: true;
  result: FullResult;
}

export interface FailureSingle {
  ok: false;
  errors: FieldError[];
}

export type SingleOutcome = SuccessSingle | FailureSingle;

@Injectable()
export class CalculationService {
  constructor(private readonly history: HistoryService) {}

  /** 模式 + 输出电压核算（同时持久化） */
  async calculate(input: BuckCircuitInput): Promise<{ voltage: VoltageResult }> {
    const voltage = evaluateVoltage(input);
    await this.history.save({
      requestType: 'single',
      input,
      success: true,
      mode: voltage.mode,
      result: { voltage },
    });
    return { voltage };
  }

  /** 纹波核算（同时持久化） */
  async ripple(input: BuckCircuitInput): Promise<{ ripple: RippleResult }> {
    const ripple = evaluateRipple(input);
    await this.history.save({
      requestType: 'ripple',
      input,
      success: true,
      mode: ripple.mode,
      result: { ripple },
    });
    return { ripple };
  }

  /** 记录一次校验失败的请求，保证历史里也能查到被拒绝的调用 */
  async persistFailure(
    requestType: 'single' | 'ripple' | 'batch',
    input: unknown,
    errors: FieldError[],
    batchId?: string,
    batchIndex?: number,
  ): Promise<void> {
    await this.history.save({
      requestType,
      batchId: batchId ?? null,
      batchIndex: batchIndex ?? null,
      input,
      success: false,
      errors,
    });
  }

  /**
   * 批量核算：逐组独立校验、独立计算、独立持久化。
   * 某一组非法不影响其他组；每组都有自己的结果/错误，共享同一个 batchId。
   */
  async calculateBatch(
    entries: Array<{ raw: unknown; parsed: BuckCircuitInput | null; errors: FieldError[] }>,
  ): Promise<{
    batchId: string;
    results: Array<{ index: number; ok: boolean; result?: FullResult; errors?: FieldError[] }>;
    successCount: number;
    failureCount: number;
  }> {
    const batchId = uuidv4();
    const results: Array<{ index: number; ok: boolean; result?: FullResult; errors?: FieldError[] }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const index = i + 1;
      if (entry.parsed === null) {
        failureCount += 1;
        results.push({ index, ok: false, errors: entry.errors });
        await this.history.save({
          requestType: 'batch',
          batchId,
          batchIndex: index,
          input: entry.raw,
          success: false,
          errors: entry.errors,
        });
        continue;
      }

      // 纯函数计算：各请求只依赖自身入参，无共享可变状态，并发下互不串扰
      const result = evaluateFull(entry.parsed);
      successCount += 1;
      results.push({ index, ok: true, result });
      await this.history.save({
        requestType: 'batch',
        batchId,
        batchIndex: index,
        input: entry.parsed,
        success: true,
        mode: result.voltage.mode,
        result,
      });
    }

    return { batchId, results, successCount, failureCount };
  }
}
