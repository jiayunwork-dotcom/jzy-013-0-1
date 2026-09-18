import { IDLE_FRACTION_FLOOR, VOLT_SECOND_TOLERANCE } from './constants';
import { evaluateMode } from './mode';
import { BuckCircuitInput, ConductionMode, VoltageResult } from './types';

/** CCM 平均模型：理想开关伏秒平衡给出 Vo = D·Vin */
export function ccmVoltage(input: Pick<BuckCircuitInput, 'vin' | 'duty'>): number {
  return input.vin * input.duty;
}

/**
 * DCM 输出电压比 M = Vo/Vin（标准 Buck 断续导通平均模型，解析解）。
 *
 * 电感电流每个周期从 0 升到峰值再降回 0：
 *   开关导通段：ip = (Vin - Vo)·D·Ts/L
 *   二极管续流段 D2：Vo = L·ip/(D2·Ts)，即 D2 = D·(1 - M)/M
 * 周期平均电感电流（三角波面积/Ts）等于输出电流 Vo/R：
 *   ip·(D + D2)/2 = Vo/R
 * 代入 K = 2L/(R·Ts) 整理为关于 M 的方程：
 *   K·M² = D²·(1 - M)
 * 即 K·M² + D²·M - D² = 0，取 (0,1) 内的正根：
 *   M = 2 / (1 + sqrt(1 + 4K/D²))
 *     = D·(sqrt(D² + 4K) - D)/(2K)
 * 边界 K = 1-D 时连续退化为 M = D；K < 1-D 时严格 M > D（DCM 输出高于 D·Vin）。
 */
export function dcmVoltageRatio(input: Pick<BuckCircuitInput, 'duty' | 'l' | 'r' | 'ts'>): number {
  const d = input.duty;
  const k = (2 * input.l) / (input.r * input.ts);
  return 2 / (1 + Math.sqrt(1 + (4 * k) / (d * d)));
}

/** DCM 二极管续流占空比 D2（电感从峰值降到 0 的时间占比），由伏秒关系给出 */
export function dcmDiodeDuty(duty: number, ratio: number): number {
  return (duty * (1 - ratio)) / ratio;
}

/**
 * 伏秒平衡残差（归一化到 Vin）：电感一个周期的平均电压必须为 0。
 *   CCM: D·Vin - Vo == 0
 *   DCM: (Vin - Vo)·D - Vo·D2 == 0
 */
export function voltSecondResidual(
  input: BuckCircuitInput,
  outputVoltage: number,
  dutyDiode: number,
  mode: ConductionMode,
): number {
  if (input.vin <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const applied = mode === 'CCM'
    ? input.duty * input.vin - outputVoltage
    : (input.vin - outputVoltage) * input.duty - outputVoltage * dutyDiode;
  return Math.abs(applied) / input.vin;
}

/**
 * DCM 安秒（电荷）平衡残差（归一化到输出电流 Io）：这才是决定 DCM 输出电压的方程。
 *   ip·(D + D2)/2 == Vo/R
 */
export function dcmAmpSecondResidual(
  input: BuckCircuitInput,
  outputVoltage: number,
  dutyDiode: number,
): number {
  const ip = ((input.vin - outputVoltage) * input.duty * input.ts) / input.l;
  const averageInductorCurrent = (ip * (input.duty + dutyDiode)) / 2;
  const outputCurrent = outputVoltage / input.r;
  if (outputCurrent === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(averageInductorCurrent - outputCurrent) / outputCurrent;
}

/**
 * 模式与输出电压核算：先判模式，再走该模式对应的电压关系（两者严格一致）。
 * CCM 边界按 CCM 处理；DCM 输出严格高于 D·Vin。
 * 算完把输出代回平衡关系做闭合校验（CCM 伏秒；DCM 伏秒 + 安秒）。
 */
export function evaluateVoltage(input: BuckCircuitInput): VoltageResult {
  const boundary = evaluateMode(input);
  const ccmPrediction = ccmVoltage(input);

  let outputVoltage: number;
  let dutyDiode: number;
  let idleFraction: number;
  let ampSecondResidual: number | null;

  if (boundary.mode === 'CCM') {
    outputVoltage = ccmPrediction;
    // CCM 下同步/二极管续流占空比为 1-D
    dutyDiode = 1 - input.duty;
    idleFraction = 0;
    ampSecondResidual = null;
  } else {
    const ratio = dcmVoltageRatio(input);
    outputVoltage = ratio * input.vin;
    dutyDiode = dcmDiodeDuty(input.duty, ratio);
    // DCM 三段：开关管 D、二极管 D2、电感电流为零的空闲段 D3
    idleFraction = 1 - input.duty - dutyDiode;
    // 数值钳制：仅允许极小的浮点噪声导致空闲段为负
    if (idleFraction < IDLE_FRACTION_FLOOR) {
      throw new Error(`DCM 内部不一致：空闲段占空比 ${idleFraction} 超出容差，输入 ${JSON.stringify(input)}`);
    }
    if (idleFraction < 0) {
      idleFraction = 0;
    }
    if (dutyDiode < 0) {
      dutyDiode = 0;
    }
    ampSecondResidual = dcmAmpSecondResidual(input, outputVoltage, dutyDiode);
  }

  const residual = voltSecondResidual(input, outputVoltage, dutyDiode, boundary.mode);
  const voltSecondClosed = residual <= VOLT_SECOND_TOLERANCE;
  const ampSecondClosed = ampSecondResidual === null ? true : ampSecondResidual <= VOLT_SECOND_TOLERANCE;

  return {
    mode: boundary.mode,
    outputVoltage,
    ccmPrediction,
    ratio: outputVoltage / input.vin,
    dutyDiode,
    idleFraction,
    boundary,
    voltSecondResidual: residual,
    voltSecondClosed,
    ampSecondResidual,
    ampSecondClosed,
    balanced: voltSecondClosed && ampSecondClosed,
  };
}
