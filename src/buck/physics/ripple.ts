import { evaluateVoltage } from './voltage';
import { BuckCircuitInput, RippleResult } from './types';

/**
 * 电感电流峰峰值 ΔiL。
 *
 * CCM（导通段线性上升，关断段线性下降）：
 *   ΔiL = (Vin - Vo)·D·Ts / L
 * DCM（电流每个周期从 0 升到峰值再降回 0）：峰峰值即峰值
 *   ip = (Vin - Vo)·D·Ts / L
 * 两种模式形式一致，区别只在代入的 Vo（CCM=D·Vin，DCM> D·Vin）。
 */
export function inductorCurrentRipple(input: BuckCircuitInput, outputVoltage: number): number {
  return ((input.vin - outputVoltage) * input.duty * input.ts) / input.l;
}

/**
 * CCM 电容电压纹波（峰峰值，ESR=0）。
 *
 * 电感电流为三角波、围绕 Io 上下对称，超出 Io 的部分对电容充电（另半段放电）。
 * 一个充电“三角形”面积 ΔQ = 1/2 · (ΔiL/2) · (Ts/2) = ΔiL·Ts/8，故
 *   ΔvC = ΔQ/C = ΔiL·Ts/(8C) = ΔiL/(8·fs·C)
 * 这正是 Buck 输出纹波的标准结果（CCM、零 ESR）。
 */
function ccmCapacitorRipple(di: number, input: BuckCircuitInput): number {
  return (di * input.ts) / (8 * input.c);
}

/**
 * DCM 电容电压纹波（峰峰值，ESR=0，精确积分）。
 *
 * 周期内电感电流三角波：0 →D·Ts 上升到 ip→ (D+D2)·Ts 降回 0 → 空闲段保持 0。
 * 平均值 iL,avg = ip·(D + D2)/2 = Io。iL 两次穿过 Io：上升段 μD、下降段 μD2，
 * 其中 μ = Io/ip。iL > Io 期间电容吸收的电荷（一个三角形）：
 *   ΔQ = 1/2 · (ip - Io) · [D·Ts - μ·D·Ts + D2·Ts - μ·D2·Ts]
 *      = (ip - Io)² · (D + D2) · Ts / (2·ip)
 *   ΔvC = ΔQ / C
 * 空闲段 iL=0 < Io，电容持续放电，但最低点已取在下降段穿过 Io 的时刻，
 * 之后充电回到下周期起点，故峰峰值即上式（充放电净电荷为零，已由 iL,avg=Io 保证）。
 */
function dcmCapacitorRipple(di: number, input: BuckCircuitInput, outputVoltage: number, dutyDiode: number): number {
  const io = outputVoltage / input.r;
  const ip = di;
  if (ip <= io) {
    // 理论上 DCM 必有 ip > Io；命中说明模式/公式不一致，直接抛错而不是静默给出错误纹波
    throw new Error(`DCM 纹波内部不一致：电感峰值 ${ip} 不大于平均电流 ${io}`);
  }
  const charge = (Math.pow(ip - io, 2) * (input.duty + dutyDiode) * input.ts) / (2 * ip);
  return charge / input.c;
}

/**
 * 纹波核算（电流纹波 + 电容电压纹波，可选 ESR 叠加）。
 * 模式判定与纹波公式严格对应：CCM 走对称三角波关系，DCM 走断续三角波关系。
 */
export function evaluateRipple(input: BuckCircuitInput): RippleResult {
  const voltage = evaluateVoltage(input);
  const di = inductorCurrentRipple(input, voltage.outputVoltage);

  const capRipple = voltage.mode === 'CCM'
    ? ccmCapacitorRipple(di, input)
    : dcmCapacitorRipple(di, input, voltage.outputVoltage, voltage.dutyDiode);

  // ESR 压降按电感电流全摆幅估算（保守上界）：Δv_esr = ΔiL · Rc
  const esr = input.esr ?? 0;
  const esrRipple = di * esr;

  return {
    mode: voltage.mode,
    inductorCurrentRipple: di,
    capacitorVoltageRipple: capRipple,
    esrVoltageRipple: esrRipple,
    outputVoltageRipple: capRipple + esrRipple,
    esr,
  };
}
