/**
 * 降压(Buck)变换器平均模型 —— 纯物理计算层
 *
 * 该层不依赖 NestJS / 数据库，只做输入校验、模式判定、电压平均模型与纹波计算，
 * 便于单元测试与复用。
 *
 * 输入符号约定：
 *   vin  输入电压      V
 *   duty 占空比 D      开区间 (0, 1)
 *   l    电感 L        H
 *   c    电容 C        F
 *   ts   开关周期 Ts   s  (fs = 1/Ts)
 *   r    负载电阻 R    Ω
 *   esr  电容串联电阻  Ω（可选，默认 0）
 */

/** 调用方提交的一组电路参数 */
export interface BuckCircuitInput {
  vin: number;
  duty: number;
  l: number;
  c: number;
  ts: number;
  r: number;
  esr?: number;
}

export type ConductionMode = 'CCM' | 'DCM';

/** 无量纲参数 K = 2L / (R·Ts) 与模式边界的判定结果 */
export interface ModeBoundary {
  /** 无量纲参数 K = 2L / (R·Ts) */
  k: number;
  /** 临界 K：Kcrit = 1 - D（标准 Buck 平均模型） */
  kCritical: number;
  /** 本工况下的模式 */
  mode: ConductionMode;
  /** 是否恰好落在临界边界上（数值意义） */
  atBoundary: boolean;
  /** 临界边界电感 Lcrit = Kcrit · R · Ts / 2 = (1-D) R Ts / 2；低于它进入 DCM */
  criticalInductance: number;
  /** 临界边界负载电阻 Rcrit = 2L / (Kcrit · Ts)；R 大于它（负载更轻）进入 DCM */
  criticalResistance: number;
}

/** 模式与输出电压核算结果 */
export interface VoltageResult {
  mode: ConductionMode;
  outputVoltage: number;
  /** 连续模式预测值 D·Vin，DCM 下用于对比（DCM 输出严格更高） */
  ccmPrediction: number;
  ratio: number;
  dutyDiode: number;
  idleFraction: number;
  boundary: ModeBoundary;
  /** 伏秒平衡闭合校验残差（归一化到 Vin），CCM 为 0；DCM 两段伏秒亦应闭合 */
  voltSecondResidual: number;
  voltSecondClosed: boolean;
  /**
   * DCM 安秒（电荷）平衡残差（归一化到 Io）：ip(D+D2)/2 与 Vo/R 的相对偏差；
   * 这是决定 DCM 输出电压的方程。CCM 下为 null。
   */
  ampSecondResidual: number | null;
  ampSecondClosed: boolean;
  /** 综合平衡判定（CCM 查伏秒；DCM 伏秒与安秒都必须闭合） */
  balanced: boolean;
}

/** 纹波核算结果（峰峰值） */
export interface RippleResult {
  mode: ConductionMode;
  /** 电感电流峰峰值 A；DCM 下即 iL 峰值（谷值为 0） */
  inductorCurrentRipple: number;
  /** 纯电容充放电带来的输出电压纹波峰峰值 V */
  capacitorVoltageRipple: number;
  /** ESR 上的电流纹波压降 V（无 ESR 时为 0） */
  esrVoltageRipple: number;
  /** 总输出电压纹波峰峰值 V（两者叠加） */
  outputVoltageRipple: number;
  esr: number;
}

/** 电压 + 纹波的完整核算结果 */
export interface FullResult {
  input: BuckCircuitInput;
  voltage: VoltageResult;
  ripple: RippleResult;
}
