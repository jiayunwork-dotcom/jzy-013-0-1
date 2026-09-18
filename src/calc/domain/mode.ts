import {
  ConductionMode,
  CircuitParams,
  ModeBoundaryInfo,
} from './types';
import { DEFAULT_BOUNDARY_TOL } from './constants';

/** Dimensionless inductance parameter K = 2L / (R Ts). */
export function dimensionlessK(p: Pick<
  CircuitParams,
  'inductance' | 'loadResistance' | 'switchPeriod'
>): number {
  return (2 * p.inductance) / (p.loadResistance * p.switchPeriod);
}

/**
 * Critical value of K at the mode boundary for a buck converter:
 *
 *     Kcrit(D) = 1 - D
 *
 * Derived from the inductor current valley reaching zero exactly at the
 * instant the switch turns on (i_min = I_L - dI/2 = 0).
 */
export function criticalK(dutyCycle: number): number {
  return 1 - dutyCycle;
}

/** Inductance Lcrit = Kcrit * R * Ts / 2 at which the converter is at CRM. */
export function criticalInductance(
  p: Pick<CircuitParams, 'loadResistance' | 'switchPeriod'>,
  dutyCycle: number,
): number {
  return (criticalK(dutyCycle) * p.loadResistance * p.switchPeriod) / 2;
}

/**
 * Classify the operating mode purely from the geometry of the inductor
 * waveform (K compared against Kcrit), independent of the voltage model.
 */
export function detectMode(
  p: CircuitParams,
  tolerance: number = DEFAULT_BOUNDARY_TOL,
): { mode: ConductionMode; K: number; Kcrit: number } {
  const K = dimensionlessK(p);
  const Kcrit = criticalK(p.dutyCycle);
  const scale = Math.max(1, Math.abs(K), Math.abs(Kcrit));
  const diff = K - Kcrit;

  let mode: ConductionMode;
  if (Math.abs(diff) <= tolerance * scale) {
    mode = 'BOUNDARY';
  } else if (diff > 0) {
    mode = 'CCM';
  } else {
    mode = 'DCM';
  }
  return { mode, K, Kcrit };
}

/** Assemble the full boundary report (with the equivalent boundaries). */
export function buildBoundaryInfo(
  p: CircuitParams,
  tolerance: number = DEFAULT_BOUNDARY_TOL,
): ModeBoundaryInfo & { mode: ConductionMode } {
  const { mode, K, Kcrit } = detectMode(p, tolerance);
  const { loadResistance: R, switchPeriod: Ts, dutyCycle: D } = p;
  return {
    mode,
    K,
    Kcrit,
    criticalInductance: (Kcrit * R * Ts) / 2,
    // Holding L, Ts fixed: boundary R = 2L / (Kcrit Ts)
    criticalLoadResistance: (2 * p.inductance) / (Kcrit * Ts),
    // Holding L, R fixed: boundary Ts = 2L / (Kcrit R)
    criticalSwitchPeriod: (2 * p.inductance) / (Kcrit * R),
    tolerance,
  };
}
