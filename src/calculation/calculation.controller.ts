import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CalculationService } from './calculation.service';
import { BatchDto, CircuitParamsDto } from './dto';
import {
  validateBatchEnvelope,
  validateCircuitInput,
  validateHistoryQuery,
} from '../validation/validation';
import { PRESET_EXAMPLE, EXAMPLE_DESCRIPTION } from './preset';
import {
  BOUNDARY_REL_TOLERANCE,
  VOLT_SECOND_TOLERANCE,
  evaluateFull,
} from '../buck/physics';
import { HistoryService } from '../history/history.service';

/** 把校验错误转成带说明的 400，响应体可读且逐字段指明问题 */
function badRequest(message: string, errors: unknown, extra?: Record<string, unknown>): BadRequestException {
  return new BadRequestException({ ok: false, message, errors, ...extra });
}

@Controller()
export class CalculationController {
  constructor(
    private readonly service: CalculationService,
    private readonly history: HistoryService,
  ) {}

  /** 模式与输出电压接口 */
  @Post('calculate')
  @HttpCode(200)
  async calculate(@Body() body: CircuitParamsDto) {
    const checked = validateCircuitInput(body);
    if (!checked.ok) {
      await this.service.persistFailure('single', body ?? null, checked.errors);
      throw badRequest('参数校验失败，未进行核算', checked.errors);
    }
    const { voltage } = await this.service.calculate(checked.value);
    return { ok: true, voltage };
  }

  /** 纹波接口（电感电流纹波、电容电压纹波、ESR 叠加） */
  @Post('ripple')
  @HttpCode(200)
  async ripple(@Body() body: CircuitParamsDto) {
    const checked = validateCircuitInput(body);
    if (!checked.ok) {
      await this.service.persistFailure('ripple', body ?? null, checked.errors);
      throw badRequest('参数校验失败，未进行核算', checked.errors);
    }
    const { ripple } = await this.service.ripple(checked.value);
    return { ok: true, ripple };
  }

  /** 批量接口：多组参数一次提交，逐组返回；某组非法不影响其余各组 */
  @Post('batch')
  @HttpCode(200)
  async batch(@Body() body: BatchDto) {
    const envelope = validateBatchEnvelope(body);
    if ('error' in envelope) {
      throw badRequest('批量请求格式错误', [envelope.error]);
    }

    const entries = envelope.items.map((raw) => {
      const checked = validateCircuitInput(raw);
      return checked.ok
        ? { raw, parsed: checked.value, errors: [] as never[] }
        : { raw, parsed: null, errors: checked.errors };
    });

    const batch = await this.service.calculateBatch(entries);
    return {
      ok: true,
      batchId: batch.batchId,
      total: batch.results.length,
      successCount: batch.successCount,
      failureCount: batch.failureCount,
      results: batch.results.map((r) =>
        r.ok
          ? { index: r.index, ok: true, result: r.result }
          : { index: r.index, ok: false, errors: r.errors },
      ),
    };
  }

  /** 历史查询接口：按模式 / 成功与否 / 接口类型 / 批次 / 分页过滤 */
  @Get('history')
  async getHistory(
    @Query('mode') mode?: string,
    @Query('success') success?: string,
    @Query('requestType') requestType?: string,
    @Query('batchId') batchId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const q = validateHistoryQuery({ mode, success, requestType, limit, offset });
    if (q.errors.length > 0) {
      throw badRequest('历史查询参数不合法', q.errors);
    }
    const { items, total } = await this.history.query({
      mode: q.mode,
      success: q.success,
      requestType: q.requestType as 'single' | 'ripple' | 'batch' | undefined,
      batchId,
      limit: q.limit,
      offset: q.offset,
    });
    return { ok: true, total, limit: q.limit, offset: q.offset, items };
  }

  /** 配置回显接口：临界公式、K 定义、容差配置 */
  @Get('config')
  config() {
    return {
      ok: true,
      formulas: {
        dimensionlessK: 'K = 2L / (R·Ts)',
        criticalK: 'Kcrit = 1 - D',
        modeRule: 'K > Kcrit → CCM；K < Kcrit → DCM；K == Kcrit → 边界(按 CCM 计)',
        ccmOutputVoltage: 'Vo = D·Vin',
        dcmVoltageEquation: 'K·M² = D²·(1 - M)，K = 2L/(R·Ts)，M = Vo/Vin',
        dcmOutputVoltage:
          'M = 2 / (1 + sqrt(1 + 4K/D²))，严格有 M > D；D2 = D(1-M)/M，空闲段 D3 = 1 - D - D2',
        criticalInductance: 'Lcrit = (1-D)·R·Ts/2',
        ccmInductorRipple: 'ΔiL = (Vin - Vo)·D·Ts/L',
        ccmCapacitorRipple: 'ΔvC = ΔiL·Ts/(8C)（ESR=0）',
        dcmCapacitorRipple:
          'ΔvC = (ip-Io)²·(D+D2)·Ts/(2·ip·C)，ip=(Vin-Vo)D·Ts/L，D2=ip·L/(Vo·Ts)',
        esrRipple: 'Δv_esr = ΔiL·Rc（按电流全摆幅保守叠加）',
      },
      tolerances: {
        voltSecondTolerance: VOLT_SECOND_TOLERANCE,
        boundaryRelativeTolerance: BOUNDARY_REL_TOLERANCE,
      },
      modeNote:
        '标准 Buck 平均模型给出 Kcrit = 1-D：占空比越大 Kcrit 越小，越不容易进入断续。',
      dutyDomain: 'D ∈ (0, 1)（开区间）',
    };
  }

  /** 预置算例：12V 输入、5V 量级输出的 CCM 工况，直接返回核算结果 */
  @Get('example')
  example() {
    return {
      ok: true,
      description: EXAMPLE_DESCRIPTION,
      input: PRESET_EXAMPLE,
      result: evaluateFull(PRESET_EXAMPLE),
    };
  }
}
