import {
  VOLT_SECOND_TOLERANCE,
  ccmVoltage,
  criticalInductance,
  dimensionlessK,
  dcmVoltageRatio,
  evaluateFull,
  evaluateRipple,
  evaluateVoltage,
} from './index';
import { BuckCircuitInput } from './types';

const base: BuckCircuitInput = {
  vin: 12,
  duty: 5 / 12,
  l: 60e-6,
  c: 50e-6,
  ts: 10e-6,
  r: 2,
  esr: 0,
};

describe('Buck 平均模型物理核算', () => {
  // 规则 1：连续模式输出等于占空比乘输入
  test('CCM 输出电压 Vo = D·Vin，模式判 CCM，伏秒在容差内闭合', () => {
    const v = evaluateVoltage(base);
    expect(v.mode).toBe('CCM');
    expect(v.outputVoltage).toBeCloseTo(base.duty * base.vin, 12);
    expect(v.outputVoltage).toBeCloseTo(5, 9);
    expect(v.voltSecondClosed).toBe(true);
    expect(v.voltSecondResidual).toBeLessThanOrEqual(VOLT_SECOND_TOLERANCE);
    expect(ccmVoltage(base)).toBeCloseTo(5, 12);
  });

  // 规则 2：只把电感减小到边界以下，必须翻成 DCM，且输出高于 D·Vin
  test('电感减小到 Lcrit 以下翻 DCM，输出严格高于 CCM 预测 D·Vin', () => {
    const ccm = evaluateVoltage(base);
    expect(ccm.mode).toBe('CCM');

    const lcrit = criticalInductance(base);
    expect(dimensionlessK(base)).toBeGreaterThan(1 - base.duty);

    const dcmInput: BuckCircuitInput = { ...base, l: lcrit * 0.3 };
    const dcm = evaluateVoltage(dcmInput);
    expect(dcm.mode).toBe('DCM');
    expect(dcm.outputVoltage).toBeGreaterThan(dcm.ccmPrediction);
    expect(dcm.boundary.k).toBeLessThan(dcm.boundary.kCritical);
    // DCM 伏秒关系闭合（两段电感伏秒之和为 0）
    expect(dcm.voltSecondClosed).toBe(true);
    // DCM 安秒（电荷）平衡同样必须闭合：电感平均电流等于输出电流
    expect(dcm.ampSecondClosed).toBe(true);
    expect(dcm.ampSecondResidual).not.toBeNull();
    expect(dcm.ampSecondResidual as number).toBeLessThan(1e-12);
    expect(dcm.balanced).toBe(true);
    // DCM 电压比与直接解析式一致
    expect(dcm.ratio).toBeCloseTo(dcmVoltageRatio(dcmInput), 14);
    // 输出不能超过输入
    expect(dcm.outputVoltage).toBeLessThan(base.vin);
    // DCM 空闲段占比为正
    expect(dcm.idleFraction).toBeGreaterThan(0);
  });

  test('边界 K = Kcrit 时 atBoundary=true 且按 CCM 处理，M 连续等于 D', () => {
    const boundary: BuckCircuitInput = { ...base, l: criticalInductance(base) };
    const v = evaluateVoltage(boundary);
    expect(v.boundary.atBoundary).toBe(true);
    expect(v.mode).toBe('CCM');
    expect(v.outputVoltage).toBeCloseTo(base.duty * base.vin, 9);
  });

  // 规则 3：只把占空比加倍且仍连续、输出未达输入，输出电压加倍
  test('占空比加倍（仍 CCM、未达输入）输出电压加倍', () => {
    const low: BuckCircuitInput = { ...base, duty: 0.2 };
    const doubled: BuckCircuitInput = { ...base, duty: 0.4 };
    const a = evaluateVoltage(low);
    const b = evaluateVoltage(doubled);
    expect(a.mode).toBe('CCM');
    expect(b.mode).toBe('CCM');
    expect(b.outputVoltage).toBeLessThan(base.vin);
    expect(b.outputVoltage).toBeCloseTo(2 * a.outputVoltage, 12);
  });

  // 规则 4：只把开关周期加倍，CCM 下电感电流纹波加倍
  test('开关周期加倍，CCM 电感电流纹波加倍', () => {
    const slow: BuckCircuitInput = { ...base, ts: base.ts * 2 };
    expect(evaluateVoltage(slow).mode).toBe('CCM');
    const r1 = evaluateRipple(base).inductorCurrentRipple;
    const r2 = evaluateRipple(slow).inductorCurrentRipple;
    expect(r2).toBeCloseTo(2 * r1, 12);
  });

  // 规则 5：输入加倍且仍连续，输出与电流纹波同比放大
  test('输入电压加倍（仍 CCM）输出与纹波同比放大 2 倍', () => {
    const hi: BuckCircuitInput = { ...base, vin: 24 };
    const a = evaluateFull(base);
    const b = evaluateFull(hi);
    expect(b.voltage.mode).toBe('CCM');
    expect(b.voltage.outputVoltage).toBeCloseTo(2 * a.voltage.outputVoltage, 12);
    expect(b.ripple.inductorCurrentRipple).toBeCloseTo(2 * a.ripple.inductorCurrentRipple, 12);
  });

  test('CCM 电容纹波 ΔvC = ΔiL·Ts/(8C)，ESR 压降叠加', () => {
    const noEsr = evaluateRipple(base);
    const expectedCap = (noEsr.inductorCurrentRipple * base.ts) / (8 * base.c);
    expect(noEsr.capacitorVoltageRipple).toBeCloseTo(expectedCap, 15);
    expect(noEsr.outputVoltageRipple).toBeCloseTo(expectedCap, 15);

    const withEsr = evaluateRipple({ ...base, esr: 0.01 });
    expect(withEsr.esrVoltageRipple).toBeCloseTo(noEsr.inductorCurrentRipple * 0.01, 15);
    expect(withEsr.outputVoltageRipple).toBeCloseTo(
      expectedCap + noEsr.inductorCurrentRipple * 0.01,
      15,
    );
  });

  test('DCM 纹波走断续关系，峰值即峰谷摆幅且输出纹波为正', () => {
    const dcm: BuckCircuitInput = { ...base, l: criticalInductance(base) * 0.3 };
    const full = evaluateFull(dcm);
    expect(full.voltage.mode).toBe('DCM');
    expect(full.ripple.mode).toBe('DCM');
    expect(full.ripple.inductorCurrentRipple).toBeGreaterThan(0);
    expect(full.ripple.capacitorVoltageRipple).toBeGreaterThan(0);
    // 峰值必须大于平均输出电流（DCM 三角波）
    const io = full.voltage.outputVoltage / dcm.r;
    expect(full.ripple.inductorCurrentRipple).toBeGreaterThan(io);
  });

  test('DCM 解析解在边界连续退化为 M=D，且 D 越大 DCM 升压抬升越小', () => {
    const mDeep = dcmVoltageRatio({ duty: 0.4, l: 1e-6, r: 10, ts: 10e-6 });
    const mDeepHighDuty = dcmVoltageRatio({ duty: 0.8, l: 1e-6, r: 10, ts: 10e-6 });
    expect(mDeep).toBeGreaterThan(0.4);
    expect(mDeepHighDuty).toBeGreaterThan(0.8);
    // 同样 K 下，D 越大 M 越接近 D（越不易断续，抬升越小）
    expect(mDeepHighDuty - 0.8).toBeLessThan(mDeep - 0.4);
  });

  test('DCM 解析解与教科书数值一致（D=0.3, K=0.02 → M≈0.8423）', () => {
    // K = 2*1e-6/(10*10e-6) = 0.02
    const m = dcmVoltageRatio({ duty: 0.3, l: 1e-6, r: 10, ts: 10e-6 });
    expect(m).toBeCloseTo(0.8423, 3);
    // 显式满足 K·M² = D²·(1-M)
    expect(0.02 * m * m).toBeCloseTo(0.09 * (1 - m), 12);
  });
});
