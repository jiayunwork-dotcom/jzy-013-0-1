import { BOUNDARY_REL_TOLERANCE } from './constants';
import { BuckCircuitInput, ConductionMode, ModeBoundary } from './types';

/**
 * 无量纲参数 K = 2L / (R·Ts)。
 * K 综合了电感、负载与开关周期：L 越小、负载越轻(R 越大)、周期越长，K 越小。
 */
export function dimensionlessK(input: Pick<BuckCircuitInput, 'l' | 'r' | 'ts'>): number {
  return (2 * input.l) / (input.r * input.ts);
}

/**
 * 临界无量纲参数 Kcrit = 1 - D。
 *
 * 推导（电感电流边界条件：开关周期末电感电流恰好降到 0）：
 *   导通期间电流上升斜率 (Vin - Vo)/L，CCM 时 Vo = D·Vin；
 *   临界电感电流（三角波谷值为 0）平均值 Io = Vo/R 等于峰峰值的一半，
 *   由此 Lcrit = (1 - D)·R·Ts/2，即 Kcrit = 2Lcrit/(R·Ts) = 1 - D。
 *
 * K > Kcrit 为连续导通(CCM)，K < Kcrit 为断续导通(DCM)，K == Kcrit 为边界。
 * D 越大 Kcrit 越小，即占空比越大越不容易进入断续。
 */
export function criticalK(duty: number): number {
  return 1 - duty;
}

/** 临界电感 Lcrit = (1-D)·R·Ts/2：电感低于该值进入 DCM */
export function criticalInductance(input: Pick<BuckCircuitInput, 'duty' | 'r' | 'ts'>): number {
  return (criticalK(input.duty) * input.r * input.ts) / 2;
}

/** 临界负载电阻 Rcrit = 2L / ((1-D)·Ts)：R 大于该值（轻载）进入 DCM */
export function criticalResistance(input: Pick<BuckCircuitInput, 'duty' | 'l' | 'ts'>): number {
  return (2 * input.l) / (criticalK(input.duty) * input.ts);
}

/** 模式判定 + 模式边界。边界(K==Kcrit)按 CCM 处理（CCM 公式在边界连续成立），另置 atBoundary。 */
export function evaluateMode(input: BuckCircuitInput): ModeBoundary {
  const k = dimensionlessK(input);
  const kCritical = criticalK(input.duty);
  const rel = Math.abs(kCritical) < 1e-300 ? Math.abs(k - kCritical) : Math.abs(k - kCritical) / kCritical;
  const atBoundary = rel <= BOUNDARY_REL_TOLERANCE;
  const mode: ConductionMode = k >= kCritical ? 'CCM' : 'DCM';
  return {
    k,
    kCritical,
    mode,
    atBoundary,
    criticalInductance: criticalInductance(input),
    criticalResistance: criticalResistance(input),
  };
}
