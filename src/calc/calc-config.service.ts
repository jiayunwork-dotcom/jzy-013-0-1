import { Injectable } from '@nestjs/common';
import {
  DEFAULT_BOUNDARY_TOL,
  DEFAULT_VOLT_SECOND_TOL,
  KCRIT_FORMULA,
  K_FORMULA,
} from '../calc/domain/constants';

/**
 * Runtime configuration of the numerical model. Values come from environment
 * variables (VOLT_SECOND_TOL / BOUNDARY_TOL) with safe pinned defaults.
 */
@Injectable()
export class CalcConfigService {
  readonly voltSecondTol: number;
  readonly boundaryTol: number;

  constructor() {
    this.voltSecondTol = positiveFromEnv('VOLT_SECOND_TOL', DEFAULT_VOLT_SECOND_TOL);
    this.boundaryTol = positiveFromEnv('BOUNDARY_TOL', DEFAULT_BOUNDARY_TOL);
  }

  echoConfig() {
    return {
      formulas: {
        dimensionlessK: K_FORMULA,
        criticalK: KCRIT_FORMULA,
        ccmOutputVoltage: 'Vout = D * Vin',
        dcmConversionRatio: 'M = 2D / (D + sqrt(D^2 + 4K))',
        dcmDiodeFraction: 'D2 = D * (1 - M) / M',
        ccmInductorCurrentRipple: 'dI = (Vin - Vout) * D * Ts / L',
        ccmCapacitorCharge: 'dQ = dI * Ts / 8',
        ccmCapacitorVoltageRipple: 'dVc = dQ / C',
        esrRippleCcm: 'dVesr = dI * ESR',
        esrRippleDcm: 'dVesr = Ipk * ESR',
      },
      modeBoundary: {
        rule: 'CCM when K >= Kcrit(D), DCM when K < Kcrit(D)',
        note:
          'For an ideal buck, Kcrit(D) = 1 - D: a larger duty cycle makes CCM ' +
          'easier to sustain (shorter off-time). This is the boundary at which ' +
          'the DCM voltage solution joins D*Vin continuously.',
      },
      tolerances: {
        voltSecondBalanceRelative: this.voltSecondTol,
        modeBoundary: this.boundaryTol,
      },
      inputRanges: {
        dutyCycle: 'strictly inside the open interval (0, 1)',
        inputVoltage: '> 0',
        inductance: '> 0',
        capacitance: '> 0',
        switchPeriod: '> 0',
        loadResistance: '> 0',
        esr: '>= 0 (optional, defaults to 0)',
      },
    };
  }
}

function positiveFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
