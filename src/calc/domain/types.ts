/** Conduction mode classification. */
export type ConductionMode = 'CCM' | 'DCM' | 'BOUNDARY';

/**
 * Raw circuit inputs handed in by upstream callers.
 *
 * `esr` is the optional capacitor equivalent series resistance; it defaults to
 * zero when omitted. Everything else is mandatory.
 */
export interface CircuitParams {
  /** Input (source) voltage in volts, must be > 0. */
  inputVoltage: number;
  /** Switch duty ratio, strictly inside (0, 1). */
  dutyCycle: number;
  /** Inductance in henries, must be > 0. */
  inductance: number;
  /** Capacitance in farads, must be > 0. */
  capacitance: number;
  /** Switching period in seconds, must be > 0. */
  switchPeriod: number;
  /** Load resistance in ohms, must be > 0. */
  loadResistance: number;
  /** Optional capacitor ESR in ohms, must be >= 0. Defaults to 0. */
  esr?: number;
}

export interface ModeBoundaryInfo {
  /** Dimensionless parameter K = 2L / (R Ts). */
  K: number;
  /** Critical K at this duty cycle, Kcrit = 1 - D. */
  Kcrit: number;
  /** Inductance at the mode boundary (henries): Kcrit * R * Ts / 2. */
  criticalInductance: number;
  /** Load resistance at the boundary for the other fixed values (ohms). */
  criticalLoadResistance: number;
  /** Switching period at the boundary for the other fixed values (seconds). */
  criticalSwitchPeriod: number;
  /** Classification tolerance applied to K vs Kcrit. */
  tolerance: number;
}

/** Result of the mode + averaged output-voltage calculation. */
export interface ModeResult {
  mode: ConductionMode;
  inputVoltage: number;
  dutyCycle: number;
  /** Averaged output voltage in volts. */
  outputVoltage: number;
  /** CCM prediction D * Vin, always included for comparison. */
  ccmOutputVoltage: number;
  /** DCM conversion ratio M = Vout / Vin (equals D in CCM). */
  conversionRatio: number;
  /** D2 = diode conduction fraction of the period (DCM only; 0 in CCM). */
  diodeDutyFraction: number;
  /** Averaged inductor / load current in amperes. */
  averageInductorCurrent: number;
  boundary: ModeBoundaryInfo;
  /** Volt-second balance closure check (CCM only). */
  voltSecondCheck: {
    /** (Vin - Vout) * D * Ts applied when switch is on. */
    on: number;
    /** Vout * (1 - D) * Ts applied when switch is off (CCM). */
    off: number;
    /** Signed difference on - off. */
    residual: number;
    /** |residual| / ((on + off) / 2), dimensionless. */
    relativeResidual: number;
    tolerance: number;
    closed: boolean;
  };
}

/** Ripple calculation result. */
export interface RippleResult {
  mode: ConductionMode;
  outputVoltage: number;
  /** Inductor current peak-to-peak ripple in amperes. */
  inductorCurrentRipple: number;
  /** Peak inductor current (triangulation), amperes. */
  peakInductorCurrent: number;
  /** Valley inductor current, amperes (0 in DCM). */
  valleyInductorCurrent: number;
  /** Capacitor voltage ripple from charge integration, volts. */
  capacitorVoltageRipple: number;
  /** Ripple contribution from ESR (i_pp * ESR or i_peak * ESR), volts. */
  esrVoltageRipple: number;
  /** Total peak-to-peak output ripple (charge + ESR), volts. */
  totalOutputVoltageRipple: number;
  esr: number;
}

/** Combined mode + ripple result returned by the single /evaluate call. */
export interface EvaluationResult extends ModeResult {
  ripple: RippleResult;
}
