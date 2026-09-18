/** 物理层常量与数值容差（可被配置接口回显） */

/**
 * 伏秒平衡闭合校验的相对容差。
 * 把算出的输出电压代回伏秒关系：CCM 下 D·Vin - Vo 必须“钉死”为 0；
 * 这里用 1e-9 的归一化容差做数值判定。
 */
export const VOLT_SECOND_TOLERANCE = 1e-9;

/** 判定 K 与 Kcrit 是否恰好相等（相对容差）的边界容差 */
export const BOUNDARY_REL_TOLERANCE = 1e-9;

/**
 * 计算结果允许的最大占空比“空闲段”负值（浮点噪声）；超过说明内部求解不一致。
 * 见 voltage.ts 中 DCM 三段时间 D3 = 1 - D - D2。
 */
export const IDLE_FRACTION_FLOOR = -1e-9;
