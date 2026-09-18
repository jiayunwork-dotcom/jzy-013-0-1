import { CircuitParams, ModeResult, ConductionMode } from './types';
import { DEFAULT_VOLT_SECOND_TOL } from './constants';
import { buildBoundaryInfo } from './mode';

/** CCM averaged output voltage from ideal switch volt-second balance. */
export function ccmOutputVoltage(p: Pick<CircuitParams, 'inputVoltage' | 'dutyCycle'>): number {
  return p.dutyCycle * p.inputVoltage;
}

/**
 * DCM conversion ratio M(D, K) for an ideal buck converter.
 *
 * Inductor volt-second balance plus the output-node amp-second balance on the
 * triangular inductor current (<iL> = Vout/R) give:
 *
 *     M = 2D / (D + sqrt(D^2 + 4K))
 *
 * At K = 1 - D this collapses continuously to M = D (the CCM solution), and
 * for K < 1 - D it is strictly greater than D, so Vout(DCM) > D * Vin.
 */
export function dcmConversionRatio(dutyCycle: number, K: number): number {
  const D = dutyCycle;
  return (2 * D) / (D + Math.sqrt(D * D + 4 * K));
}

/**
 * Diode (off-state) conduction fraction D2 in DCM:
 *
 *     D2 = D * (Vin - Vout) / Vout = D * (1 - M) / M
 */
export function dcmDiodeDuty(dutyCycle: number, M: number): number {
  return (dutyCycle * (1 - M)) / M;
}

/** Inductor volt-second balance closure: on vs off applied volt-seconds. */
function voltSecondCheck(
  onVoltage: number,
  onFraction: number,
  offVoltage: number,
  offFraction: number,
  ts: number,
  tolerance: number,
): ModeResult['voltSecondCheck'] {
  const on = onVoltage * onFraction * ts;
  const off = offVoltage * offFraction * ts;
  const residual = on - off;
  const denom = (Math.abs(on) + Math.abs(off)) / 2 || 1;
  const relativeResidual = Math.abs(residual) / denom;
  return {
    on,
    off,
    residual,
    relativeResidual,
    tolerance,
    closed: relativeResidual <= tolerance,
  };
}

/**
 * Run the averaged voltage model. The voltage branch used is forced to match
 * the mode detected from K vs Kcrit: CCM/BOUNDARY use Vout = D Vin, DCM uses
 * the DCM ratio. (BOUNDARY is evaluated on the CCM branch because the two
 * solutions coincide there.)
 */
export function evaluateVoltage(
  p: CircuitParams,
  opts: { voltSecondTol?: number; boundaryTol?: number } = {},
): ModeResult {
  const voltSecondTol = opts.voltSecondTol ?? DEFAULT_VOLT_SECOND_TOL;
  const boundaryTol = opts.boundaryTol ?? 1e-12;

  const boundary = buildBoundaryInfo(p, boundaryTol);
  const mode: ConductionMode = boundary.mode;
  const ccmVout = ccmOutputVoltage(p);
  const D = p.dutyCycle;

  let vout: number;
  let M: number;
  let d2: number;
  let check: ModeResult['voltSecondCheck'];

  if (mode === 'DCM') {
    M = dcmConversionRatio(p.dutyCycle, boundary.K);
    vout = M * p.inputVoltage;
    d2 = dcmDiodeDuty(p.dutyCycle, M);
    // On for D, diode-freewheel for D2, idle for the remainder.
    check = voltSecondCheck(
      p.inputVoltage - vout,
      D,
      vout,
      d2,
      p.switchPeriod,
      voltSecondTol,
    );
  } else {
    // CCM and BOUNDARY: ideal switch volt-second balance gives Vout = D Vin.
    vout = ccmVout;
    M = p.dutyCycle;
    d2 = 0;
    check = voltSecondCheck(
      p.inputVoltage - vout,
      D,
      vout,
      1 - D,
      p.switchPeriod,
      voltSecondTol,
    );
    // The exact CCM model must close within the pinned tolerance.
    if (!check.closed) {
      throw new Error(
        `CCM volt-second balance failed to close within tolerance ` +
          `${voltSecondTol} (relative residual ${check.relativeResidual})`,
      );
    }
  }

  return {
    mode,
    inputVoltage: p.inputVoltage,
    dutyCycle: p.dutyCycle,
    outputVoltage: vout,
    ccmOutputVoltage: ccmVout,
    conversionRatio: M,
    diodeDutyFraction: d2,
    averageInductorCurrent: vout / p.loadResistance,
    boundary: {
      K: boundary.K,
      Kcrit: boundary.Kcrit,
      criticalInductance: boundary.criticalInductance,
      criticalLoadResistance: boundary.criticalLoadResistance,
      criticalSwitchPeriod: boundary.criticalSwitchPeriod,
      tolerance: boundary.tolerance,
    },
    voltSecondCheck: check,
  };
}
