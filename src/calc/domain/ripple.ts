import { CircuitParams, ModeResult, RippleResult } from './types';

/**
 * Inductor / capacitor ripple model.
 *
 * CCM and DCM deliberately use different waveform integrals — the mode
 * decision and the ripple equations must always be consistent.
 *
 * CCM (trapezoidal inductor current, peak-to-peak dI):
 *   dI  = (Vin - Vout) D Ts / L
 *   the capacitor charges/discharges by dQ = dI Ts / 8 each half cycle
 *   dV_C = dQ / C,    dV_ESR = dI * ESR
 *
 * DCM (triangular inductor current from 0 up to Ipk and back to 0).
 * In a buck the inductor feeds the output node directly, so the output
 * amp-second balance is on the inductor current:
 *   Vout/R = <iL> = Ipk (D + D2) / 2  ->  K = D2 (D + D2)
 *   Ipk = (Vin - Vout) D Ts / L,   D2 = D (1 - M) / M
 * With a = Iout/Ipk = (D + D2)/2, integrating (i_L - Iout) between its two
 * zero crossings gives
 *   dQ = Ipk Ts (D + D2) (1 - a)^2 / 2
 *      = Ipk Ts D (2M - D)^2 / (8 M^3)
 *   dV_C = dQ / C,    dV_ESR = Ipk * ESR   (valley is zero)
 *
 * At the boundary M = D the DCM expression reduces to Ipk Ts / 8 = dI Ts / 8,
 * i.e. it joins the CCM result continuously.
 */
export function evaluateRipple(
  p: CircuitParams,
  modeResult: ModeResult,
): RippleResult {
  const { mode, outputVoltage: vout } = modeResult;
  const D = p.dutyCycle;
  const Ts = p.switchPeriod;
  const esr = p.esr ?? 0;

  if (mode === 'DCM') {
    const M = modeResult.conversionRatio;
    // Peak of the triangle: (Vin - Vout) D Ts / L.
    const ipk = ((p.inputVoltage - vout) * D * Ts) / p.inductance;

    // Positive capacitor charge between the two crossings of i_L = Iout:
    //   dQ = Ipk Ts D (2M - D)^2 / (8 M^3)
    const dq =
      (ipk * Ts * D * Math.pow(2 * M - D, 2)) / (8 * Math.pow(M, 3));
    const dvc = dq / p.capacitance;
    const dve = ipk * esr; // valley current is zero -> p-p ESR ripple is Ipk*ESR

    return {
      mode,
      outputVoltage: vout,
      inductorCurrentRipple: ipk, // triangle 0 -> Ipk -> 0, so p-p = Ipk
      peakInductorCurrent: ipk,
      valleyInductorCurrent: 0,
      capacitorVoltageRipple: dvc,
      esrVoltageRipple: dve,
      totalOutputVoltageRipple: dvc + dve,
      esr,
    };
  }

  // CCM (BOUNDARY is evaluated with the continuous-conduction formulas).
  const dI = ((p.inputVoltage - vout) * D * Ts) / p.inductance;
  const iAvg = vout / p.loadResistance;
  // Capacitor charge per half cycle for a triangular ripple of p-p dI:
  //   dQ = 1/2 * (dI/2) * (Ts/2) = dI Ts / 8
  const dq = (dI * Ts) / 8;
  const dvc = dq / p.capacitance;
  const dve = dI * esr;

  return {
    mode,
    outputVoltage: vout,
    inductorCurrentRipple: dI,
    peakInductorCurrent: iAvg + dI / 2,
    valleyInductorCurrent: iAvg - dI / 2,
    capacitorVoltageRipple: dvc,
    esrVoltageRipple: dve,
    totalOutputVoltageRipple: dvc + dve,
    esr,
  };
}
