import { CircuitParams, EvaluationResult } from './types';
import { validateParams, FieldError } from './validation';
import { evaluateVoltage } from './voltage';
import { evaluateRipple } from './ripple';

export interface EngineOptions {
  voltSecondTol?: number;
  boundaryTol?: number;
}

/**
 * Validate then fully evaluate one circuit: mode, averaged output voltage,
 * boundary and ripple. Pure function — no I/O — safe under concurrency.
 *
 * @param index 0-based position inside a batch; when provided, validation
 *              messages are prefixed with "item N" for batch error reports.
 */
export function evaluate(
  raw: unknown,
  opts: EngineOptions & { index?: number } = {},
): { ok: true; result: EvaluationResult } | { ok: false; errors: FieldError[] } {
  const checked = validateParams(raw, opts.index);
  if (checked.errors.length > 0 || !checked.params) {
    return { ok: false, errors: checked.errors };
  }
  const p = checked.params;
  const modeResult = evaluateVoltage(p, opts);
  const ripple = evaluateRipple(p, modeResult);
  return { ok: true, result: { ...modeResult, ripple } };
}

/**
 * Ready-to-call example: 12 V input, ~5 V output, continuous conduction.
 *
 * D = 5/12 ≈ 0.4167, f = 100 kHz, L = 50 uH, C = 100 uF, R = 5 ohm.
 * K = 2 L / (R Ts) = 2.0, Kcrit = 1 - D ≈ 0.583 -> comfortably CCM,
 * Vout = D Vin ≈ 5 V, inductor ripple ≈ 0.58 A, capacitor ripple ≈ 7.3 mV.
 */
export function presetExample(): { params: CircuitParams } {
  return {
    params: {
      inputVoltage: 12,
      dutyCycle: 5 / 12,
      inductance: 50e-6,
      capacitance: 100e-6,
      switchPeriod: 10e-6,
      loadResistance: 5,
    },
  };
}
