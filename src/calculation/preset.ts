import { BuckCircuitInput } from '../buck/physics';

/**
 * 可直接调用的预置算例：12V 输入、5V 量级输出的连续导通工况。
 * D = 5/12 ≈ 0.4167；CCM 下 Vo = D·Vin = 5V。
 * 校验 K = 2·60e-6 / (2·10e-6) = 6 > Kcrit = 1-D ≈ 0.5833 → CCM。
 */
export const PRESET_EXAMPLE: BuckCircuitInput = {
  vin: 12,
  duty: 5 / 12,
  l: 60e-6, // 60 µH
  c: 50e-6, // 50 µF
  ts: 10e-6, // 10 µs（100 kHz）
  r: 2, // 2 Ω（2.5A 负载，5V/2Ω）
  esr: 0,
};

export const EXAMPLE_DESCRIPTION =
  '12V 输入、D≈0.4167、L=60µH、C=50µF、Ts=10µs、R=2Ω：CCM，输出约 5V（=D·Vin）';
