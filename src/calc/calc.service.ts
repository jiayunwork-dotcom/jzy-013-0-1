import { Injectable } from '@nestjs/common';
import { evaluate, presetExample } from './domain/engine';
import { EvaluationResult } from './domain/types';
import { FieldError } from './domain/validation';
import { CalcConfigService } from './calc-config.service';
import { HistoryService, RecordInput } from '../persistence/history.service';

export interface SingleOutcome {
  result: EvaluationResult;
  recordId: string;
}

export interface BatchItemOutcome {
  index: number;
  success: boolean;
  result?: EvaluationResult;
  errors?: FieldError[];
}

export interface BatchOutcome {
  batchId: string;
  total: number;
  successCount: number;
  failureCount: number;
  results: BatchItemOutcome[];
}

@Injectable()
export class CalcService {
  constructor(
    private readonly config: CalcConfigService,
    private readonly history: HistoryService,
  ) {}

  /** Full evaluation for one parameter set (mode + voltage + ripple). */
  computeOne(raw: unknown) {
    return evaluate(raw, {
      voltSecondTol: this.config.voltSecondTol,
      boundaryTol: this.config.boundaryTol,
    });
  }

  /** POST /mode : mode detection + averaged output voltage, persisted. */
  async evaluateMode(raw: unknown): Promise<SingleOutcome> {
    const outcome = this.computeOne(raw);
    if (!outcome.ok) {
      return Promise.reject(new ValidationFailure(outcome.errors));
    }
    const saved = await this.history.saveSingle(
      this.toRecordInput('mode', raw, outcome.result, null),
    );
    return { result: outcome.result, recordId: saved.id };
  }

  /** POST /ripple : mode-consistent ripple, persisted. */
  async evaluateRipple(raw: unknown): Promise<SingleOutcome> {
    const outcome = this.computeOne(raw);
    if (!outcome.ok) {
      return Promise.reject(new ValidationFailure(outcome.errors));
    }
    const saved = await this.history.saveSingle(
      this.toRecordInput('ripple', raw, outcome.result, null),
    );
    return { result: outcome.result, recordId: saved.id };
  }

  /**
   * POST /batch : evaluate every item independently. One invalid item is
   * reported with its position and offending parameter; the others still
   * produce results. The whole batch (including failures) is stored in a
   * single transaction so concurrent batches never interleave.
   */
  async evaluateBatch(raw: unknown): Promise<BatchOutcome> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new ValidationFailure([
        {
          field: '(body)',
          code: 'NOT_AN_OBJECT',
          message: 'batch body must be an object with an "items" array',
        },
      ]);
    }
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationFailure([
        {
          field: 'items',
          code: 'MISSING_FIELD',
          message: '"items" must be a non-empty array of circuit parameter sets',
        },
      ]);
    }

    const outcomes: BatchItemOutcome[] = items.map((item, index) => {
      const o = evaluate(item, {
        voltSecondTol: this.config.voltSecondTol,
        boundaryTol: this.config.boundaryTol,
        index,
      });
      return o.ok
        ? { index, success: true, result: o.result }
        : { index, success: false, errors: o.errors };
    });

    const records: RecordInput[] = outcomes.map((o) =>
      o.success
        ? this.toRecordInput('batch', items[o.index], o.result!, o.index)
        : {
            endpoint: 'batch' as const,
            itemIndex: o.index,
            success: false as const,
            request: (items[o.index] as Record<string, unknown>) ?? null,
            errors: (o.errors ?? []) as unknown as Record<string, unknown>[],
          },
    );

    const { batchId } = await this.history.saveBatch(records);
    const successCount = outcomes.filter((o) => o.success).length;

    return {
      batchId,
      total: outcomes.length,
      successCount,
      failureCount: outcomes.length - successCount,
      results: outcomes,
    };
  }

  /** Ready-to-call 12 V -> ~5 V CCM example (params + expected result). */
  example(): { params: Record<string, number>; result: EvaluationResult } {
    const { params } = presetExample();
    const outcome = this.computeOne(params);
    if (!outcome.ok) throw new Error('preset example failed to evaluate');
    return { params: { ...params }, result: outcome.result };
  }

  private toRecordInput(
    endpoint: 'mode' | 'ripple' | 'batch',
    raw: unknown,
    r: EvaluationResult,
    itemIndex: number | null,
  ): RecordInput {
    const rawObj =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    const num = (k: string): number | undefined => {
      const v = rawObj[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };
    return {
      endpoint,
      itemIndex,
      success: true,
      mode: r.mode,
      params: {
        inputVoltage: num('inputVoltage'),
        dutyCycle: num('dutyCycle'),
        inductance: num('inductance'),
        capacitance: num('capacitance'),
        switchPeriod: num('switchPeriod'),
        loadResistance: num('loadResistance'),
        esr: num('esr'),
      },
      outputVoltage: r.outputVoltage,
      ccmOutputVoltage: r.ccmOutputVoltage,
      inductorCurrentRipple: r.ripple.inductorCurrentRipple,
      capacitorVoltageRipple: r.ripple.capacitorVoltageRipple,
      totalOutputVoltageRipple: r.ripple.totalOutputVoltageRipple,
      request: rawObj,
      result: r as unknown as Record<string, unknown>,
    };
  }
}

/** Carries structured field errors to the HTTP exception filter. */
export class ValidationFailure extends Error {
  constructor(public readonly errors: FieldError[]) {
    super('input validation failed');
    this.name = 'ValidationFailure';
  }
}
