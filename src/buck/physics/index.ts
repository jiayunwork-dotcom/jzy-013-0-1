import { evaluateRipple } from './ripple';
import { FullResult, BuckCircuitInput } from './types';
import { evaluateVoltage } from './voltage';

/** 一次完整核算：模式 + 输出电压（含边界与伏秒闭合校验）+ 纹波 */
export function evaluateFull(input: BuckCircuitInput): FullResult {
  const voltage = evaluateVoltage(input);
  const ripple = evaluateRipple(input);
  return { input, voltage, ripple };
}

export * from './types';
export * from './constants';
export { dimensionlessK, criticalK, criticalInductance, criticalResistance, evaluateMode } from './mode';
export { ccmVoltage, dcmVoltageRatio, dcmDiodeDuty, voltSecondResidual, evaluateVoltage } from './voltage';
export { inductorCurrentRipple, evaluateRipple } from './ripple';
